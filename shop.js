// ---------- shop.js (QUOTA OPTIMIZED + CONFIRMATION TAX) ----------
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
    const querySnap = await getDocs(shopRef);
    currentShopItems = [];
    querySnap.forEach((doc) => {
      currentShopItems.push({ id: doc.id, ...doc.data() });
    });

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
 */
function renderShop(externalUserData = null) {
  if (!shopItemsContainer) return;

  if (externalUserData) localUserData = externalUserData;
  
  shopItemsContainer.innerHTML = "";

  if (currentShopItems.length === 0) {
    shopItemsContainer.innerHTML = "<p>No items available. Click Refresh to check again.</p>";
    return;
  }

  const userBalance = Number(localUserData?.balance || 0);
  const activeDiscount = Number(localUserData?.activeDiscount || 0);

  const now = new Date();
  const expirationDate = localUserData?.expirationDate ? new Date(localUserData.expirationDate) : null;
  const isExpired = expirationDate && expirationDate < now;

  currentShopItems.forEach((item) => {
    const originalCost = Number(item.cost);
    
    let discountedPrice = originalCost;
    if (activeDiscount > 0) {
      discountedPrice = Math.floor(originalCost * (1 - activeDiscount));
    }

    // Keep background math for button disabling (Total Cost = Price + 10%)
    const totalCost = Math.floor(discountedPrice * 1.10);

    // UI shows ONLY the base price for a clean look
    let priceDisplay = `
      <div style="font-weight: bold; font-size: 1.1em;">
        ${activeDiscount > 0 ? `<span style="text-decoration: line-through; color: gray; font-size: 0.8em;">$${originalCost.toLocaleString()}</span> ` : ""}
        $${discountedPrice.toLocaleString()}
      </div>
    `;

    const affordable = userBalance >= totalCost;
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
        <div class="shop-price">${priceDisplay}</div>
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
        // We trigger the popup before disabling the button for better UX
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
    
    const now = new Date();
    const expirationDate = userData.expirationDate ? new Date(userData.expirationDate) : null;
    if (expirationDate && expirationDate < now) {
        alert("⛔ Your ID is expired! Please renew your ID to purchase items.");
        return resetBtn(btnElement);
    }

    const currentBalance = Number(userData.balance || 0);
    const currentBPS = Number(userData.bpsBalance || 0);
    const activeDiscount = Number(userData.activeDiscount || 0);
    
    // --- CALCULATE COSTS ---
    let basePrice = Number(itemData.cost);
    if (activeDiscount > 0) {
        basePrice = Math.floor(basePrice * (1 - activeDiscount));
    }
    const taxAmount = Math.floor(basePrice * 0.10);
    const totalCost = basePrice + taxAmount;

    // --- TAX CONFIRMATION POPUP ---
    const confirmMsg = `Confirm Purchase: ${itemData.name}\n\n` +
                       `Price: $${basePrice.toLocaleString()}\n` +
                       `Sales Tax (10%): $${taxAmount.toLocaleString()}\n` +
                       `---------------------------\n` +
                       `Total Deduction: $${totalCost.toLocaleString()}\n\n` +
                       `Would you like to proceed?`;

    if (!confirm(confirmMsg)) {
        return resetBtn(btnElement); // User cancelled
    }

    // Now disable and process
    btnElement.disabled = true;
    btnElement.textContent = "Processing...";

    if (currentBalance < totalCost) {
        alert(`Insufficient funds! Total cost with tax is $${totalCost.toLocaleString()}`);
        return resetBtn(btnElement);
    }

    const newBalance = currentBalance - totalCost;
    const newBPS = currentBPS + 5; 

    await updateDoc(userRef, {
      balance: newBalance,
      bpsBalance: newBPS,
      activeDiscount: 0
    });

    await logHistory(user.uid, `Bought ${itemData.name}: $${basePrice.toLocaleString()} + $${taxAmount.toLocaleString()} tax`, "purchase");

    await addDoc(inventoryRef, {
      name: itemData.name,
      value: Math.floor(basePrice / 2),
      originalId: itemId,
      acquiredAt: new Date().toISOString()
    });
    
    alert(`Purchased ${itemData.name}! \nTotal paid: $${totalCost.toLocaleString()}`);
    
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

auth.onAuthStateChanged((user) => { 
    if (user) loadShopItems(); 
});

setInterval(() => {
  if (localUserData) {
    renderShop(); 
  }
}, 10000);

export { loadShopItems, renderShop };