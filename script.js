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
            seller: product.sellerName || (typeof product.seller === "string" ? product.seller : ""),
            qty: 1
        });
    }

    saveCart(cart);
    updateCartCount();
    showToast("Added to cart!", "success");
    toggleCartDrawer(true);
}

function removeFromCart(id) {
    const cart = getCart().filter(p => p.id !== String(id));
    saveCart(cart);
    updateCartCount();
    renderCartDrawer();
    if (typeof renderCart === "function") renderCart();
}

function changeCartQty(id, delta) {
    const cart = getCart();
    const found = cart.find(p => p.id === String(id));
    if (found) {
        found.qty += delta;
        if (found.qty <= 0) {
            removeFromCart(id);
            return;
        }
    }
    saveCart(cart);
    updateCartCount();
    renderCartDrawer();
    if (typeof renderCart === "function") renderCart();
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


/* ================= CART DRAWER RENDERING & ANIMATION ================= */

function renderCartDrawer() {
    const cart = getCart();
    const itemsContainer = document.getElementById("cartDrawerItems");
    const subtotalContainer = document.getElementById("cartDrawerSubtotal");
    if (!itemsContainer) return;

    if (cart.length === 0) {
        itemsContainer.innerHTML = `
            <div class="cart-drawer-empty" style="text-align:center;padding:48px 24px;color:var(--muted)">
                <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:48px;height:48px;margin-bottom:12px;opacity:0.6"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
                <p style="font-size:14.5px;">Your cart is empty</p>
            </div>`;
        if (subtotalContainer) subtotalContainer.innerText = "₹0";
        return;
    }

    let subtotal = 0;
    itemsContainer.innerHTML = cart.map(item => {
        const itemTotal = item.price * item.qty;
        subtotal += itemTotal;
        return `
            <div class="cart-drawer-item">
                <img src="${imgUrl(item.img)}" alt="${esc(item.name)}" onerror="this.onerror=null;this.src='Images/placeholder.svg'">
                <div class="cart-drawer-item-info">
                    <h4>${esc(item.name)}</h4>
                    <p class="cart-drawer-item-seller">By ${esc(item.seller || "Seller")}</p>
                    <div class="cart-drawer-item-meta">
                        <div class="qty-adjuster">
                            <button onclick="changeCartQty('${item.id}', -1)">-</button>
                            <span>${item.qty}</span>
                            <button onclick="changeCartQty('${item.id}', 1)">+</button>
                        </div>
                        <span class="cart-drawer-item-price">₹${itemTotal.toLocaleString("en-IN")}</span>
                    </div>
                </div>
                <button class="cart-drawer-item-remove" onclick="removeFromCart('${item.id}')" aria-label="Remove item">&times;</button>
            </div>`;
    }).join("");

    if (subtotalContainer) subtotalContainer.innerText = "₹" + subtotal.toLocaleString("en-IN");
}

function toggleCartDrawer(show = true) {
    const drawer = document.getElementById("cartDrawer");
    const backdrop = document.getElementById("cartDrawerBackdrop");
    if (!drawer || !backdrop) return;

    if (show) {
        renderCartDrawer();
        drawer.style.display = "flex";
        backdrop.style.display = "block";
        setTimeout(() => {
            drawer.classList.add("open");
            backdrop.classList.add("open");
        }, 10);
    } else {
        drawer.classList.remove("open");
        backdrop.classList.remove("open");
        setTimeout(() => {
            drawer.style.display = "none";
            backdrop.style.display = "none";
        }, 300);
    }
}

/* ================= INITIAL LOAD ================= */

document.addEventListener("DOMContentLoaded", () => {
    renderWishlistIcons();
    
    // Inject Cart Drawer Markup dynamically if not already present
    if (!document.getElementById("cartDrawer")) {
        const backdrop = document.createElement("div");
        backdrop.id = "cartDrawerBackdrop";
        backdrop.className = "cart-drawer-backdrop";
        backdrop.addEventListener("click", () => toggleCartDrawer(false));
        
        const drawer = document.createElement("div");
        drawer.id = "cartDrawer";
        drawer.className = "cart-drawer";
        drawer.style.display = "none";
        drawer.innerHTML = `
            <div class="cart-drawer-header">
                <h3>Shopping Cart</h3>
                <button class="cart-drawer-close" id="cartDrawerClose">&times;</button>
            </div>
            <div class="cart-drawer-items" id="cartDrawerItems"></div>
            <div class="cart-drawer-footer">
                <div class="cart-drawer-subtotal">
                    <span>Subtotal</span>
                    <span id="cartDrawerSubtotal">₹0</span>
                </div>
                <button class="cart-drawer-checkout-btn" onclick="location.href='checkout.html'">Proceed to Checkout</button>
            </div>`;
        
        document.body.appendChild(backdrop);
        document.body.appendChild(drawer);

        document.getElementById("cartDrawerClose").addEventListener("click", () => toggleCartDrawer(false));
    }

    // Intercept clicks on any Cart link or Cart buttons to open sliding drawer
    document.addEventListener("click", (e) => {
        const target = e.target.closest("a[href='cart.html'], .floating-cart");
        if (target) {
            e.preventDefault();
            toggleCartDrawer(true);
        }
    });
});


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

    let badgeHTML = "";
    if (p.bestSeller) {
        badgeHTML = `<span class="badge badge-best">Bestseller</span>`;
    } else if (p.newArrival) {
        badgeHTML = `<span class="badge badge-new">New</span>`;
    }

    return `
        <span class="wish" data-id="${id}" role="button" aria-label="Toggle wishlist" tabindex="0">♥</span>
        ${badgeHTML}
        <a href="product.html?id=${id}" class="card-link">
            <div class="card-image-wrapper">
                <img src="${esc(imgUrl(p.img))}" alt="${esc(p.name)}" loading="lazy"
                     onerror="this.onerror=null;this.src='Images/placeholder.svg'">
            </div>
        </a>
        <div class="card-details">
            <h4><a href="product.html?id=${id}">${esc(p.name)}</a></h4>
            <p>By ${sellerHTML}</p>
            <div class="rating">${starString(p.rating)}</div>
            <div class="card-price-row">
                <span class="price">₹${price}</span>
                <button class="add-btn" data-pid="${id}">Add to Cart</button>
            </div>
        </div>`;
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
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
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
        if (who === "bot") {
            div.innerHTML = parseBotMessage(text);
        } else {
            div.textContent = text;
        }
        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
        return div;
    }

    function showTypingIndicator() {
        const div = document.createElement("div");
        div.className = "assistant-msg assistant-msg-bot assistant-thinking";
        div.innerHTML = `
            <div class="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
            </div>
        `;
        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
        return div;
    }

    function renderChips() {
        const existing = document.querySelector(".assistant-chips");
        if (existing) existing.remove();

        const chipsWrap = document.createElement("div");
        chipsWrap.className = "assistant-chips";
        
        const suggestions = [
            { text: "🎨 Recommend Art", query: "Can you recommend some paintings or crafts?" },
            { text: "🎁 Coupon Codes", query: "What active coupon codes are available?" },
            { text: "🚚 Shipping Policy", query: "How does shipping work?" },
            { text: "🛒 View My Cart", query: "Show me my current shopping cart." }
        ];

        suggestions.forEach(s => {
            const btn = document.createElement("button");
            btn.className = "assistant-chip";
            btn.textContent = s.text;
            btn.type = "button";
            btn.addEventListener("click", () => {
                input.value = s.query;
                form.dispatchEvent(new Event("submit"));
            });
            chipsWrap.appendChild(btn);
        });

        messagesEl.appendChild(chipsWrap);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function parseBotMessage(text) {
        let html = esc(text);

        // 0. Parse markdown images: ![alt](url)
        html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
            return `<img src="${imgUrl(url)}" alt="${esc(alt)}" style="width:36px;height:36px;object-fit:cover;border-radius:4px;vertical-align:middle;margin-right:8px;border:1px solid var(--line);">`;
        });

        // 1. Bold text: **text**
        html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

        // 2. Links: [text](url)
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, linkText, url) => {
            if (/^(product\.html\?id=[a-zA-Z0-9_-]+|index\.html|cart\.html|contact\.html|Collection\.html)$/.test(url)) {
                return `<a href="${url}" style="color:var(--accent);font-weight:600;text-decoration:underline;">${linkText}</a>`;
            }
            return match;
        });

        // 3. Bullet lists: Lines starting with "- " or "* "
        const lines = html.split("\n");
        let inList = false;
        const processedLines = [];

        lines.forEach(line => {
            const trimmed = line.trim();
            if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
                if (!inList) {
                    processedLines.push('<ul style="margin: 6px 0; padding-left: 18px;">');
                    inList = true;
                }
                processedLines.push(`<li style="margin-bottom: 4px;">${trimmed.substring(2)}</li>`);
            } else {
                if (inList) {
                    processedLines.push("</ul>");
                    inList = false;
                }
                processedLines.push(line);
            }
        });
        if (inList) {
            processedLines.push("</ul>");
        }

        return processedLines.join("<br>");
    }

    // Initial render of chips
    renderChips();

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (sending) return;

        const text = input.value.trim();
        if (!text) return;

        // Remove suggestions chips during active chat turn
        const existing = document.querySelector(".assistant-chips");
        if (existing) existing.remove();

        input.value = "";
        addMessage(text, "user");
        const thinkingEl = showTypingIndicator();
        sending = true;

        try {
            const data = await Chat.send(text, history, getCart());
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
            // Re-render chips to prompt next interaction
            renderChips();
        }
    });
}

document.addEventListener("DOMContentLoaded", initAssistantWidget);

/* ================= AUTOCOMPLETE SEARCH ================= */

function initAutocompleteSearch() {
  const searchInput = document.getElementById("searchInput");
  if (!searchInput) return;

  searchInput.setAttribute("autocomplete", "off");

  // Create suggestions box
  let suggestionsBox = document.getElementById("searchSuggestions");
  if (!suggestionsBox) {
    suggestionsBox = document.createElement("div");
    suggestionsBox.id = "searchSuggestions";
    suggestionsBox.className = "search-suggestions";
    searchInput.parentNode.appendChild(suggestionsBox);
  }

  let products = null;

  searchInput.addEventListener("focus", async () => {
    if (!products) {
      try {
        products = await Products.getAll();
      } catch (err) {
        products = [];
      }
    }
  });

  searchInput.addEventListener("input", () => {
    const q = searchInput.value.trim().toLowerCase();
    if (!q || !products) {
      suggestionsBox.style.display = "none";
      return;
    }

    const matches = products.filter(p =>
      (p.name || "").toLowerCase().includes(q) ||
      (p.sellerName || "").toLowerCase().includes(q) ||
      (p.category || "").toLowerCase().includes(q)
    ).slice(0, 5);

    if (matches.length === 0) {
      suggestionsBox.style.display = "none";
      return;
    }

    suggestionsBox.innerHTML = matches.map(p => `
      <div class="search-suggestion-item" data-pid="${p._id || p.id}">
        <img src="${esc(imgUrl(p.img))}" onerror="this.onerror=null;this.src='Images/placeholder.svg'">
        <span class="suggestion-name">${esc(p.name)}</span>
        <span class="suggestion-price">₹${Number(p.price).toLocaleString("en-IN")}</span>
      </div>
    `).join("");

    suggestionsBox.style.display = "block";
  });

  suggestionsBox.addEventListener("click", (e) => {
    const item = e.target.closest(".search-suggestion-item");
    if (item) {
      window.location.href = `product.html?id=${item.dataset.pid}`;
    }
  });

  document.addEventListener("click", (e) => {
    if (e.target !== searchInput && e.target !== suggestionsBox && !suggestionsBox.contains(e.target)) {
      suggestionsBox.style.display = "none";
    }
  });
}

document.addEventListener("DOMContentLoaded", initAutocompleteSearch);
