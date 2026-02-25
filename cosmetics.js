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
let localUserData = null; 

/**
 * Optimized Load: Uses getDocs for items (read once)
 */
async function getCosmeticsMap() {
  if (cosmeticsCache) return cosmeticsCache;
  const snap = await getDocs(collection(db, "cosmeticsShop"));
  cosmeticsCache = {};
  snap.forEach(d => {
    cosmeticsCache[d.id] = { ...d.data(), id: d.id };
  });
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

// ---------- APPLY NAVBAR & BACKGROUND (OWNERSHIP SAFE) ----------
async function applyCosmeticsFromFirestore(userData, cosmeticsMap) {
  if (!userData) return;

  // 1. Handle Navbar
  let navbarColor = "#3498db"; // default
  if (userData.navbarColor && cosmeticsMap) {
    const isValid = Object.values(cosmeticsMap).some(item => 
      item.type === "navbarColor" && item.color === userData.navbarColor && userData.cosmeticsOwned?.[item.id]
    );
    if (isValid) navbarColor = userData.navbarColor;
  }
  if (dashboardNavbar) dashboardNavbar.style.backgroundColor = navbarColor;

  // 2. Handle Background Color
  if (userData.equippedBackground) {
    document.body.style.setProperty('background-color', userData.equippedBackground, 'important');
    document.body.classList.add("custom-bg-active");
  } else {
    document.body.style.backgroundColor = ""; 
    document.body.classList.remove("custom-bg-active");
  }
}

// ---------- LOAD COSMETICS ----------
async function loadCosmetics(userData = null) {
  if (!auth.currentUser || !cosmeticsShopEl) return;

  if (userData) localUserData = userData;

  if (!localUserData) {
    const userSnap = await getDoc(doc(db, "users", auth.currentUser.uid));
    if (!userSnap.exists()) return;
    localUserData = userSnap.data();
  }

  if (!localUserData.cosmeticsOwned) localUserData.cosmeticsOwned = {};
  const cosmeticsMap = await getCosmeticsMap();

  // Apply visual styles
  await applyCosmeticsFromFirestore(localUserData, cosmeticsMap);

  // Access Check
  const now = new Date();
  const expirationDate = localUserData.expirationDate ? new Date(localUserData.expirationDate) : null;
  const canAccess = !localUserData.renewalPending && expirationDate && expirationDate > now;

  if (!canAccess) {
    cosmeticsShopEl.innerHTML = "<p class='text-muted'>Access denied: Expired or Pending.</p>";
    return;
  }

  cosmeticsShopEl.innerHTML = "";

  Object.entries(cosmeticsMap).forEach(([docId, item]) => {
    const owned = localUserData.cosmeticsOwned[docId] === true;
    
    // Check if equipped
    const isNavbarEquipped = item.type === "navbarColor" && localUserData.navbarColor === item.color;
    const isBgEquipped = item.type === "backgroundColor" && localUserData.equippedBackground === item.color;
    const equipped = isNavbarEquipped || isBgEquipped;

    const div = document.createElement("div");
    div.className = `cosmetic-item ${owned ? "owned" : ""} ${equipped ? "equipped" : ""}`;
    div.dataset.id = docId;

    let actionHTML = "";
    if (!owned) {
      actionHTML = `<button class="btn-primary buy-cosmetic" data-id="${docId}">Buy</button>`;
    } else if (item.feature || item.type === "navbarColor" || item.type === "backgroundColor") {
      // Button text changes based on equipped status
      actionHTML = `<button class="btn-secondary cosmetic-feature" data-id="${docId}">${equipped ? 'Remove' : 'Apply'}</button>`;
      if (equipped) {
        actionHTML += `<div class="equipped-badge" style="margin-top:5px; background:#2ecc71; color:white; border-radius:4px; font-size:0.75rem;">Applied</div>`;
      }
    }

    div.innerHTML = `
      <div class="shop-item-image" style="background:${item.color || '#151525'};">
        ${item.img ? `<img src="${item.img}" alt="${item.name}">` : ""}
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

  // ----- BUY LOGIC -----
  if (btn.classList.contains("buy-cosmetic")) {
    const itemId = btn.dataset.id;
    const [userSnap, itemSnap] = await Promise.all([
        getDoc(doc(db, "users", user.uid)),
        getDoc(doc(db, "cosmeticsShop", itemId))
    ]);

    if (!itemSnap.exists()) return;
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

      localUserData.balance = balance - item.price;
      localUserData.cosmeticsOwned = newCosmetics;
      loadCosmetics(localUserData);

      await addDoc(collection(db, "users", user.uid, "history_logs"), {
        message: `Purchased ${item.name} for $${item.price}`,
        type: "purchase",
        timestamp: new Date().toISOString()
      });
      alert(`✅ Purchased ${item.name}!`);
    } catch (err) { alert("Purchase failed"); }
  }

  // ----- APPLY / UNEQUIP LOGIC -----
  if (btn.classList.contains("cosmetic-feature")) {
    const featureId = btn.dataset.id;
    const cosmeticsMap = await getCosmeticsMap();
    const itemData = cosmeticsMap[featureId];
    
    if (!itemData || !localUserData.cosmeticsOwned?.[featureId]) return;

    const userRef = doc(db, "users", user.uid);

    // 1. Dark mode toggle (Special case: Toggle)
    if (featureId === "darkMode") {
      const isDark = document.body.classList.contains("dark-mode");
      const newMode = !isDark ? "dark" : "light";
      document.body.classList.toggle("dark-mode", !isDark);
      document.body.classList.toggle("light-mode", isDark);
      localStorage.setItem("theme", newMode);
      await updateDoc(userRef, { theme: newMode });
    }

    // 2. Navbar Toggle Logic
    if (itemData.type === "navbarColor") {
      const isCurrentlyEquipped = localUserData.navbarColor === itemData.color;
      const colorToSet = isCurrentlyEquipped ? "" : itemData.color;
      
      localUserData.navbarColor = colorToSet;
      await updateDoc(userRef, { navbarColor: colorToSet });
    }

    // 3. Background Color Toggle Logic
    if (itemData.type === "backgroundColor") {
      const isCurrentlyEquipped = localUserData.equippedBackground === itemData.color;
      const colorToSet = isCurrentlyEquipped ? "" : itemData.color;

      if (colorToSet === "") {
        console.log("Removing background color");
        document.body.style.backgroundColor = "";
        document.body.classList.remove("custom-bg-active");
      } else {
        console.log("Applying custom background:", colorToSet);
        document.body.style.setProperty('background-color', colorToSet, 'important');
        document.body.classList.add("custom-bg-active");
      }
      
      localUserData.equippedBackground = colorToSet;
      await updateDoc(userRef, { equippedBackground: colorToSet });
    }

    // Refresh the UI to update "Applied/Remove" buttons
    loadCosmetics(localUserData);
  }
});

auth.onAuthStateChanged(user => { if (user) loadCosmetics(); });

export { loadCosmetics };  