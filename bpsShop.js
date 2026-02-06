// ---------- bpsShop.js (QUOTA OPTIMIZED) ----------
console.log("bpsShop.js loaded");
import { db, auth } from "./firebaseConfig.js";
import { 
  doc, getDoc, updateDoc, collection, getDocs, arrayUnion, addDoc 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const bpsContainer = document.getElementById("bps-shop-items");

// We store data locally to avoid constant database pings
let currentUserData = null;
let currentBpsItems = [];

async function loadBpsShop() {
  const user = auth.currentUser;
  if (!user) return;

  const shopRef = collection(db, "bpsShop");
  const userRef = doc(db, "users", user.uid);

  try {
    // ONE-TIME FETCH: Read the catalog once to save reads
    const querySnap = await getDocs(shopRef);
    currentBpsItems = [];
    querySnap.forEach(doc => currentBpsItems.push({ id: doc.id, ...doc.data() }));

    // Fetch user data once for the initial render
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      currentUserData = userSnap.data();
    }

    renderBpsShop();
  } catch (err) {
    console.error("Failed to load BPS shop:", err);
  }
}

/**
 * Renders UI. Can accept external user data from dashboard.js
 * to stay updated without any extra reads.
 */
function renderBpsShop(externalUserData = null) {
  if (!bpsContainer) return;
  
  if (externalUserData) currentUserData = externalUserData;
  bpsContainer.innerHTML = "";

  if (currentBpsItems.length === 0) {
    bpsContainer.innerHTML = "<p>No coupons available.</p>";
    return;
  }

  const userBPS = Number(currentUserData?.bpsBalance || 0);
  
  // --- Check Expiration (Local Calculation) ---
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
    if(isDisabled) div.style.opacity = "0.7"; 

    div.innerHTML = `
      <h4>${item.name}</h4>
      <p style="color: #8e44ad; font-weight:bold;">${item.cost} BPS</p>
      <button class="btn-primary buy-bps-btn" data-id="${item.id}" ${isDisabled ? "disabled" : ""}>
        ${btnText}
      </button>
    `;
    bpsContainer.appendChild(div);
  });

  attachBpsListeners();
}

function attachBpsListeners() {
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
  if (!user) return;

  const userRef = doc(db, "users", user.uid);
  const itemRef = doc(db, "bpsShop", itemId);
  const inventoryRef = collection(db, "users", user.uid, "inventory");

  try {
    // Accurate data fetch for the transaction
    const [userSnap, itemSnap] = await Promise.all([getDoc(userRef), getDoc(itemRef)]);
    const userData = userSnap.data();
    const itemData = itemSnap.data();

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

    const newBpsBalance = userData.bpsBalance - itemData.cost;

    await updateDoc(userRef, {
      bpsBalance: newBpsBalance,
      history: arrayUnion({ message: `Bought ${itemData.name}`, type: "purchase", timestamp: new Date().toISOString() })
    });

    await addDoc(inventoryRef, {
      name: itemData.name,
      type: "coupon", 
      discountValue: itemData.value, 
      value: 0, 
      acquiredAt: new Date().toISOString()
    });

    alert(`Bought ${itemData.name}! Check your inventory.`);
    
    // Update local state and refresh UI
    currentUserData.bpsBalance = newBpsBalance;
    renderBpsShop();

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

// Initialize
auth.onAuthStateChanged(user => { if(user) loadBpsShop(); });

// Heartbeat Timer: 10s is plenty since it's only for the visual ID check
setInterval(() => {
  if (currentUserData) {
    renderBpsShop();
  }
}, 10000);

export { loadBpsShop, renderBpsShop };