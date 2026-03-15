const express = require("express");
const router = express.Router();
const User = require("../models/User");
const Product = require("../models/Product");
const Order = require("../models/Order");
const { protect, adminOnly } = require("../middleware/auth");


// Seed admin account (public — only used once)
router.post("/seed-admin", async (req, res) => {
  try {
    const exists = await User.findOne({ role: "admin" });
    if (exists) return res.status(400).json({ message: "Admin already exists" });

    const admin = await User.create({
      name: "Admin",
      email: "admin@craftnext.com",
      password: "admin123",
      role: "admin",
    });

    res.json({ message: "Admin created", email: admin.email });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


// All routes below require admin authentication
router.use(protect, adminOnly);


// @GET /api/admin/stats
router.get("/stats", async (req, res) => {
  try {
    const [
      totalUsers,
      totalBuyers,
      totalSellers,
      totalProducts,
      totalOrders,
      orders,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: "buyer" }),
      User.countDocuments({ role: "seller" }),
      Product.countDocuments({ isActive: true }),
      Order.countDocuments(),
      Order.find().select("totalAmount status createdAt items"),
    ]);

    const totalRevenue = orders.reduce((sum, o) => sum + o.totalAmount, 0);

    const pendingOrders = orders.filter((o) => o.status === "pending").length;
    const deliveredOrders = orders.filter((o) => o.status === "delivered").length;

    const monthlyRevenue = {};
    const now = new Date();

    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.toLocaleString("default", { month: "short", year: "2-digit" });
      monthlyRevenue[key] = 0;
    }

    orders.forEach((o) => {
      const d = new Date(o.createdAt);
      const key = d.toLocaleString("default", { month: "short", year: "2-digit" });
      if (monthlyRevenue[key] !== undefined) {
        monthlyRevenue[key] += o.totalAmount;
      }
    });

    const categoryData = await Product.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: "$category", count: { $sum: 1 } } },
    ]);

    res.json({
      totalUsers,
      totalBuyers,
      totalSellers,
      totalProducts,
      totalOrders,
      totalRevenue,
      pendingOrders,
      deliveredOrders,
      monthlyRevenue,
      categoryData,
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


// @GET /api/admin/users
router.get("/users", async (req, res) => {
  try {
    const { role, search } = req.query;

    const filter = {};

    if (role) filter.role = role;

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    const users = await User.find(filter)
      .select("-password")
      .sort({ createdAt: -1 });

    res.json(users);

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


// @PUT /api/admin/users/:id
router.put("/users/:id", async (req, res) => {
  try {

    const user = await User.findById(req.params.id);

    if (!user) return res.status(404).json({ message: "User not found" });

    if (req.body.isActive !== undefined) user.isActive = req.body.isActive;
    if (req.body.role) user.role = req.body.role;

    const updated = await user.save();

    res.json({
      _id: updated._id,
      name: updated.name,
      role: updated.role,
      isActive: updated.isActive,
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


// @DELETE /api/admin/users/:id
router.delete("/users/:id", async (req, res) => {
  try {

    await User.findByIdAndDelete(req.params.id);

    res.json({ message: "User deleted" });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


// @GET /api/admin/orders
router.get("/orders", async (req, res) => {
  try {

    const orders = await Order.find()
      .sort({ createdAt: -1 })
      .limit(100);

    res.json(orders);

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


// @GET /api/admin/products
router.get("/products", async (req, res) => {
  try {

    const products = await Product.find()
      .sort({ createdAt: -1 });

    res.json(products);

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


module.exports = router;