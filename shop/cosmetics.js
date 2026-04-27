// ---------- cosmetics.js (QUOTA OPTIMIZED + SYSTEM UI INTEGRATED) ----------
console.log("cosmetics.js loaded");

import { db, auth } from "../firebaseConfig.js";
import {
  doc, getDoc, updateDoc,
  collection, getDocs, addDoc
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// ---------- Elements ----------
const cosmeticsShopEl = document.getElementById("cosmetics-shop-items");
const dashboardNavbar = document.querySelector(".top-stats-bar"); // Updated to new sidebar header ID
const sidebarEl = document.querySelector(".sidebar"); // Reference to sidebar for total theme sync

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
// ---------- APPLY NAVBAR & BACKGROUND (SOLID BLEND + HIGH VISIBILITY) ----------
// ---------- APPLY NAVBAR & BACKGROUND (CLEAN HIGH-VISIBILITY) ----------
async function applyCosmeticsFromFirestore(userData, cosmeticsMap) {
  if (!userData || !dashboardNavbar) return;

  if (userData.navbarColor) {
    const color = userData.navbarColor;
    
    // 1. Premium Glass Base (No change here, keeps the blur and glow)
    dashboardNavbar.style.background = `linear-gradient(to bottom, ${color}CC, ${color}99)`;
    dashboardNavbar.style.backdropFilter = "blur(12px)";
    dashboardNavbar.style.borderBottom = `1px solid ${color}`;
    dashboardNavbar.style.boxShadow = `0 4px 20px ${color}44`;

    // 2. Remove the Boxes & Reset Stat Containers
    const statContainers = dashboardNavbar.querySelectorAll('.stat-item, .nav-stat');
    statContainers.forEach(container => {
        container.style.background = "transparent"; // REMOVES THE BOXES
        container.style.border = "none";
        container.style.padding = "0 15px";
    });

    // 3. Labels (BALANCE, BPS TOKENS, etc.)
    const labels = dashboardNavbar.querySelectorAll('small, .stat-label');
    labels.forEach(l => {
        l.style.color = "rgba(255, 255, 255, 0.8)";
        l.style.fontWeight = "800";
        l.style.textShadow = "0 1px 3px rgba(0,0,0,0.5)"; // Adds "cut-out" depth
    });

    // 4. Values (The actual numbers)
    const values = dashboardNavbar.querySelectorAll('span, .stat-value, .bps-value');
    values.forEach(v => {
        // Restore Purple for BPS, White for others
        const isBPS = v.id === "user-bps" || v.classList.contains("bps-value");
        v.style.color = isBPS ? "#a29bfe" : "#ffffff"; 
        
        v.style.fontWeight = "900";
        // Stronger shadow since the background box is gone
        v.style.textShadow = "0 2px 8px rgba(0,0,0,0.6), 0 0 10px rgba(0,0,0,0.3)";
    });

  } else {
    // Revert to system default
    dashboardNavbar.style.background = "var(--card-bg)";
    dashboardNavbar.style.borderBottom = "1px solid var(--contract-border)";
    dashboardNavbar.style.boxShadow = "none";
    
    // Reset BPS back to standard color if needed
    const bpsValue = document.getElementById("user-bps");
    if (bpsValue) bpsValue.style.color = "#a29bfe";
  }

  // Background radial blend (maintains depth)
  if (userData.equippedBackground) {
    const bgColor = userData.equippedBackground;
    // Set a solid background color instead of a gradient
    document.body.style.setProperty('background', bgColor, 'important');
} else {
    // Reset to default if nothing is equipped
    document.body.style.background = ""; 
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
    cosmeticsShopEl.innerHTML = "<p style='color:gray; font-style:italic; text-align:center; padding:20px;'>Market Locked: Check ID Status.</p>";
    return;
  }

  // Set grid styling for the container
  cosmeticsShopEl.style.display = "grid";
  cosmeticsShopEl.style.gridTemplateColumns = "repeat(auto-fill, minmax(180px, 1fr))";
  cosmeticsShopEl.style.gap = "20px";

  cosmeticsShopEl.innerHTML = "";

  Object.entries(cosmeticsMap).forEach(([docId, item]) => {
    const owned = localUserData.cosmeticsOwned[docId] === true;
    
    // Check if equipped
    const isNavbarEquipped = item.type === "navbarColor" && localUserData.navbarColor === item.color;
    const isBgEquipped = item.type === "backgroundColor" && localUserData.equippedBackground === item.color;
    const equipped = isNavbarEquipped || isBgEquipped;

    const div = document.createElement("div");
    div.className = `cosmetic-item ${owned ? "owned" : ""} ${equipped ? "equipped" : ""}`;
    
    // --- IMPROVED STYLING WITH INTERACTIVE HOVER ---
    const itemColor = item.color || '#3498db';
    div.style.cssText = `
        background: var(--card-bg);
        border: 1px solid ${equipped ? itemColor : 'var(--contract-border)'};
        padding: 20px;
        border-radius: 14px;
        text-align: center;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        position: relative;
        overflow: hidden;
        cursor: default;
        box-shadow: ${equipped ? `0 0 15px ${itemColor}33` : 'none'};
    `;

    // JavaScript Hover Listeners for Dynamic Effects
    div.onmouseenter = () => {
        div.style.transform = "translateY(-5px)";
        div.style.borderColor = itemColor;
        div.style.boxShadow = `0 10px 20px ${itemColor}22`;
    };
    div.onmouseleave = () => {
        div.style.transform = "translateY(0)";
        div.style.borderColor = equipped ? itemColor : 'var(--contract-border)';
        div.style.boxShadow = equipped ? `0 0 15px ${itemColor}33` : 'none';
    };

    let actionHTML = "";
    if (!owned) {
      actionHTML = `<button class="buy-cosmetic" data-id="${docId}" style="width:100%; padding:10px; border-radius:8px; border:none; background:#3498db; color:white; font-weight:800; cursor:pointer; text-transform:uppercase; font-size:0.75rem; transition:0.2s;">Buy</button>`;
    } else if (item.feature || item.type === "navbarColor" || item.type === "backgroundColor") {
      actionHTML = `
        <button class="cosmetic-feature" data-id="${docId}" style="width:100%; padding:10px; border-radius:8px; border:none; background:${equipped ? '#e74c3c' : '#2ecc71'}; color:white; font-weight:800; cursor:pointer; text-transform:uppercase; font-size:0.75rem; transition:0.2s;">
            ${equipped ? 'Remove' : 'Apply'}
        </button>`;
    }

    div.innerHTML = `
      <div class="shop-item-image" style="width:60px; height:60px; border-radius:50%; margin: 0 auto 15px auto; background:${itemColor}; border: 4px solid rgba(255,255,255,0.05); display:flex; align-items:center; justify-content:center; box-shadow: 0 4px 10px rgba(0,0,0,0.3); transition:0.3s;">
        ${item.img ? `<img src="${item.img}" alt="${item.name}" style="width:100%; height:100%; border-radius:50%; object-fit: cover;">` : ""}
      </div>
      <div class="shop-item-info">
        <h4 style="margin:0; font-size: 0.95rem; font-weight:700; color:#fff;">${item.name}</h4>
        <div class="cosmetic-price" style="font-weight: 800; font-size: 0.85rem; margin: 8px 0; color: ${owned ? '#95a5a6' : '#2ecc71'};">
            ${owned ? 'OWNED' : `$${Number(item.price).toLocaleString()}`}
        </div>
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
        message: `Purchased Cosmetic: ${item.name}`,
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

    // 1. Dark mode toggle
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
        document.body.style.backgroundColor = "";
        document.body.classList.remove("custom-bg-active");
      } else {
        document.body.style.setProperty('background-color', colorToSet, 'important');
        document.body.classList.add("custom-bg-active");
      }
      
      localUserData.equippedBackground = colorToSet;
      await updateDoc(userRef, { equippedBackground: colorToSet });
    }

    loadCosmetics(localUserData);
  }
});

auth.onAuthStateChanged(user => { if (user) loadCosmetics(); });

export { loadCosmetics };