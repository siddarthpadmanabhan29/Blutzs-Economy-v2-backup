// ---------- shop.js (QUOTA OPTIMIZED) ----------
console.log("shop.js loaded");

import { db, auth } from "./firebaseConfig.js";
import { 
  doc, getDoc, updateDoc, collection, getDocs, addDoc 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { logHistory } from "./historyManager.js";

const shopItemsContainer = document.getElementById("shop-items");

// We store shop items locally after a one-time fetch to save reads
let currentShopItems = [];
let localUserData = null; 

/**
 * Optimized Load: Uses getDocs for items (read once) 
 * and pulls user data from the existing dashboard state
 */
async function loadShopItems() {
  const user = auth.currentUser;
  if (!user) return;

  const shopRef = collection(db, "shop");

  try {
    // ONE-TIME FETCH: Instead of a live listener, we fetch the shop catalog once.
    // This stops the "constant reading" that kills your quota.
    const querySnap = await getDocs(shopRef);
    currentShopItems = [];
    querySnap.forEach((doc) => {
      currentShopItems.push({ id: doc.id, ...doc.data() });
    });

    // Fetch user data once for the initial render
    const userSnap = await getDoc(doc(db, "users", user.uid));
    if (userSnap.exists()) {
      localUserData = userSnap.data();
    }

    renderShop(); 
  } catch (err) {
    console.error("Failed to load shop:", err);
  }
}

/**
 * Renders the shop UI based on local variables.
 * No database reads happen inside this function.
 */
function renderShop(externalUserData = null) {
  if (!shopItemsContainer) return;

  // If dashboard.js passes us fresh user data, use it. Otherwise use our local cache.
  if (externalUserData) localUserData = externalUserData;
  
  shopItemsContainer.innerHTML = "";

  if (currentShopItems.length === 0) {
    shopItemsContainer.innerHTML = "<p>No items available. Click Refresh to check again.</p>";
    return;
  }

  const userBalance = Number(localUserData?.balance || 0);
  const activeDiscount = Number(localUserData?.activeDiscount || 0);

  // --- CHECK EXPIRATION ---
  const now = new Date();
  const expirationDate = localUserData?.expirationDate ? new Date(localUserData.expirationDate) : null;
  const isExpired = expirationDate && expirationDate < now;

  currentShopItems.forEach((item) => {
    const originalCost = Number(item.cost);
    let finalCost = originalCost;
    let priceDisplay = `$${originalCost.toLocaleString()}`;

    if (activeDiscount > 0) {
      finalCost = Math.floor(originalCost * (1 - activeDiscount));
      priceDisplay = `
        <span style="text-decoration: line-through; color: gray; font-size: 0.8em;">$${originalCost}</span> 
        <span style="color: #2ecc71; font-weight: bold;">$${finalCost}</span>
        <span style="font-size: 0.7em; color: #e74c3c;">(-${activeDiscount * 100}%)</span>
      `;
    }

    const affordable = userBalance >= finalCost;
    const isDisabled = !affordable || isExpired;

    let btnText = affordable ? "Buy" : "Need Cash 💸";
    if (isExpired) btnText = "ID Expired 🚫";

    const itemCard = document.createElement("div");
    itemCard.classList.add("shop-item");
    if (isDisabled) itemCard.classList.add("unaffordable");

    itemCard.innerHTML = `
      <div class="shop-item-image">
        <img src="${item.image || 'https://via.placeholder.com/150?text=Item'}" alt="${item.name}">
      </div>
      <div class="shop-item-info">
        <h4>${item.name}</h4>
        <p class="shop-price">${priceDisplay}</p>
        <button class="btn-primary buy-item-btn" data-id="${item.id}" ${isDisabled ? "disabled" : ""}>
          ${btnText}
        </button>
      </div>
    `;

    shopItemsContainer.appendChild(itemCard);
  });

  attachBuyListeners();
}

function attachBuyListeners() {
  document.querySelectorAll(".buy-item-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.textContent = "Processing...";
        await buyItem(btn.dataset.id, btn);
    });
  });
}

async function buyItem(itemId, btnElement) {
  const user = auth.currentUser;
  if (!user) return;

  const userRef = doc(db, "users", user.uid);
  const itemRef = doc(db, "shop", itemId);
  const inventoryRef = collection(db, "users", user.uid, "inventory");

  try {
    // We use getDoc here because a purchase MUST have the most accurate current data
    const [userSnap, itemSnap] = await Promise.all([getDoc(userRef), getDoc(itemRef)]);
    
    if (!userSnap.exists() || !itemSnap.exists()) {
        alert("Error: User or Item not found.");
        return resetBtn(btnElement);
    }
    
    const userData = userSnap.data();
    const itemData = itemSnap.data();
    
    const now = new Date();
    const expirationDate = userData.expirationDate ? new Date(userData.expirationDate) : null;
    if (expirationDate && expirationDate < now) {
        alert("⛔ Your ID is expired! Please renew your ID to purchase items.");
        return resetBtn(btnElement);
    }

    const currentBalance = Number(userData.balance || 0);
    const currentBPS = Number(userData.bpsBalance || 0);
    const activeDiscount = Number(userData.activeDiscount || 0);
    
    let finalCost = Number(itemData.cost);
    if (activeDiscount > 0) {
        finalCost = Math.floor(finalCost * (1 - activeDiscount));
    }

    if (currentBalance < finalCost) {
        alert("Insufficient funds!");
        return resetBtn(btnElement);
    }

    const newBalance = currentBalance - finalCost;
    const newBPS = currentBPS + 5; 

    await updateDoc(userRef, {
      balance: newBalance,
      bpsBalance: newBPS,
      activeDiscount: 0
    });

    await logHistory(user.uid, `Bought ${itemData.name} for $${finalCost}`, "purchase");

    await addDoc(inventoryRef, {
      name: itemData.name,
      value: Math.floor(finalCost / 2),
      originalId: itemId,
      acquiredAt: new Date().toISOString()
    });
    
    alert(`Purchased ${itemData.name} for $${finalCost}!`);
    
    // Refresh local cache after purchase
    localUserData = { ...userData, balance: newBalance, bpsBalance: newBPS, activeDiscount: 0 };
    renderShop();

  } catch (err) {
    console.error(err);
    alert("Transaction failed: " + err.message);
    resetBtn(btnElement);
  }
}

function resetBtn(btn) {
    if(btn) {
        btn.disabled = false;
        btn.textContent = "Buy";
    }
}

// Initialize on Auth
auth.onAuthStateChanged((user) => { 
    if (user) loadShopItems(); 
});

// The heartbeat is now purely visual/local. It does NOT read from the database.
setInterval(() => {
  if (localUserData) {
    renderShop(); 
  }
}, 10000); // Increased to 10s to save CPU; since data is local, this is safe.

export { loadShopItems, renderShop };