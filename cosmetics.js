// ---------- cosmetics.js ----------
console.log("cosmetics.js loaded");

import { db, auth } from "./firebaseConfig.js";
import { doc, getDoc, updateDoc, collection, getDocs, onSnapshot, addDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// ---------- Elements ----------
const cosmeticsShopEl = document.getElementById("cosmetics-shop-items");

// Track last rendered items to prevent duplicates
let renderedItemIds = new Set();

// ---------- THEME PERSISTENCE ----------
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

// Apply theme on initial load
applySavedTheme();

// ---------- Load Cosmetics ----------
async function loadCosmetics() {
  if (!auth.currentUser || !cosmeticsShopEl) return;

  const userRef = doc(db, "users", auth.currentUser.uid);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) {
    cosmeticsShopEl.innerHTML = "<p class='text-error'>User data not found.</p>";
    return;
  }

  const userData = userSnap.data();
  if (!userData.cosmeticsOwned) userData.cosmeticsOwned = {};

  // Access check (ID must be active)
  const now = new Date();
  const expirationDate = userData.expirationDate ? new Date(userData.expirationDate) : null;
  const canAccess = !userData.renewalPending && expirationDate && expirationDate > now;

  if (!canAccess) {
    cosmeticsShopEl.innerHTML = "<p class='text-muted'>Your ID is expired or renewal pending. Cannot access cosmetics.</p>";
    return;
  }

  // Fetch cosmetics from Firestore
  const cosmeticsCol = collection(db, "cosmeticsShop");
  const cosmeticsSnap = await getDocs(cosmeticsCol);

  if (cosmeticsSnap.empty) {
    cosmeticsShopEl.innerHTML = "<p class='text-muted'>No cosmetics available yet.</p>";
    return;
  }

  // Clear container and reset tracker
  cosmeticsShopEl.innerHTML = "";
  renderedItemIds.clear();

  cosmeticsSnap.forEach(docSnap => {
    const item = docSnap.data();

    // Prevent duplicates
    if (renderedItemIds.has(item.id)) return;
    renderedItemIds.add(item.id);

    const owned = userData.cosmeticsOwned[item.id] === true;

    const div = document.createElement("div");
    div.className = `cosmetic-item ${owned ? "owned" : ""}`;
    div.dataset.id = item.id;

    div.innerHTML = `
      <div class="shop-item-image">
        <img src="${item.img}" alt="${item.name}" onerror="this.src='https://via.placeholder.com/64?text=No+Image'">
      </div>
      <div class="shop-item-info">
        <h4>${item.name}</h4>
        <p>${item.description || ""}</p>
        <div class="cosmetic-price">$${Number(item.price).toLocaleString()}</div>
        <button ${owned ? "disabled" : ""} class="btn-primary buy-cosmetic" data-id="${item.id}">
          ${owned ? "Owned" : "Buy"}
        </button>
      </div>
    `;

    cosmeticsShopEl.appendChild(div);
  });
}

// ---------- Buy Cosmetics via Event Delegation ----------
cosmeticsShopEl.addEventListener("click", async (e) => {
  const btn = e.target;

  // Handle buying items
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

      // Deduct balance and mark cosmetic as owned
      await updateDoc(userRef, {
        balance: balance - item.price,
        cosmeticsOwned: newCosmetics
      });

      // --- LOG PURCHASE in history_logs subcollection ---
      const historyRef = collection(db, "users", auth.currentUser.uid, "history_logs");
      await addDoc(historyRef, {
        message: `Purchased ${item.name} for $${item.price.toFixed(0)}`,
        type: "purchase",
        timestamp: new Date().toISOString()
      });

      alert(`✅ Purchased ${item.name}!`);
      loadCosmetics(); // refresh UI
    } catch (err) {
      console.error(err);
      alert("Purchase failed: " + err.message);
    }
  }

  // Handle clicking on cosmetic features in UI
  if (btn.classList.contains("cosmetic-feature")) {
    const featureId = btn.dataset.id;
    const userRef = doc(db, "users", auth.currentUser.uid);
    const userSnap = await getDoc(userRef);
    const userData = userSnap.data();
    const owned = userData.cosmeticsOwned?.[featureId] === true;

    if (!owned) {
      alert("🔒 Unlock this by purchasing in the Cosmetics Shop!");
      return;
    }

    // Execute feature callback (example: dark mode)
    if (featureId === "darkMode") {
      const isDark = document.body.classList.contains("dark-mode");
      document.body.classList.toggle("dark-mode", !isDark);
      document.body.classList.toggle("light-mode", isDark);
      localStorage.setItem("theme", !isDark ? "dark" : "light");
    }
  }
});

// ---------- Real-time updates ----------
auth.onAuthStateChanged(user => {
  if (user) {
    const userRef = doc(db, "users", user.uid);
    // Only one snapshot listener to prevent duplicates
    onSnapshot(userRef, { includeMetadataChanges: false }, () => loadCosmetics());
    loadCosmetics(); // initial load
  }
});

export { loadCosmetics };
