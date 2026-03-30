// ---------- bpsShop.js (QUOTA OPTIMIZED + INSURANCE INTEGRATED) ----------
console.log("bpsShop.js loaded");
import { db, auth } from "./firebaseConfig.js";
import { 
  doc, getDoc, updateDoc, collection, getDocs, arrayUnion, addDoc 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const bpsContainer = document.getElementById("bps-shop-items");

// We store data locally to avoid constant database pings
let currentUserData = null;
let currentBpsItems = [];

/**
 * HELPER: Calculates the effective cost based on Insurance Package C (Cross Go)
 */
function getEffectiveCost(baseCost) {
  const hasInsuranceDiscount = currentUserData?.insurance?.activePackages?.includes("crossgo_c");
  if (hasInsuranceDiscount) {
    return Math.floor(baseCost * 0.9); // 10% Discount
  }
  return baseCost;
}

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
  const hasInsuranceDiscount = currentUserData?.insurance?.activePackages?.includes("crossgo_c");
  
  // --- Check Expiration (Local Calculation) ---
  const now = new Date();
  const expirationDate = currentUserData?.expirationDate ? new Date(currentUserData.expirationDate) : null;
  const isExpired = expirationDate && expirationDate < now;

  currentBpsItems.forEach(item => {
    const finalCost = getEffectiveCost(item.cost);
    const affordable = userBPS >= finalCost;
    const isDisabled = !affordable || isExpired;

    let btnText = affordable ? "Buy with BPS" : "Need Tokens";
    if (isExpired) btnText = "ID Expired 🚫";

    const div = document.createElement("div");
    div.classList.add("shop-item", "bps-item");
    if(isDisabled) div.style.opacity = "0.7"; 

    // Visual indicator if insurance is saving them money
    const priceHTML = hasInsuranceDiscount 
      ? `<p style="color: #8e44ad; font-weight:bold;"><span style="text-decoration: line-through; color: gray; font-size: 0.8em; margin-right: 5px;">${item.cost}</span> ${finalCost} BPS <span style="font-size: 0.6rem; background: #2ecc71; color: white; padding: 2px 4px; border-radius: 4px;">🛡️ 10% OFF</span></p>`
      : `<p style="color: #8e44ad; font-weight:bold;">${item.cost} BPS</p>`;

    div.innerHTML = `
      <h4>${item.name}</h4>
      ${priceHTML}
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

    // Re-check insurance locally using the fresh snap
    const hasInsuranceDiscount = userData?.insurance?.activePackages?.includes("crossgo_c");
    const finalCost = hasInsuranceDiscount ? Math.floor(itemData.cost * 0.9) : itemData.cost;

    const now = new Date();
    const expirationDate = userData.expirationDate ? new Date(userData.expirationDate) : null;
    if (expirationDate && expirationDate < now) {
        alert("⛔ Your ID is expired! Please renew to buy coupons.");
        return resetBtn(btnElement);
    }

    if(userData.bpsBalance < finalCost) {
        alert("Not enough BPS Tokens!");
        return resetBtn(btnElement);
    }

    const newBpsBalance = userData.bpsBalance - finalCost;

    await updateDoc(userRef, {
      bpsBalance: newBpsBalance,
      history: arrayUnion({ 
        message: `Bought ${itemData.name} ${hasInsuranceDiscount ? '(Insurance Applied)' : ''}`, 
        type: "purchase", 
        timestamp: new Date().toISOString() 
      })
    });

    await addDoc(inventoryRef, {
      name: itemData.name,
      type: "coupon", 
      discountValue: itemData.value, 
      value: 0, 
      acquiredAt: new Date().toISOString(),
      isFree: false 
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