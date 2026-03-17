const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: 6,
    },
    role: {
      type: String,
      enum: ["buyer", "seller", "admin"],
      default: "buyer",
    },
    // Seller-specific fields
    shopName: { type: String },
    shopDescription: { type: String },
    location: { type: String },
    phone: { type: String },
    avatar: { type: String, default: "" },

    otp: String,
    otpExpiry: Date,
    isVerified: { type: Boolean, default: false },

    // Buyer-specific fields
    address: { type: String },
    city: { type: String },
    pincode: { type: String },

    isActive: { type: Boolean, default: true },
    wishlist: [{ type: Number }], // product IDs
  },
  { timestamps: true }
);

// Hash password before saving
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model("User", userSchema);
