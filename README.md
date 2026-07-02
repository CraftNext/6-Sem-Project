# CraftNext — Handmade Marketplace

A full-stack marketplace for handmade Indian artisan products (paintings, Lippan
art, mandala clocks, diyas, décor). Buyers browse and order; sellers list
products and manage orders; an admin oversees users, products and revenue.

## Tech stack

| Layer     | Tech |
|-----------|------|
| Frontend  | Vanilla HTML / CSS / JavaScript (no build step) |
| Backend   | Node.js, Express |
| Database  | MongoDB (Mongoose) |
| Auth      | JWT (Bearer tokens) + bcrypt password hashing |
| Email     | Nodemailer (Gmail) for OTP + order emails |
| AI        | Google Gemini API (free tier) for the on-site assistant chatbox |
| Uploads   | Multer (image-only, 5 MB cap) |

## Features

- Email/OTP signup, JWT login, role-based access (**buyer / seller / admin**)
- Product catalogue with search, categories and per-seller shops
- Cart (sessionStorage, keyed by product id) and wishlist (localStorage)
- Checkout → orders (Cash on Delivery), with **server-side price & stock validation**
- Product **reviews & ratings** (one per user, aggregate recomputed on submit)
- Seller dashboard (add / remove products with image upload)
- Admin dashboard (users, products, orders, revenue stats)

## Project structure

```
6-sem-project/
├── index.html, product.html, Collection.html, cart.html,
│   wishlist.html, checkout.html, login.html, profile.html,
│   sell.html, seller.html, seller-dashboard.html, admin.html
├── api.js          # API client + auth helpers + imgUrl()
├── script.js       # toast, cart, wishlist, shared product-card rendering
├── style.css
├── Images/         # static catalogue images + placeholder.svg
└── backend/
    ├── server.js
    ├── seed.js     # seeds the artisan seller + canonical catalogue
    ├── config/db.js
    ├── middleware/ # auth.js (protect/adminOnly/sellerOrAdmin), upload.js
    ├── models/     # User, Product, Order, Review
    ├── routes/     # auth, products (+reviews), orders, admin
    └── utils/mailer.js
```

## Getting started

### 1. Backend

```bash
cd backend
cp .env.example .env        # then fill in real values (see below)
npm install
npm run seed                # inserts the artisan seller + sample products
npm run dev                 # starts the API on http://localhost:5000
```

`.env` keys (see `.env.example`):

| Key | Purpose |
|-----|---------|
| `PORT` | API port (default 5000) |
| `CLIENT_URL` | Allowed CORS origin (your frontend URL, e.g. http://localhost:5500) |
| `MONGO_URI` | MongoDB connection string |
| `JWT_SECRET` | Long random string used to sign tokens |
| `EMAIL_USER` / `EMAIL_PASS` | Gmail address + **App Password** for OTP mail |
| `GEMINI_API_KEYS` | API key(s) from aistudio.google.com/apikey for the assistant chatbox — comma-separated for round-robin + fallback across multiple keys |
| `SEED_SECRET` | Secret required to bootstrap the first admin |

### 2. Frontend

The frontend is plain static files. Serve the project root with any static
server — e.g. the VS Code **Live Server** extension (defaults to port 5500).
Make sure the URL matches `CLIENT_URL` in `.env` so CORS allows it.

`api.js` points at `http://localhost:5000`; change `API_ORIGIN` there if your
backend runs elsewhere.

### 3. Create the admin account (once)

`seed-admin` is gated by `SEED_SECRET` so it cannot be called by the public:

```bash
curl -X POST http://localhost:5000/api/admin/seed-admin \
  -H "Content-Type: application/json" \
  -d '{"secret":"<your SEED_SECRET>","email":"admin@craftnext.com","password":"<choose-a-strong-one>"}'
```

### Seeded accounts

`npm run seed` creates the artisan seller (override via `SEED_SELLER_EMAIL` /
`SEED_SELLER_PASSWORD`):

- **Seller:** `archana@craftnext.com` / `artisan123` — change this for anything public.

## API reference

| Method | Endpoint | Access | Notes |
|--------|----------|--------|-------|
| POST | `/api/auth/register` | public | sends OTP |
| POST | `/api/auth/verify-otp` | public | |
| POST | `/api/auth/login` | public | rate-limited |
| GET  | `/api/auth/me` | token | |
| PUT  | `/api/auth/profile` | token | |
| GET  | `/api/products` | public | `?category=&search=&seller=` |
| GET  | `/api/products/:id` | public | |
| POST | `/api/products` | seller/admin | multipart, image upload |
| PUT/DELETE | `/api/products/:id` | owner/admin | |
| GET  | `/api/products/:id/reviews` | public | |
| POST | `/api/products/:id/reviews` | token | one per user (upsert) |
| POST | `/api/orders` | token | price/stock validated server-side |
| GET  | `/api/orders/myorders` | token | |
| GET  | `/api/orders/seller` | token | |
| GET  | `/api/orders/:id` | owner/seller/admin | |
| PUT  | `/api/orders/:id/status` | seller/admin | |
| GET  | `/api/admin/stats\|users\|orders\|products` | admin | |
| POST | `/api/chat` | public | rate-limited (20/15min), calls Gemini API |

## Security notes

- `.env` is **git-ignored** — never commit real secrets. If a secret was ever
  committed (it was, in early history), **rotate it**: MongoDB password and
  `JWT_SECRET`. Removing the file does not undo a
  past leak; scrub history with `git filter-repo` if the repo is shared/public.
- Order totals, item prices, names and sellers are always rebuilt from the DB —
  the client cannot set its own price.
- Uploads accept images only (≤ 5 MB) since `/uploads` is served statically.

## Known limitations / not implemented

- Online payment is a stub — only **Cash on Delivery** is wired up.
- No product pagination (the catalogue is intentionally small).
- Cart lives in `sessionStorage` and wishlist in `localStorage`, both not synced to the account.
