/* =============================================
   CraftNext — Frontend API Helper
   All calls to the backend go through here
   ============================================= */

const API_BASE = "http://localhost:5000/api";

/* ——— AUTH HELPERS ——— */

function getToken() {
  return localStorage.getItem("cn_token");
}

function getUser() {
  try {
    return JSON.parse(localStorage.getItem("cn_user")) || null;
  } catch {
    return null;
  }
}

function saveAuth(data) {
  localStorage.setItem("cn_token", data.token);
  localStorage.setItem("cn_user", JSON.stringify(data));
}

function clearAuth() {
  localStorage.removeItem("cn_token");
  localStorage.removeItem("cn_user");
}

function isLoggedIn() {
  return !!getToken();
}

function isRole(role) {
  const u = getUser();
  return u && u.role === role;
}

/* ——— GENERIC FETCH WRAPPER ——— */

async function apiRequest(endpoint, method = "GET", body = null, auth = false) {
  const headers = { "Content-Type": "application/json" };

  if (auth) {
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(API_BASE + endpoint, options);
  const data = await res.json();

  if (!res.ok) throw new Error(data.message || "Request failed");
  return data;
}

/* ——— AUTH ——— */

const Auth = {
  register: (payload) => apiRequest("/auth/register", "POST", payload),
  login: (email, password) => apiRequest("/auth/login", "POST", { email, password }),
  me: () => apiRequest("/auth/me", "GET", null, true),
  updateProfile: (payload) => apiRequest("/auth/profile", "PUT", payload, true),
  logout() {
    clearAuth();
    window.location.href = "login.html";
  },
};

/* ——— PRODUCTS ——— */

const Products = {
  getAll: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiRequest(`/products${q ? "?" + q : ""}`);
  },
  getById: (id) => apiRequest(`/products/${id}`),
  create: (payload) => apiRequest("/products", "POST", payload, true),
  update: (id, payload) => apiRequest(`/products/${id}`, "PUT", payload, true),
  delete: (id) => apiRequest(`/products/${id}`, "DELETE", null, true),
};

/* ——— ORDERS ——— */

const Orders = {
  create: (payload) => apiRequest("/orders", "POST", payload, true),
  myOrders: () => apiRequest("/orders/myorders", "GET", null, true),
  sellerOrders: () => apiRequest("/orders/seller", "GET", null, true),
  getById: (id) => apiRequest(`/orders/${id}`, "GET", null, true),
  updateStatus: (id, status) => apiRequest(`/orders/${id}/status`, "PUT", { status }, true),
};

/* ——— ADMIN ——— */

const Admin = {
  stats: () => apiRequest("/admin/stats", "GET", null, true),
  users: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiRequest(`/admin/users${q ? "?" + q : ""}`, "GET", null, true);
  },
  updateUser: (id, payload) => apiRequest(`/admin/users/${id}`, "PUT", payload, true),
  deleteUser: (id) => apiRequest(`/admin/users/${id}`, "DELETE", null, true),
  orders: () => apiRequest("/admin/orders", "GET", null, true),
  products: () => apiRequest("/admin/products", "GET", null, true),
  seedAdmin: () => apiRequest("/admin/seed-admin", "POST", null, true),
};

/* ——— UPDATE NAVBAR BASED ON LOGIN STATE ——— */

function updateNavbar() {
  const user = getUser();
  const loginLinks = document.querySelectorAll("a[href='login.html']");

  loginLinks.forEach((link) => {
    if (user) {
      link.textContent = user.name.split(" ")[0];
      link.href = user.role === "admin" ? "admin.html" :
                  user.role === "seller" ? "seller-dashboard.html" : "profile.html";
    }
  });

  // Show/hide sell link for buyers
  const sellLinks = document.querySelectorAll("a[href='sell.html']");
  if (user && user.role === "buyer") {
    sellLinks.forEach(l => l.style.display = "none");
  }
}

document.addEventListener("DOMContentLoaded", updateNavbar);
