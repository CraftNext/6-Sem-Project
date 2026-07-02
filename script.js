/* ================= TOAST NOTIFICATIONS ================= */

function showToast(message, type = "info") {
    let container = document.getElementById("toast-container");
    if (!container) {
        container = document.createElement("div");
        container.id = "toast-container";
        document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    const icon = type === "success" ? "✓" : type === "error" ? "✕" : "ℹ";
    toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => toast.remove(), 3000);
}


/* ================= CART CORE =================
   Items are keyed by product id (string) so DB products (ObjectId)
   and any seeded products share one stable identity.
   Item shape: { id, name, price, img, seller, qty }                     */

const CART_BOOT_KEY = "craftnext-cart-boot";

if (!window.name.startsWith(CART_BOOT_KEY)) {
    window.name = `${CART_BOOT_KEY}:${Date.now()}`;
    sessionStorage.removeItem("cart");
}

function getCart() {
    try {
        const data = JSON.parse(sessionStorage.getItem("cart")) || [];
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

function saveCart(cart) {
    sessionStorage.setItem("cart", JSON.stringify(cart));
}

function productId(product) {
    return String(product._id ?? product.id ?? "");
}

function addToCart(product) {
    const id = productId(product);
    if (!id || !product.name || product.price == null) {
        console.warn("Invalid product blocked:", product);
        showToast("Product data invalid — not added", "error");
        return;
    }

    const cart = getCart();
    const found = cart.find(p => p.id === id);

    if (found) {
        found.qty += 1;
    } else {
        cart.push({
            id,
            name: product.name,
            price: Number(product.price),
            img: product.img || "",
            seller: product.seller || product.sellerName || "",
            qty: 1
        });
    }

    saveCart(cart);
    updateCartCount();
    showToast("Added to cart!", "success");
}

function removeFromCart(id) {
    const cart = getCart().filter(p => p.id !== String(id));
    saveCart(cart);
    if (typeof renderCart === "function") renderCart();
    updateCartCount();
}


/* ================= CART COUNT ================= */

function updateCartCount() {
    const cart = getCart();
    const count = cart.reduce((total, item) => total + (Number(item.qty) || 0), 0);
    const el = document.getElementById("cartCount");
    if (el) el.innerText = count;
}

document.addEventListener("DOMContentLoaded", updateCartCount);


/* ================= WISHLIST SYSTEM =================
   Stored as an array of product id strings.                              */

function getWishlist() {
    try {
        const raw = JSON.parse(localStorage.getItem("wishlist")) || [];
        return Array.isArray(raw) ? raw.map(String) : [];
    } catch {
        return [];
    }
}

function saveWishlist(list) {
    localStorage.setItem("wishlist", JSON.stringify(list));
}

function toggleWishlist(id) {
    id = String(id);
    if (!id) return;
    let list = getWishlist();

    if (list.includes(id)) {
        list = list.filter(x => x !== id);
        showToast("Removed from wishlist", "info");
    } else {
        list.push(id);
        showToast("Added to wishlist!", "success");
    }

    saveWishlist(list);
    updateHeartIcons(id);
}

function updateHeartIcons(id) {
    id = String(id);
    const list = getWishlist();
    document.querySelectorAll(`.wish[data-id="${id}"]`).forEach(heart => {
        heart.classList.toggle("active", list.includes(id));
    });
}

function isWishlisted(id) {
    return getWishlist().includes(String(id));
}

function renderWishlistIcons() {
    const list = getWishlist();
    document.querySelectorAll(".wish").forEach(el => {
        el.classList.toggle("active", list.includes(String(el.dataset.id)));
    });
}


/* ================= GLOBAL HEART CLICK ================= */

document.addEventListener("click", function(e) {
    if (e.target.classList.contains("wish")) {
        e.preventDefault();
        e.stopPropagation();
        toggleWishlist(e.target.dataset.id);
    }
});


/* ================= INITIAL LOAD ================= */

document.addEventListener("DOMContentLoaded", renderWishlistIcons);


/* ================= SHARED PRODUCT RENDERING =================
   Used by index / collection / wishlist so the product card and
   Add-to-Cart behaviour stay identical everywhere.                       */

const _productCache = {};

function cacheProducts(list) {
    (list || []).forEach(p => { _productCache[String(p._id ?? p.id)] = p; });
}

function esc(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function starString(rating) {
    const r = Math.max(0, Math.min(5, Math.round(Number(rating) || 5)));
    return "★".repeat(r) + "☆".repeat(5 - r);
}

// Standard product card markup. Call cacheProducts(list) first so the
// delegated Add-to-Cart handler can find the full product object by id.
function productCardHTML(p) {
    const id = String(p._id ?? p.id);
    const price = Number(p.price).toLocaleString("en-IN");

    const sellerId = (p.seller && p.seller._id) ? p.seller._id : p.seller;
    const sellerLabel = esc(p.sellerName || (p.seller && (p.seller.shopName || p.seller.name)) || "Seller");
    const sellerHTML = sellerId
        ? `<a href="seller.html?seller=${esc(sellerId)}">${sellerLabel}</a>`
        : sellerLabel;

    return `
        <span class="wish" data-id="${id}" role="button" aria-label="Toggle wishlist" tabindex="0">♥</span>
        <a href="product.html?id=${id}" class="card-link">
            <img src="${esc(imgUrl(p.img))}" alt="${esc(p.name)}" loading="lazy"
                 onerror="this.onerror=null;this.src='Images/placeholder.svg'">
        </a>
        <h4><a href="product.html?id=${id}">${esc(p.name)}</a></h4>
        <p>By ${sellerHTML}</p>
        <div class="rating">${starString(p.rating)}</div>
        <span class="price">₹${price}</span>
        <button class="add-btn" data-pid="${id}">Add to Cart</button>`;
}

// Delegated Add-to-Cart for any .add-btn rendered from a cached product.
document.addEventListener("click", function (e) {
    const btn = e.target.closest && e.target.closest(".add-btn");
    if (!btn) return;
    const p = _productCache[btn.dataset.pid];
    if (p) addToCart(p);
});

// Keyboard activation for wishlist hearts (a11y).
document.addEventListener("keydown", function (e) {
    if ((e.key === "Enter" || e.key === " ") &&
        e.target.classList && e.target.classList.contains("wish")) {
        e.preventDefault();
        toggleWishlist(e.target.dataset.id);
    }
});


/* ================= AI ASSISTANT WIDGET =================
   Self-injects only on pages that have the floating cart button,
   stacked directly above it.                                          */

function initAssistantWidget() {
    const cartBtn = document.querySelector(".floating-cart");
    if (!cartBtn || document.getElementById("assistantWidget")) return;

    const wrap = document.createElement("div");
    wrap.id = "assistantWidget";
    wrap.innerHTML = `
        <button id="assistantToggle" class="assistant-toggle" aria-label="Chat with CraftNext Assistant">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
        </button>
        <div id="assistantPanel" class="assistant-panel" style="display:none">
            <div class="assistant-header">
                <span>CraftNext Assistant</span>
                <button id="assistantClose" aria-label="Close chat">&times;</button>
            </div>
            <div id="assistantMessages" class="assistant-messages">
                <div class="assistant-msg assistant-msg-bot">Hi! I can help you find products, explain how ordering works, or answer questions about CraftNext. What do you need?</div>
            </div>
            <form id="assistantForm" class="assistant-input-row">
                <input type="text" id="assistantInput" placeholder="Ask me anything..." autocomplete="off" maxlength="1000">
                <button type="submit" aria-label="Send">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7Z"/></svg>
                </button>
            </form>
        </div>`;
    document.body.appendChild(wrap);

    const panel = document.getElementById("assistantPanel");
    const toggle = document.getElementById("assistantToggle");
    const messagesEl = document.getElementById("assistantMessages");
    const form = document.getElementById("assistantForm");
    const input = document.getElementById("assistantInput");

    let history = [];
    let sending = false;

    function openPanel() {
        panel.style.display = "flex";
        input.focus();
    }
    function closePanel() {
        panel.style.display = "none";
    }

    toggle.addEventListener("click", () => {
        panel.style.display === "flex" ? closePanel() : openPanel();
    });
    document.getElementById("assistantClose").addEventListener("click", closePanel);

    function addMessage(text, who) {
        const div = document.createElement("div");
        div.className = `assistant-msg assistant-msg-${who}`;
        div.textContent = text;
        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
        return div;
    }

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (sending) return;

        const text = input.value.trim();
        if (!text) return;

        input.value = "";
        addMessage(text, "user");
        const thinkingEl = addMessage("...", "bot");
        thinkingEl.classList.add("assistant-thinking");
        sending = true;

        try {
            const data = await Chat.send(text, history);
            thinkingEl.remove();
            addMessage(data.reply, "bot");
            history.push({ role: "user", content: text });
            history.push({ role: "assistant", content: data.reply });
            if (history.length > 20) history = history.slice(-20);
        } catch (err) {
            thinkingEl.remove();
            addMessage(err.message || "Sorry, I'm having trouble responding right now.", "bot");
        } finally {
            sending = false;
        }
    });
}

document.addEventListener("DOMContentLoaded", initAssistantWidget);
