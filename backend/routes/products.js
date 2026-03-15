const express = require("express");
const router = express.Router();
const Product = require("../models/Product");
const { protect, sellerOrAdmin, adminOnly } = require("../middleware/auth");

const multer = require("multer");
const path = require("path");
const fs = require("fs");

/* ================= MULTER CONFIG ================= */

const storage = multer.diskStorage({

  destination: function (req, file, cb) {

    const category = req.body.category || "other";

    const uploadPath = path.join(__dirname, `../uploads/${category}`);

    // create folder if not exists
    fs.mkdirSync(uploadPath, { recursive: true });

    cb(null, uploadPath);
  },

  filename: function (req, file, cb) {

    const uniqueName =
      Date.now() + "-" + file.originalname.replace(/\s+/g, "_");

    cb(null, uniqueName);
  },

});

const upload = multer({ storage });


/* ================= GET PRODUCTS ================= */

// @GET /api/products — public
router.get("/", async (req, res) => {
  try {

    const { category, search, seller } = req.query;

    const filter = { isActive: true };

    if (category) filter.category = category;

    if (seller) filter.seller = seller;

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { sellerName: { $regex: search, $options: "i" } },
      ];
    }

    const products = await Product.find(filter).sort({ createdAt: -1 });

    res.json(products);

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


/* ================= GET SINGLE PRODUCT ================= */

// @GET /api/products/:id — public
router.get("/:id", async (req, res) => {
  try {

    const product = await Product.findById(req.params.id).populate(
      "seller",
      "name shopName location avatar phone"
    );

    if (!product)
      return res.status(404).json({ message: "Product not found" });

    res.json(product);

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


/* ================= CREATE PRODUCT ================= */

// @POST /api/products — seller/admin
router.post(
  "/",
  protect,
  sellerOrAdmin,
  upload.single("image"),
  async (req, res) => {
    try {

      const { name, description, price, category, stock } = req.body;

      let imagePath = "";

      if (req.file) {
        imagePath = `/uploads/${category}/${req.file.filename}`;
      }

      const product = await Product.create({
        name,
        description,
        price,
        category,
        img: imagePath,
        images: [imagePath],
        stock: stock || 10,
        seller: req.user._id,
        sellerName: req.user.shopName || req.user.name,
      });

      res.status(201).json(product);

    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);


/* ================= UPDATE PRODUCT ================= */

// @PUT /api/products/:id — seller (own) or admin
router.put("/:id", protect, sellerOrAdmin, async (req, res) => {
  try {

    const product = await Product.findById(req.params.id);

    if (!product)
      return res.status(404).json({ message: "Product not found" });

    if (
      req.user.role !== "admin" &&
      product.seller.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ message: "Not authorized" });
    }

    Object.assign(product, req.body);

    const updated = await product.save();

    res.json(updated);

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


/* ================= DELETE PRODUCT ================= */

// @DELETE /api/products/:id — seller/admin
router.delete("/:id", protect, sellerOrAdmin, async (req, res) => {
  try {

    const product = await Product.findById(req.params.id);

    if (!product)
      return res.status(404).json({ message: "Product not found" });

    if (
      req.user.role !== "admin" &&
      product.seller.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ message: "Not authorized" });
    }

    product.isActive = false;

    await product.save();

    res.json({ message: "Product removed" });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


module.exports = router;