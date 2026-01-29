// ---------- cosmetics.js ----------
console.log("cosmetics.js loaded");

import { db, auth } from "./firebaseConfig.js";
import {
  doc, getDoc, updateDoc,
  collection, getDocs, onSnapshot, addDoc
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// ---------- Elements ----------
const cosmeticsShopEl = document.getElementById("cosmetics-shop-items");
const dashboardNavbar = document.getElementById("dashboard-navbar");

// ---------- CACHE COSMETICS ----------
let cosmeticsCache = null;

async function getCosmeticsMap() {
  if (cosmeticsCache) return cosmeticsCache;

  const snap = await getDocs(collection(db, "cosmeticsShop"));
  cosmeticsCache = {};
  snap.forEach(d => cosmeticsCache[d.id] = d.data());
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
  if (!dashboardNavbar) return;

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
async function loadCosmetics(userData) {
  if (!auth.currentUser || !cosmeticsShopEl) return;

  if (!userData) {
    const userRef = doc(db, "users", auth.currentUser.uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      cosmeticsShopEl.innerHTML = "<p class='text-error'>User data not found.</p>";
      return;
    }
    userData = userSnap.data();
  }

  if (!userData.cosmeticsOwned) userData.cosmeticsOwned = {};

  const cosmeticsMap = await getCosmeticsMap();

  // Apply navbar safely
  await applyNavbarFromFirestore(userData, cosmeticsMap);

  // ---------- ACCESS CHECK ----------
  const now = new Date();
  const expirationDate = userData.expirationDate ? new Date(userData.expirationDate) : null;
  const canAccess = !userData.renewalPending && expirationDate && expirationDate > now;

  if (!canAccess) {
    cosmeticsShopEl.innerHTML =
      "<p class='text-muted'>Your ID is expired or renewal pending. Cannot access cosmetics.</p>";
    return;
  }

  cosmeticsShopEl.innerHTML = "";

  Object.entries(cosmeticsMap).forEach(([docId, item]) => {
    const owned = userData.cosmeticsOwned[item.id] === true;
    const equipped =
      item.type === "navbarColor" &&
      userData.navbarColor &&
      item.color === userData.navbarColor;

    const div = document.createElement("div");
    div.className = `cosmetic-item ${owned ? "owned" : ""} ${equipped ? "equipped" : ""}`;
    div.dataset.id = item.id;

    let actionHTML = "";

    if (!owned) {
      actionHTML = `
        <button class="btn-primary buy-cosmetic" data-id="${item.id}">Buy</button>
      `;
    } else if (item.feature) {
      if (equipped) {
        actionHTML = `<div class="equipped-badge">Applied</div>`;
      } else {
        actionHTML = `
          <button class="btn-secondary cosmetic-feature" data-id="${item.id}">Apply</button>
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

  // ----- BUY -----
  if (btn.classList.contains("buy-cosmetic")) {
    const itemId = btn.dataset.id;
    const itemDoc = await getDoc(doc(db, "cosmeticsShop", itemId));
    if (!itemDoc.exists()) return alert("Item not found!");

    const item = itemDoc.data();
    const userRef = doc(db, "users", auth.currentUser.uid);
    const userSnap = await getDoc(userRef);
    const userData = userSnap.data();
    const balance = Number(userData.balance || 0);

    if (balance < item.price) return alert("Insufficient funds!");

    try {
      const newCosmetics = { ...(userData.cosmeticsOwned || {}), [itemId]: true };

      await updateDoc(userRef, {
        balance: balance - item.price,
        cosmeticsOwned: newCosmetics
      });

      const historyRef = collection(db, "users", auth.currentUser.uid, "history_logs");
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
    const userRef = doc(db, "users", auth.currentUser.uid);
    const userSnap = await getDoc(userRef);
    const userData = userSnap.data();

    if (!userData.cosmeticsOwned?.[featureId]) {
      return alert("🔒 Unlock this by purchasing in the Cosmetics Shop!");
    }

    const featureSnap = await getDoc(doc(db, "cosmeticsShop", featureId));
    const itemData = featureSnap.data();

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
    }
  }
});

// ---------- REAL-TIME SYNC ----------
auth.onAuthStateChanged(user => {
  if (user) {
    const userRef = doc(db, "users", user.uid);

    onSnapshot(userRef, async (snap) => {
      const userData = snap.data();
      const cosmeticsMap = await getCosmeticsMap();
      await applyNavbarFromFirestore(userData, cosmeticsMap);
      loadCosmetics(userData);
    });

    loadCosmetics();
  }
});

export { loadCosmetics };
