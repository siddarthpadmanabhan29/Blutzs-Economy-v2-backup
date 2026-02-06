// ---------- cosmetics.js (QUOTA OPTIMIZED) ----------
console.log("cosmetics.js loaded");

import { db, auth } from "./firebaseConfig.js";
import {
  doc, getDoc, updateDoc,
  collection, getDocs, addDoc
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// ---------- Elements ----------
const cosmeticsShopEl = document.getElementById("cosmetics-shop-items");
const dashboardNavbar = document.getElementById("dashboard-navbar");

// ---------- CACHE COSMETICS ----------
let cosmeticsCache = null;
let localUserData = null; // Store local user state to avoid redundant reads

/**
 * Optimized Load: Uses getDocs for items (read once)
 */
async function getCosmeticsMap() {
  if (cosmeticsCache) return cosmeticsCache;

  // ONE-TIME FETCH: Instead of a live listener, we fetch the catalog once.
  const snap = await getDocs(collection(db, "cosmeticsShop"));
  cosmeticsCache = {};
  snap.forEach(d => cosmeticsCache[d.id] = { ...d.data(), id: d.id });
  return cosmeticsCache;
}

// ---------- THEME ----------
function applySavedTheme() {
  const savedTheme = localStorage.getItem("theme");
  if (savedTheme === "dark") {
    document.body.classList.add("dark-mode");
    document.body.classList.remove("light-mode");
  } else if (savedTheme === "light") {
    document.body.classList.add("light-mode");
    document.body.classList.remove("dark-mode");
  }
}
applySavedTheme();

// ---------- APPLY NAVBAR COLOR (OWNERSHIP SAFE + AUTO RESET) ----------
async function applyNavbarFromFirestore(userData, cosmeticsMap) {
  if (!dashboardNavbar || !userData) return;

  let navbarColor = "#3498db"; // default
  let validEquipped = false;

  if (userData.navbarColor && cosmeticsMap) {
    for (const [id, item] of Object.entries(cosmeticsMap)) {
      if (
        item.type === "navbarColor" &&
        item.color === userData.navbarColor &&
        userData.cosmeticsOwned?.[id] === true
      ) {
        validEquipped = true;
        break;
      }
    }
  }

  if (validEquipped) {
    navbarColor = userData.navbarColor;
  } else if (userData.navbarColor) {
    // Admin removed cosmetic → reset equipped
    const userRef = doc(db, "users", auth.currentUser.uid);
    await updateDoc(userRef, { navbarColor: "" }).catch(console.error);
  }

  dashboardNavbar.style.backgroundColor = navbarColor;
  localStorage.setItem("navbarColor", navbarColor);
}

// ---------- LOAD COSMETICS ----------
/**
 * Renders the UI based on passed userData or local state.
 * No database reads happen inside the loop.
 */
async function loadCosmetics(userData = null) {
  if (!auth.currentUser || !cosmeticsShopEl) return;

  // Use passed data from dashboard.js master listener if available
  if (userData) {
    localUserData = userData;
  }

  // If we still have no data, fetch once (cold start fallback)
  if (!localUserData) {
    const userRef = doc(db, "users", auth.currentUser.uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      cosmeticsShopEl.innerHTML = "<p class='text-error'>User data not found.</p>";
      return;
    }
    localUserData = userSnap.data();
  }

  if (!localUserData.cosmeticsOwned) localUserData.cosmeticsOwned = {};

  const cosmeticsMap = await getCosmeticsMap();

  // Apply navbar safely
  await applyNavbarFromFirestore(localUserData, cosmeticsMap);

  // ---------- ACCESS CHECK ----------
  const now = new Date();
  const expirationDate = localUserData.expirationDate ? new Date(localUserData.expirationDate) : null;
  const canAccess = !localUserData.renewalPending && expirationDate && expirationDate > now;

  if (!canAccess) {
    cosmeticsShopEl.innerHTML =
      "<p class='text-muted'>Your ID is expired or renewal pending. Cannot access cosmetics.</p>";
    return;
  }

  cosmeticsShopEl.innerHTML = "";

  Object.entries(cosmeticsMap).forEach(([docId, item]) => {
    const owned = localUserData.cosmeticsOwned[docId] === true;
    const equipped =
      item.type === "navbarColor" &&
      localUserData.navbarColor &&
      item.color === localUserData.navbarColor;

    const div = document.createElement("div");
    div.className = `cosmetic-item ${owned ? "owned" : ""} ${equipped ? "equipped" : ""}`;
    div.dataset.id = docId;

    let actionHTML = "";

    if (!owned) {
      actionHTML = `
        <button class="btn-primary buy-cosmetic" data-id="${docId}">Buy</button>
      `;
    } else if (item.feature || item.type === "navbarColor") {
      if (equipped) {
        actionHTML = `<div class="equipped-badge">Applied</div>`;
      } else {
        actionHTML = `
          <button class="btn-secondary cosmetic-feature" data-id="${docId}">Apply</button>
        `;
      }
    }

    div.innerHTML = `
      <div class="shop-item-image" style="background:${item.color || '#151525'};">
        ${item.img ? `<img src="${item.img}" alt="${item.name}" onerror="this.src='https://via.placeholder.com/64?text=No+Image'">` : ""}
      </div>
      <div class="shop-item-info">
        <h4>${item.name}</h4>
        <p>${item.description || ""}</p>
        <div class="cosmetic-price">$${Number(item.price).toLocaleString()}</div>
        ${actionHTML}
      </div>
    `;

    cosmeticsShopEl.appendChild(div);
  });
}

// ---------- BUY & APPLY ----------
cosmeticsShopEl.addEventListener("click", async (e) => {
  const btn = e.target;
  const user = auth.currentUser;
  if (!user) return;

  // ----- BUY -----
  if (btn.classList.contains("buy-cosmetic")) {
    const itemId = btn.dataset.id;
    // Accuracy check: get current state only on click
    const [userSnap, itemSnap] = await Promise.all([
        getDoc(doc(db, "users", user.uid)),
        getDoc(doc(db, "cosmeticsShop", itemId))
    ]);

    if (!itemSnap.exists()) return alert("Item not found!");

    const item = itemSnap.data();
    const userData = userSnap.data();
    const balance = Number(userData.balance || 0);

    if (balance < item.price) return alert("Insufficient funds!");

    try {
      const newCosmetics = { ...(userData.cosmeticsOwned || {}), [itemId]: true };

      await updateDoc(doc(db, "users", user.uid), {
        balance: balance - item.price,
        cosmeticsOwned: newCosmetics
      });

      // Update local state for immediate re-render
      localUserData.balance = balance - item.price;
      localUserData.cosmeticsOwned = newCosmetics;
      loadCosmetics();

      const historyRef = collection(db, "users", user.uid, "history_logs");
      await addDoc(historyRef, {
        message: `Purchased ${item.name} for $${item.price.toFixed(0)}`,
        type: "purchase",
        timestamp: new Date().toISOString()
      });

      alert(`✅ Purchased ${item.name}!`);

    } catch (err) {
      console.error(err);
      alert("Purchase failed: " + err.message);
    }
  }

  // ----- APPLY (EQUIP) -----
  if (btn.classList.contains("cosmetic-feature")) {
    const featureId = btn.dataset.id;
    const userRef = doc(db, "users", user.uid);
    
    // Use the cache for the item data to save a read
    const itemData = cosmeticsCache[featureId];
    if (!itemData) return;

    if (!localUserData.cosmeticsOwned?.[featureId]) {
      return alert("🔒 Unlock this by purchasing in the Cosmetics Shop!");
    }

    // Dark mode toggle
    if (featureId === "darkMode") {
      const isDark = document.body.classList.contains("dark-mode");
      document.body.classList.toggle("dark-mode", !isDark);
      document.body.classList.toggle("light-mode", isDark);
      localStorage.setItem("theme", !isDark ? "dark" : "light");
    }

    // Navbar equip (ONLY ONE ACTIVE)
    if (itemData.type === "navbarColor" && dashboardNavbar) {
      dashboardNavbar.style.backgroundColor = itemData.color;
      localStorage.setItem("navbarColor", itemData.color);
      await updateDoc(userRef, { navbarColor: itemData.color });
      
      localUserData.navbarColor = itemData.color;
      loadCosmetics();
    }
  }
});

// ---------- CLEAN INITIALIZATION ----------
auth.onAuthStateChanged(user => {
  if (user) {
    // Note: We removed the duplicate onSnapshot(userRef) here.
    // dashboard.js now handles the "Live" updates via loadCosmetics(currentDashboardData).
    loadCosmetics();
  }
});

export { loadCosmetics };