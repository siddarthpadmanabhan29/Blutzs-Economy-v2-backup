// ---------- shop.js (FINAL VERSION) ----------
console.log("shop.js loaded");

import { db, auth } from "./firebaseConfig.js";
import { 
  doc, getDoc, updateDoc, collection, onSnapshot, addDoc 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { logHistory } from "./historyManager.js"; // <--- New Import

const shopItemsContainer = document.getElementById("shop-items");

let currentUserData = null;
let currentShopItems = [];

async function loadShopItems() {
  const user = auth.currentUser;
  if (!user) return;

  const userRef = doc(db, "users", user.uid);
  const shopRef = collection(db, "shop");

  // LISTENER 1: User Data (Balance & Active Discount)
  onSnapshot(userRef, (docSnap) => {
    if (docSnap.exists()) {
      currentUserData = docSnap.data();
      renderShop(); 
    }
  });

  // LISTENER 2: Shop Items (Inventory Stock)
  onSnapshot(shopRef, (querySnap) => {
    currentShopItems = [];
    querySnap.forEach((doc) => {
      currentShopItems.push({ id: doc.id, ...doc.data() });
    });
    renderShop(); 
  });
}

function renderShop() {
  if (!shopItemsContainer) return;
  shopItemsContainer.innerHTML = "";

  if (currentShopItems.length === 0) {
    shopItemsContainer.innerHTML = "<p>No items available.</p>";
    return;
  }

  const userBalance = Number(currentUserData?.balance || 0);
  const activeDiscount = Number(currentUserData?.activeDiscount || 0);

  // --- CHECK EXPIRATION ---
  const now = new Date();
  const expirationDate = currentUserData?.expirationDate ? new Date(currentUserData.expirationDate) : null;
  const isExpired = expirationDate && expirationDate < now;

  currentShopItems.forEach((item) => {
    const originalCost = Number(item.cost);
    let finalCost = originalCost;
    let priceDisplay = `$${originalCost.toLocaleString()}`;

    // Calculate Discount
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

    // Determine Button Text
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
    const [userSnap, itemSnap] = await Promise.all([getDoc(userRef), getDoc(itemRef)]);
    
    if (!userSnap.exists() || !itemSnap.exists()) {
        alert("Error: User or Item not found.");
        return resetBtn(btnElement);
    }
    
    const userData = userSnap.data();
    const itemData = itemSnap.data();
    
    // --- SECURITY CHECK: Stop if expired ---
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

    // 1. UPDATE USER (Balance only)
    await updateDoc(userRef, {
      balance: newBalance,
      bpsBalance: newBPS,
      activeDiscount: 0
    });

    // 2. LOG HISTORY (Using new manager)
    await logHistory(user.uid, `Bought ${itemData.name} for $${finalCost}`, "purchase");

    // 3. ADD TO INVENTORY
    await addDoc(inventoryRef, {
      name: itemData.name,
      value: Math.floor(finalCost / 2),
      originalId: itemId,
      acquiredAt: new Date().toISOString()
    });
    
    alert(`Purchased ${itemData.name} for $${finalCost}!`);

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

// Initialize
auth.onAuthStateChanged((user) => { if (user) loadShopItems(); });

// Heartbeat Timer: Refresh UI every 5 seconds to check ID expiration
setInterval(() => {
  if (currentUserData) {
    renderShop(); 
  }
}, 5000); 

export { loadShopItems };