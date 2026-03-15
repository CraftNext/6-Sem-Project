const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Product name is required"],
      trim: true,
    },
    description: { type: String, default: "" },
    price: {
      type: Number,
      required: [true, "Price is required"],
      min: 0,
    },
    category: {
      type: String,
      required: true,
      enum: ["spiritual", "clock", "lippan", "diya", "zharokha", "other"],
      lowercase: true,
    },
    images: [{ type: String }],
    img: { type: String }, // main image
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    sellerName: { type: String }, // denormalized for speed
    rating: { type: Number, default: 5, min: 1, max: 5 },
    numReviews: { type: Number, default: 0 },
    bestSeller: { type: Boolean, default: false },
    isNew: { type: Boolean, default: true },
    stock: { type: Number, default: 10 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Product", productSchema);
