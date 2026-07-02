require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const helmet = require("helmet");
const morgan = require("morgan");
const multer = require("multer");
const connectDB = require("./config/db");
const rateLimit = require("express-rate-limit");
const dns = require("dns");
dns.setServers(["1.1.1.1", "8.8.8.8"]);
const app = express();

// Rate limit auth endpoints: 20 requests / 15 min per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { message: "Too many requests. Please wait 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limit write endpoints (product/order creation): 60 requests / 15 min per IP
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { message: "Too many requests. Please slow down and try again shortly." },
  standardHeaders: true,
  legacyHeaders: false,
});

// The chat route calls a paid external API per request — cap harder than
// other write endpoints to bound cost from abuse.
const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { message: "Too many messages. Please wait a bit before trying again." },
  standardHeaders: true,
  legacyHeaders: false,
});

// In production, an unset CLIENT_URL must not silently fall back to "*" —
// fail at startup instead of shipping an open CORS policy.
if (process.env.NODE_ENV === "production" && !process.env.CLIENT_URL) {
  console.error("❌ CLIENT_URL must be set in production (refusing to start with CORS wide open).");
  process.exit(1);
}

const clientUrl = process.env.CLIENT_URL || "http://localhost:5500";
const allowedOrigins = new Set([clientUrl]);

try {
  const parsedClientUrl = new URL(clientUrl);
  if (parsedClientUrl.hostname === "localhost" || parsedClientUrl.hostname === "127.0.0.1") {
    const devOrigin = `${parsedClientUrl.protocol}//${parsedClientUrl.hostname}:${parsedClientUrl.port}`;
    const alternateHost = parsedClientUrl.hostname === "localhost" ? "127.0.0.1" : "localhost";
    allowedOrigins.add(devOrigin);
    allowedOrigins.add(`${parsedClientUrl.protocol}//${alternateHost}:${parsedClientUrl.port}`);
  }
} catch {
  // Ignore malformed CLIENT_URL here; the app will still fail naturally if it
  // is truly unusable for auth redirects or CORS.
}

// Connect to MongoDB
connectDB();

// Middleware
app.use(helmet({
  // Static image responses need to be embeddable cross-origin (frontend on a different port).
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (allowedOrigins.has(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked for origin ${origin}`));
  },
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files (uploaded images)
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Applies a limiter only to POST requests, leaving GET browsing unrestricted.
const postOnly = (limiter) => (req, res, next) => (req.method === "POST" ? limiter(req, res, next) : next());

// Routes
app.use("/api/auth", authLimiter, require("./routes/auth"));
app.use("/api/products", postOnly(writeLimiter), require("./routes/products"));
app.use("/api/orders", postOnly(writeLimiter), require("./routes/orders"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/coupons", require("./routes/coupons").router);
app.use("/api/newsletter", require("./routes/newsletter"));
app.use("/api/chat", chatLimiter, require("./routes/chat"));

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "CraftNext API is running 🎨", timestamp: new Date() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// Error handler
// Multer errors (file too large, or our fileFilter rejecting a non-image)
// arrive here directly, bypassing each route's own try/catch — surface the
// real message with a 400 instead of masking it as a generic 500.
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.status === 400) {
    return res.status(400).json({ message: err.message });
  }
  console.error(err.stack);
  res.status(500).json({ message: "Internal server error" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 CraftNext Server running on http://localhost:${PORT}`);
});
