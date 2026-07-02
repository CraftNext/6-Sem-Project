const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { body, validationResult } = require("express-validator");
const User = require("../models/User");
const { protect } = require("../middleware/auth");
const { sendOTPEmail, sendResetEmail } = require("../utils/mailer");


// Generate JWT
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "30d" });
};

/* ================= AVATAR UPLOAD ================= */

const avatarStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, "../uploads/avatars");
    fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    cb(null, `${req.user._id}-${Date.now()}-${file.originalname.replace(/\s+/g, "_")}`);
  },
});

// Same image-only, 5 MB constraint as product image uploads.
const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpe?g|png|webp|gif|avif)$/.test(file.mimetype)) {
      cb(null, true);
    } else {
      const err = new Error("Only image files are allowed");
      err.status = 400;
      cb(err);
    }
  },
});

// @POST /api/auth/avatar  (protected)
router.post("/avatar", protect, avatarUpload.single("avatar"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No image uploaded" });

    const user = await User.findById(req.user._id);
    user.avatar = `/uploads/avatars/${req.file.filename}`;
    await user.save();

    res.json({ avatar: user.avatar });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @POST /api/auth/register
router.post("/register", [
  body("name").trim().notEmpty().withMessage("Name is required"),
  body("email").isEmail().withMessage("A valid email is required").normalizeEmail(),
  body("password").isLength({ min: 6 }).withMessage("Password must be at least 6 characters"),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: errors.array()[0].msg });
    }

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
    // Send OTP email (falls back to console.log if email not configured)
    try {
      await sendOTPEmail(email, otp);
    } catch (mailErr) {
      console.warn("Email send failed, OTP:", otp, mailErr.message);
    }
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
router.post("/login", [
  body("email").isEmail().withMessage("A valid email is required"),
  body("password").notEmpty().withMessage("Password is required"),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: errors.array()[0].msg });
    }

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

    const token = generateToken(user._id);
    res.cookie("cn_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      shopName: user.shopName,
      avatar: user.avatar,
      token,
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
    const token = generateToken(updated._id);
    res.cookie("cn_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    res.json({
      _id: updated._id,
      name: updated.name,
      email: updated.email,
      role: updated.role,
      token,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* ================= SAVED ADDRESSES ================= */

// @GET /api/auth/addresses  (protected)
router.get("/addresses", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("addresses");
    res.json(user.addresses);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @POST /api/auth/addresses  (protected)
router.post("/addresses", protect, async (req, res) => {
  try {
    const { label, name, phone, address, city, pincode } = req.body;
    if (!name || !address || !city || !pincode) {
      return res.status(400).json({ message: "Name, address, city, and pincode are required" });
    }

    const user = await User.findById(req.user._id);
    user.addresses.push({ label: label || "Home", name, phone, address, city, pincode });
    await user.save();

    res.status(201).json(user.addresses);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @DELETE /api/auth/addresses/:addressId  (protected)
router.delete("/addresses/:addressId", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    user.addresses.pull(req.params.addressId);
    await user.save();

    res.json(user.addresses);
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
// @POST /api/auth/resend-otp
router.post("/resend-otp", async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) return res.status(400).json({ message: "User not found" });
    if (user.isVerified) return res.status(400).json({ message: "Already verified" });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.otp = otp;
    user.otpExpiry = Date.now() + 5 * 60 * 1000;
    await user.save();

    try {
      await sendOTPEmail(email, otp);
    } catch (mailErr) {
      console.warn("Email send failed, OTP:", otp, mailErr.message);
    }

    res.json({ message: "OTP resent to email" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @POST /api/auth/forgot-password
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    // Always respond the same way whether or not the email exists —
    // don't let this endpoint be used to enumerate registered accounts.
    if (user) {
      const rawToken = crypto.randomBytes(32).toString("hex");
      user.resetToken = crypto.createHash("sha256").update(rawToken).digest("hex");
      user.resetTokenExpiry = Date.now() + 30 * 60 * 1000; // 30 min
      await user.save();

      const resetUrl = `${process.env.CLIENT_URL || "http://localhost:5500"}/login.html?resetToken=${rawToken}&email=${encodeURIComponent(email)}`;
      try {
        await sendResetEmail(email, resetUrl);
      } catch (mailErr) {
        console.warn("Reset email failed:", mailErr.message);
      }
    }

    res.json({ message: "If that email is registered, a reset link has been sent." });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @POST /api/auth/reset-password
router.post("/reset-password", async (req, res) => {
  try {
    const { email, token, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const hashedToken = crypto.createHash("sha256").update(token || "").digest("hex");
    const user = await User.findOne({
      email,
      resetToken: hashedToken,
      resetTokenExpiry: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired reset link" });
    }

    user.password = newPassword; // hashed by pre-save hook
    user.resetToken = undefined;
    user.resetTokenExpiry = undefined;
    await user.save();

    res.json({ message: "Password reset successfully. Please sign in." });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @POST /api/auth/logout - clear cookie
router.post("/logout", (req, res) => {
  res.clearCookie("cn_token");
  res.json({ message: "Logged out successfully" });
});

module.exports = router;
