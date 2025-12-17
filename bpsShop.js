// ---------- bpsShop.js (REACTIVE & ID CHECK) ----------
console.log("bpsShop.js loaded");
import { db, auth } from "./firebaseConfig.js";
import { doc, getDoc, updateDoc, collection, onSnapshot, arrayUnion, addDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const bpsContainer = document.getElementById("bps-shop-items");

let currentUserData = null;
let currentBpsItems = [];

async function loadBpsShop() {
  const user = auth.currentUser;
  if (!user) return;

  const userRef = doc(db, "users", user.uid);
  const shopRef = collection(db, "bpsShop");

  // Listener 1: Watch User Data (Tokens & Expiration)
  onSnapshot(userRef, (docSnap) => {
    if (docSnap.exists()) {
      currentUserData = docSnap.data();
      renderBpsShop();
    }
  });

  // Listener 2: Watch BPS Shop Items
  onSnapshot(shopRef, (snap) => {
    currentBpsItems = [];
    snap.forEach(doc => currentBpsItems.push({ id: doc.id, ...doc.data() }));
    renderBpsShop();
  });
}

function renderBpsShop() {
  if (!bpsContainer) return;
  bpsContainer.innerHTML = "";

  if (currentBpsItems.length === 0) {
    bpsContainer.innerHTML = "<p>No coupons available.</p>";
    return;
  }

  const userBPS = Number(currentUserData?.bpsBalance || 0);
  
  // --- Check Expiration ---
  const now = new Date();
  const expirationDate = currentUserData?.expirationDate ? new Date(currentUserData.expirationDate) : null;
  const isExpired = expirationDate && expirationDate < now;

  currentBpsItems.forEach(item => {
    const affordable = userBPS >= item.cost;
    const isDisabled = !affordable || isExpired;

    let btnText = affordable ? "Buy with BPS" : "Need Tokens";
    if (isExpired) btnText = "ID Expired 🚫";

    const div = document.createElement("div");
    div.classList.add("shop-item", "bps-item");
    if(isDisabled) div.style.opacity = "0.7"; // Visual dimming

    div.innerHTML = `
      <h4>${item.name}</h4>
      <p style="color: #8e44ad; font-weight:bold;">${item.cost} BPS</p>
      <button class="btn-primary buy-bps-btn" data-id="${item.id}" ${isDisabled ? "disabled" : ""}>
        ${btnText}
      </button>
    `;
    bpsContainer.appendChild(div);
  });

  document.querySelectorAll(".buy-bps-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
       btn.disabled = true;
       btn.textContent = "Processing...";
       await buyBpsItem(btn.dataset.id, btn);
    });
  });
}

async function buyBpsItem(itemId, btnElement) {
  const user = auth.currentUser;
  const userRef = doc(db, "users", user.uid);
  const itemRef = doc(db, "bpsShop", itemId);
  const inventoryRef = collection(db, "users", user.uid, "inventory");

  try {
    const [userSnap, itemSnap] = await Promise.all([getDoc(userRef), getDoc(itemRef)]);
    const userData = userSnap.data();
    const itemData = itemSnap.data();

    // --- SECURITY CHECK: Stop if expired ---
    const now = new Date();
    const expirationDate = userData.expirationDate ? new Date(userData.expirationDate) : null;
    if (expirationDate && expirationDate < now) {
        alert("⛔ Your ID is expired! Please renew to buy coupons.");
        return resetBtn(btnElement);
    }

    if(userData.bpsBalance < itemData.cost) {
        alert("Not enough BPS Tokens!");
        return resetBtn(btnElement);
    }

    // Deduct BPS, Add to History
    await updateDoc(userRef, {
      bpsBalance: userData.bpsBalance - itemData.cost,
      history: arrayUnion({ message: `Bought ${itemData.name}`, type: "purchase", timestamp: new Date().toISOString() })
    });

    // Add Coupon to Inventory
    await addDoc(inventoryRef, {
      name: itemData.name,
      type: "coupon", 
      discountValue: itemData.value, 
      value: 0, 
      acquiredAt: new Date().toISOString()
    });

    alert(`Bought ${itemData.name}! Check your inventory.`);

  } catch (err) {
      console.error(err);
      alert("Error: " + err.message);
      resetBtn(btnElement);
  }
}

function resetBtn(btn) {
    if(btn) {
        btn.disabled = false;
        btn.textContent = "Buy with BPS";
    }
}

auth.onAuthStateChanged(user => { if(user) loadBpsShop(); });

// ---------- NEW: Heartbeat Timer ----------
setInterval(() => {
  if (currentUserData) {
    renderBpsShop();
  }
}, 5000);