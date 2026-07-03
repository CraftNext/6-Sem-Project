const mongoose = require("mongoose");
const express = require("express");
const router = express.Router();
const Order = require("../models/Order");
const Product = require("../models/Product");
const { protect, adminOnly, optionalProtect } = require("../middleware/auth");
const { computeDiscount } = require("./coupons");
const { sendOrderConfirmationEmail, sendOrderStatusEmail } = require("../utils/mailer");
const Razorpay = require("razorpay");
const crypto = require("crypto");

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || "rzp_test_dummykey123",
  key_secret: process.env.RAZORPAY_KEY_SECRET || "dummysecret123"
});

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
  let session = null;
  let transactionActive = false;
  const decremented = [];

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

    // Initialize transaction session if supported by environment
    try {
      session = await mongoose.startSession();
      session.startTransaction();
      transactionActive = true;
    } catch (sessionErr) {
      session = null;
      transactionActive = false;
    }

    // Rebuild every line item from the DB — never trust client-supplied
    // prices, names, or sellers.
    const orderItems = [];
    let subtotal = 0;

    for (const i of items) {
      if (!i.product) {
        if (transactionActive && session) {
          await session.abortTransaction();
          session.endSession();
        } else {
          await restock(decremented);
        }
        return res.status(400).json({ message: "Each item must reference a product id" });
      }

      const qty = Math.max(1, parseInt(i.qty, 10) || 1);

      // Atomic: the stock>=qty check and the decrement happen as a single
      // document operation, so two buyers racing for the last unit can't
      // both succeed — the second one simply won't match.
      const query = { _id: i.product, isActive: true, stock: { $gte: qty } };
      const update = { $inc: { stock: -qty } };
      const options = session ? { session, new: false } : { new: false };

      const product = await Product.findOneAndUpdate(query, update, options);

      if (!product) {
        if (transactionActive && session) {
          await session.abortTransaction();
          session.endSession();
        } else {
          await restock(decremented);
        }
        const existing = await Product.findById(i.product);
        if (!existing || !existing.isActive) {
          return res.status(404).json({ message: `Product not available: ${i.product}` });
        }
        return res.status(409).json({ message: `Only ${existing.stock} left of "${existing.name}"` });
      }

      if (!transactionActive) {
        decremented.push({ id: product._id, qty });
      }

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
        if (transactionActive && session) {
          await session.abortTransaction();
          session.endSession();
        } else {
          await restock(decremented);
        }
        return res.status(400).json({ message: result.message });
      }
      discountAmount = result.discountAmount;
      appliedCoupon = result.code;
    }

    const isOnlinePayment = ["Card", "UPI", "Online"].includes(paymentMethod);
    const totalAmount = Math.max(0, subtotal + shippingFee - discountAmount);

    const orderData = {
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
      isPaid: false,
    };

    let order;
    try {
      if (session) {
        const created = await Order.create([orderData], { session });
        order = created[0];
      } else {
        order = await Order.create(orderData);
      }
    } catch (err) {
      // Two identical requests raced past the findOne check above — the unique
      // index caught it. Return the order that won instead of erroring or overselling.
      if (err.code === 11000 && idempotencyKey) {
        if (transactionActive && session) {
          await session.abortTransaction();
          session.endSession();
        } else {
          await restock(decremented);
        }
        const winner = await Order.findOne({ idempotencyKey });
        return res.status(200).json(winner);
      }
      throw err;
    }

    // Create Razorpay Order if this is an online payment
    if (isOnlinePayment) {
      try {
        const rzpOrder = await razorpay.orders.create({
          amount: Math.round(totalAmount * 100), // in paise
          currency: "INR",
          receipt: String(order._id)
        });
        order.razorpayOrderId = rzpOrder.id;
        if (session) {
          await Order.updateOne({ _id: order._id }, { razorpayOrderId: rzpOrder.id }, { session });
        } else {
          await order.save();
        }
      } catch (rzpErr) {
        console.warn("Razorpay order creation failed:", rzpErr.message);
        // Fallback dummy order ID for developer testing when offline/credentials dummy
        const dummyId = "order_dummy_" + Math.random().toString(36).substring(2, 15);
        order.razorpayOrderId = dummyId;
        if (session) {
          await Order.updateOne({ _id: order._id }, { razorpayOrderId: dummyId }, { session });
        } else {
          await order.save();
        }
      }
    }

    if (transactionActive && session) {
      await session.commitTransaction();
      session.endSession();
    }

    // Best-effort — an email confirmation for non-online orders.
    // Online payments defer email sending until signature verification succeeds.
    if (!isOnlinePayment) {
      try {
        await sendOrderConfirmationEmail(order.buyerEmail, order);
      } catch (mailErr) {
        console.warn("Order confirmation email failed:", mailErr.message);
      }
    }

    res.status(201).json(order);
  } catch (err) {
    if (transactionActive && session) {
      try {
        await session.abortTransaction();
      } catch (abortErr) {}
      session.endSession();
    } else {
      await restock(decremented);
    }
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

// @POST /api/orders/:id/verify-payment — verify online signature and mark order paid
router.post("/:id/verify-payment", async (req, res) => {
  try {
    const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Idempotent + replay-safe: an already-paid order returns success without
    // re-marking or re-emailing. Blocks the "verify the same order twice" replay.
    if (order.isPaid) {
      return res.json({ success: true, order, alreadyPaid: true });
    }

    // The client-submitted order id MUST match the one the server minted for
    // this order at creation. Without this, the id is attacker-controlled and
    // the whole verification means nothing.
    if (!order.razorpayOrderId || razorpay_order_id !== order.razorpayOrderId) {
      return res.status(400).json({ message: "Payment order mismatch" });
    }

    // "Dummy" is decided from SERVER state (the id we stored), never from the
    // client body — and never in production. Previously any request could set
    // razorpay_order_id="order_dummy_x" and mark any order paid for free.
    const isDummy = order.razorpayOrderId.startsWith("order_dummy_");

    if (isDummy) {
      if (process.env.NODE_ENV === "production") {
        return res.status(400).json({ message: "Payment verification failed" });
      }
      order.razorpayPaymentId = razorpay_payment_id || "pay_dummy_123456";
      order.razorpaySignature = razorpay_signature || "sig_dummy_123456";
    } else {
      // Real Razorpay HMAC verification.
      if (!razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({ message: "Payment details missing" });
      }
      if (!process.env.RAZORPAY_KEY_SECRET) {
        // No secret configured — refuse rather than verify against a known
        // placeholder (which an attacker could sign against).
        return res.status(500).json({ message: "Payment gateway not configured" });
      }
      const hmac = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET);
      hmac.update(order.razorpayOrderId + "|" + razorpay_payment_id);
      const generated = hmac.digest("hex");

      // Constant-time compare — avoids a timing side-channel on the signature.
      const sigBuf = Buffer.from(razorpay_signature, "utf8");
      const genBuf = Buffer.from(generated, "utf8");
      if (sigBuf.length !== genBuf.length || !crypto.timingSafeEqual(sigBuf, genBuf)) {
        return res.status(400).json({ message: "Invalid payment signature" });
      }

      order.razorpayPaymentId = razorpay_payment_id;
      order.razorpaySignature = razorpay_signature;
    }

    order.isPaid = true;
    order.paidAt = new Date();
    await order.save();

    // Respond first; email is best-effort and must not delay the response.
    res.json({ success: true, order });
    sendOrderConfirmationEmail(order.buyerEmail, order)
      .catch((mailErr) => console.warn("Order confirmation email failed:", mailErr.message));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
