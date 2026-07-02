const express = require("express");
const router = express.Router();
const Order = require("../models/Order");
const Product = require("../models/Product");
const { protect, adminOnly, optionalProtect } = require("../middleware/auth");
const { computeDiscount } = require("./coupons");
const { sendOrderConfirmationEmail, sendOrderStatusEmail } = require("../utils/mailer");

const FREE_SHIPPING_THRESHOLD = 999;
const SHIPPING_FEE = 49;

// Restore stock for items already decremented earlier in a failed order attempt.
async function restock(decremented) {
  for (const d of decremented) {
    await Product.updateOne({ _id: d.id }, { $inc: { stock: d.qty } });
  }
}

// @POST /api/orders  — create order (buyer or guest)
router.post("/", optionalProtect, async (req, res) => {
  try {
    const { items, shipping, paymentMethod, couponCode, idempotencyKey } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ message: "No items in order" });
    }
    if (!req.user && (!shipping || !shipping.name || !shipping.email)) {
      return res.status(400).json({ message: "Name and email are required for guest checkout" });
    }

    // A retried/double-submitted request with the same key returns the
    // original order instead of creating (and re-charging) a duplicate.
    if (idempotencyKey) {
      const existing = await Order.findOne({ idempotencyKey });
      if (existing) return res.status(200).json(existing);
    }

    // Rebuild every line item from the DB — never trust client-supplied
    // prices, names, or sellers.
    const orderItems = [];
    const decremented = [];
    let subtotal = 0;

    for (const i of items) {
      if (!i.product) {
        await restock(decremented);
        return res.status(400).json({ message: "Each item must reference a product id" });
      }

      const qty = Math.max(1, parseInt(i.qty, 10) || 1);

      // Atomic: the stock>=qty check and the decrement happen as a single
      // document operation, so two buyers racing for the last unit can't
      // both succeed — the second one simply won't match.
      const product = await Product.findOneAndUpdate(
        { _id: i.product, isActive: true, stock: { $gte: qty } },
        { $inc: { stock: -qty } }
      );

      if (!product) {
        await restock(decremented);
        const existing = await Product.findById(i.product);
        if (!existing || !existing.isActive) {
          return res.status(404).json({ message: `Product not available: ${i.product}` });
        }
        return res.status(409).json({ message: `Only ${existing.stock} left of "${existing.name}"` });
      }

      decremented.push({ id: product._id, qty });
      orderItems.push({
        product: product._id,
        name: product.name,
        img: product.img,
        price: product.price,
        qty,
        seller: product.seller,
        sellerName: product.sellerName,
      });
      subtotal += product.price * qty;
    }

    const shippingFee = subtotal > FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE;

    // Coupon — validated and priced server-side; a client-sent discount is never trusted.
    let discountAmount = 0;
    let appliedCoupon;
    if (couponCode) {
      const result = await computeDiscount(couponCode, subtotal);
      if (!result.valid) {
        await restock(decremented);
        return res.status(400).json({ message: result.message });
      }
      discountAmount = result.discountAmount;
      appliedCoupon = result.code;
    }

    const totalAmount = Math.max(0, subtotal + shippingFee - discountAmount);

    let order;
    try {
      order = await Order.create({
        buyer: req.user ? req.user._id : undefined,
        buyerName: req.user ? req.user.name : shipping.name,
        buyerEmail: req.user ? req.user.email : shipping.email,
        items: orderItems,
        shipping,
        shippingFee,
        couponCode: appliedCoupon,
        discountAmount,
        totalAmount,
        paymentMethod: paymentMethod || "COD",
        idempotencyKey,
      });
    } catch (err) {
      // Two identical requests raced past the findOne check above — the unique
      // index caught it. Return the order that won instead of erroring or overselling.
      if (err.code === 11000 && idempotencyKey) {
        await restock(decremented);
        const winner = await Order.findOne({ idempotencyKey });
        return res.status(200).json(winner);
      }
      throw err;
    }

    // Best-effort — an email hiccup shouldn't fail an order that already succeeded.
    try {
      await sendOrderConfirmationEmail(order.buyerEmail, order);
    } catch (mailErr) {
      console.warn("Order confirmation email failed:", mailErr.message);
    }

    res.status(201).json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @GET /api/orders/myorders  — buyer's own orders
router.get("/myorders", protect, async (req, res) => {
  try {
    const orders = await Order.find({ buyer: req.user._id }).sort({
      createdAt: -1,
    });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @GET /api/orders/seller  — seller's orders
router.get("/seller", protect, async (req, res) => {
  try {
    const orders = await Order.find({
      "items.seller": req.user._id,
    }).sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @GET /api/orders/:id  — the buyer who owns it, a seller in it, or an admin
router.get("/:id", protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    const uid = req.user._id.toString();
    const isOwner = order.buyer && order.buyer.toString() === uid;
    const isSeller = order.items.some((it) => it.seller && it.seller.toString() === uid);
    if (!isOwner && !isSeller && req.user.role !== "admin") {
      return res.status(403).json({ message: "Not authorized" });
    }

    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @PUT /api/orders/:id/status  — a seller in the order, or an admin
// (buyers must not be able to mark their own order delivered/paid)
router.put("/:id/status", protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    const uid = req.user._id.toString();
    const isSeller = order.items.some((it) => it.seller && it.seller.toString() === uid);
    if (!isSeller && req.user.role !== "admin") {
      return res.status(403).json({ message: "Not authorized" });
    }

    const allowed = ["pending", "confirmed", "shipped", "delivered", "cancelled"];
    if (!allowed.includes(req.body.status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    order.status = req.body.status;
    if (req.body.status === "delivered") {
      order.isPaid = true;
      order.paidAt = new Date();
    }

    const updated = await order.save();

    try {
      await sendOrderStatusEmail(updated.buyerEmail, updated);
    } catch (mailErr) {
      console.warn("Order status email failed:", mailErr.message);
    }

    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @PUT /api/orders/:id/cancel  — buyer cancels their own order while still pending
router.put("/:id/cancel", protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    if (!order.buyer || order.buyer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not authorized" });
    }
    if (order.status !== "pending") {
      return res.status(400).json({ message: "Only pending orders can be cancelled" });
    }

    order.status = "cancelled";
    await order.save();

    for (const item of order.items) {
      if (item.product) {
        await Product.updateOne({ _id: item.product }, { $inc: { stock: item.qty } });
      }
    }

    try {
      await sendOrderStatusEmail(order.buyerEmail, order);
    } catch (mailErr) {
      console.warn("Order cancellation email failed:", mailErr.message);
    }

    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
