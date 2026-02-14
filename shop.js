// ---------- shop.js (QUOTA OPTIMIZED + USAGE-BASED PERKS + SLACK NOTIFICATIONS) ----------
console.log("shop.js loaded");

import { db, auth } from "./firebaseConfig.js";
import { 
  doc, getDoc, updateDoc, collection, getDocs, addDoc, increment 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { logHistory } from "./historyManager.js";
import { PLANS, isNextItemFree } from "./membership_plans.js";
import { sendSlackMessage } from "./slackNotifier.js"; // <-- NEW

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
  
  // Membership Plan Context
  const tier = localUserData?.membershipLevel || 'standard';
  const plan = PLANS[tier];
  const isFree = isNextItemFree('shop', localUserData);

  currentShopItems.forEach((item) => {
    const originalCost = Number(item.cost);
    
    let discountedPrice = originalCost;
    if (activeDiscount > 0) {
      discountedPrice = Math.floor(originalCost * (1 - activeDiscount));
    }

    // Calculate dynamic cost based on membership perks
    const taxRate = plan.taxRate;
    const taxAmount = isFree ? 0 : Math.floor(discountedPrice * taxRate);
    const totalCost = isFree ? 0 : discountedPrice + taxAmount;

    // UI shows ONLY the base price for a clean look, or "FREE" if perk active
    let priceDisplay = `
      <div style="font-weight: bold; font-size: 1.1em;">
        ${isFree ? `<span style="color: #2ecc71;">FREE ITEM! 🎁</span>` : 
          `${activeDiscount > 0 ? `<span style="text-decoration: line-through; color: gray; font-size: 0.8em;">$${originalCost.toLocaleString()}</span> ` : ""}
           $${discountedPrice.toLocaleString()}`
        }
      </div>
    `;

    const affordable = userBalance >= totalCost;
    const isDisabled = !affordable || (localUserData?.expirationDate && new Date(localUserData.expirationDate) < new Date());

    let btnText = isFree ? "Claim Free Item" : (affordable ? "Buy" : "Need Cash 💸");

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

    // --- MEMBERSHIP CALCULATION ---
    const tier = userData.membershipLevel || 'standard';
    const plan = PLANS[tier];
    const isFree = isNextItemFree('shop', userData);
    const activeDiscount = Number(userData.activeDiscount || 0);
    
    let basePrice = Number(itemData.cost);
    if (activeDiscount > 0) {
        basePrice = Math.floor(basePrice * (1 - activeDiscount));
    }

    const taxAmount = isFree ? 0 : Math.floor(basePrice * plan.taxRate);
    const totalCost = isFree ? 0 : basePrice + taxAmount;

    // --- TAX CONFIRMATION POPUP ---
    let confirmMsg = "";
    if (isFree) {
        confirmMsg = `🎁 Claim your FREE Membership Item: ${itemData.name}?`;
    } else {
        confirmMsg = `Confirm Purchase: ${itemData.name}\n\n` +
                     `Price: $${basePrice.toLocaleString()}\n` +
                     `Tax (${plan.taxRate * 100}%): $${taxAmount.toLocaleString()}\n` +
                     `---------------------------\n` +
                     `Total Deduction: $${totalCost.toLocaleString()}\n\n` +
                     `Would you like to proceed?`;
    }

    if (!confirm(confirmMsg)) {
        return resetBtn(btnElement);
    }

    // Now disable and process
    btnElement.disabled = true;
    btnElement.textContent = "Processing...";

    if (Number(userData.balance || 0) < totalCost) {
        alert(`Insufficient funds! Total cost is $${totalCost.toLocaleString()}`);
        return resetBtn(btnElement);
    }

    // --- UPDATE OBJECT ---
    const updates = {
      balance: increment(-totalCost),
      bpsBalance: increment(plan.bpsPerPurchase),
      activeDiscount: 0
    };

    // LOGIC CHANGE: We ONLY reset the counter if a free item was claimed.
    // Progression (+1) now happens in inventory.js upon usage.
    if (isFree) {
        updates.shopOrderCount = 0;
    }

    await updateDoc(userRef, updates);

    const logMsg = isFree ? `FREE CLAIM: ${itemData.name}` : `Bought ${itemData.name}: $${basePrice.toLocaleString()} + $${taxAmount.toLocaleString()} tax`;
    await logHistory(user.uid, logMsg, "purchase");

    // --- INVENTORY ADDITION ---
    await addDoc(inventoryRef, {
      name: itemData.name,
      value: isFree ? 0 : Math.floor(basePrice / 2),
      originalId: itemId,
      acquiredAt: new Date().toISOString(),
      isFree: isFree 
    });

    // --- SLACK NOTIFICATION ---
    sendSlackMessage(
      `${localUserData?.displayName || 'A user'} bought '${itemData.name}' for $${totalCost.toLocaleString()}!`
    );
    
    alert(isFree ? `🎁 Enjoy your free item!` : `Purchased ${itemData.name}! \nTotal paid: $${totalCost.toLocaleString()}`);
    
    // Refresh local cache and UI
    localUserData = { ...userData, ...updates, balance: (Number(userData.balance) - totalCost) };
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
