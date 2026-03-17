const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { protect } = require("../middleware/auth");

// Generate JWT
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "30d" });
};

// @POST /api/auth/register
router.post("/register", async (req, res) => {
  try {
    const { name, email, password, role, shopName, shopDescription, location, phone } = req.body;

    // Check existing
    const exists = await User.findOne({ email });
    if (exists) {
      return res.status(400).json({ message: "Email already registered" });
    }

    // Prevent self-registration as admin
    const safeRole = role === "admin" ? "buyer" : (role || "buyer");

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    const user = await User.create({
    name,
    email,
    password,
    role: safeRole,
    shopName,
    shopDescription,
    location,
    phone,
    otp,
    otpExpiry: Date.now() + 5 * 60 * 1000, // 5 min
    isVerified: false,
    });
    console.log("OTP is:", otp);
    res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      shopName: user.shopName,
      message: "OTP sent to email. Please verify.",
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }
    if (!user.isVerified) {
    return res.status(401).json({ message: "Please verify your email first" });
    }
    if (user.isActive === false) {
      return res.status(403).json({ message: "Account suspended. Contact support." });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      shopName: user.shopName,
      avatar: user.avatar,
      token: generateToken(user._id),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @GET /api/auth/me  (protected)
router.get("/me", protect, async (req, res) => {
  const user = await User.findById(req.user._id).select("-password");
  res.json(user);
});

// @PUT /api/auth/profile  (protected)
router.put("/profile", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const { name, phone, address, city, pincode, shopName, shopDescription, location } = req.body;

    if (name) user.name = name;
    if (phone) user.phone = phone;
    if (address) user.address = address;
    if (city) user.city = city;
    if (pincode) user.pincode = pincode;
    if (shopName) user.shopName = shopName;
    if (shopDescription) user.shopDescription = shopDescription;
    if (location) user.location = location;

    if (req.body.password) {
      user.password = req.body.password; // will be hashed by pre-save
    }

    const updated = await user.save();
    res.json({
      _id: updated._id,
      name: updated.name,
      email: updated.email,
      role: updated.role,
      token: generateToken(updated._id),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
// @POST /api/auth/verify-otp
router.post("/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }

    if (user.otp !== otp || user.otpExpiry < Date.now()) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    user.isVerified = true;
    user.otp = null;
    user.otpExpiry = null;

    await user.save();

    res.json({ message: "Email verified successfully" });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
module.exports = router;
