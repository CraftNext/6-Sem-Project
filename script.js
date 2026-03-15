/* ================= CART CORE ================= */

function getCart() {

    try {

        const data = JSON.parse(localStorage.getItem("cart")) || [];

        return Array.isArray(data) ? data : [];

    } catch {

        return [];

    }

}

function saveCart(cart) {

    localStorage.setItem("cart", JSON.stringify(cart));

}



/* ================= ADD TO CART ================= */

function addToCart(product) {

    if (!product || !product.name || !product.price || !product.img) {

        console.warn("Invalid product blocked:", product);

        alert("Product data invalid — not added");

        return;

    }

    const cart = getCart();

    const found = cart.find(p => p.name === product.name);

    if (found) {

        found.qty += 1;

    } else {

        cart.push({

            name: product.name,

            price: Number(product.price),

            img: product.img,

            seller: product.seller || product.sellerName || "",

            qty: 1

        });

    }

    saveCart(cart);

    updateCartCount();

    alert("Added to cart!");

}



/* ================= REMOVE FROM CART ================= */

function removeFromCart(name) {

    const cart = getCart().filter(p => p.name !== name);

    saveCart(cart);

    if (typeof renderCart === "function") {

        renderCart();

    }

    updateCartCount();

}



/* ================= CART COUNT ================= */

function updateCartCount() {

    const cart = getCart();

    const count = cart.reduce((total, item) => {

        return total + (Number(item.qty) || 0);

    }, 0);

    const el = document.getElementById("cartCount");

    if (el) el.innerText = count;

}

document.addEventListener("DOMContentLoaded", updateCartCount);



/* ================= WISHLIST SYSTEM ================= */

function getWishlist() {

    const raw = JSON.parse(localStorage.getItem("wishlist")) || [];

    return raw.map(Number);

}

function saveWishlist(list) {

    localStorage.setItem("wishlist", JSON.stringify(list));

}



/* ================= TOGGLE WISHLIST ================= */

function toggleWishlist(id) {

    if (typeof id !== "number") return;   // MongoDB products ignored

    let list = getWishlist();

    if (list.includes(id)) {

        list = list.filter(x => x !== id);

    } else {

        list.push(id);

    }

    saveWishlist(list);

    updateHeartIcons(id);

}



/* ================= UPDATE HEART ICONS ================= */

function updateHeartIcons(id) {

    const list = getWishlist();

    document.querySelectorAll(`.wish[data-id="${id}"]`).forEach(heart => {

        if (list.includes(id)) {

            heart.classList.add("active");

        } else {

            heart.classList.remove("active");

        }

    });

}



/* ================= CHECK IF WISHLISTED ================= */

function isWishlisted(id) {

    if (typeof id !== "number") return false;

    return getWishlist().includes(id);

}



/* ================= RENDER HEARTS ================= */

function renderWishlistIcons() {

    const list = getWishlist();

    document.querySelectorAll(".wish").forEach(el => {

        const id = Number(el.dataset.id);

        if (list.includes(id)) {

            el.classList.add("active");

        } else {

            el.classList.remove("active");

        }

    });

}



/* ================= GLOBAL HEART CLICK ================= */

document.addEventListener("click", function(e) {

    if (e.target.classList.contains("wish")) {

        e.preventDefault();

        e.stopPropagation();

        const id = Number(e.target.dataset.id);

        toggleWishlist(id);

    }

});



/* ================= INITIAL LOAD ================= */

document.addEventListener("DOMContentLoaded", renderWishlistIcons);