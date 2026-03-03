// ---------- shop.js (QUOTA OPTIMIZED + REAL-TIME ECONOMY UTILS) ----------
console.log("shop.js loaded");

import { db, auth } from "./firebaseConfig.js";
import { 
 doc, getDoc, updateDoc, collection, getDocs, addDoc, increment 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { logHistory } from "./historyManager.js";
import { PLANS, isNextItemFree } from "./membership_plans.js";
import { sendSlackMessage } from "./slackNotifier.js";
// NEW: Import the central source of truth for economy math
import { getLiveMarketRate } from "./economyUtils.js";

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

  // Update Summary Bar with Real-Time Resistance Math
  populateSummaryBar(localUserData);

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
          `${activeDiscount > 0 ? `<span style="text-decoration: line-through; color: gray; font-size: 0.8em;">$${originalCost.toLocaleString()}</span> ` : ""} $${discountedPrice.toLocaleString()}`
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

/**
 * Calculates and displays the top summary stats using Resistance Model
 */
async function populateSummaryBar(data) {
    if (!data) return;
    
    // FETCH REAL DATA using the shared logic (Wealth / Index * 1350)
    const { rate, globalSupply, volatilityIndex: adminIndex } = await getLiveMarketRate();

    // CALCULATE USER SPECIFIC WEALTH
    const balance = data.balance || 0;
    const bps = data.bpsBalance || 0;
    const retirement = data.retirementSavings || 0;
    
    // Net Worth synced with the Resistance dynamic rate
    const netWorth = balance + retirement + (bps * rate);

    const totalWealthEl = document.getElementById("stat-total-wealth");
    const balanceEl = document.getElementById("stat-balance");
    const bpsEl = document.getElementById("stat-bps");
    const bpsRateHeader = document.getElementById("bps-rate-display");

    if (totalWealthEl) totalWealthEl.textContent = `$${netWorth.toLocaleString()}`;
    if (balanceEl) balanceEl.textContent = `$${balance.toLocaleString()}`;
    if (bpsEl) bpsEl.textContent = `${bps.toLocaleString()} BPS`;
    if (bpsRateHeader) bpsRateHeader.textContent = `$${rate.toLocaleString()}`;

    // Update market status badge based on RESISTANCE levels (Admin Index)
    const marketStatusLabel = document.getElementById("market-status-badge");
    if (marketStatusLabel) {
        if (adminIndex > 45000000) {
            marketStatusLabel.textContent = "HEAVY RESISTANCE";
            marketStatusLabel.style.color = "#e74c3c";
        } else if (adminIndex < 25000000) {
            marketStatusLabel.textContent = "OPEN MARKET";
            marketStatusLabel.style.color = "#2ecc71";
        } else {
            marketStatusLabel.textContent = "STABLE";
            marketStatusLabel.style.color = "#3498db";
        }
    }
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

    // --- UPDATE USER OBJECT ---
    const updates = {
      balance: increment(-totalCost),
      bpsBalance: increment(plan.bpsPerPurchase),
      activeDiscount: 0
    };

    if (isFree) {
        updates.shopOrderCount = 0;
    }

    // --- UPDATE GLOBAL ECONOMY STATS ---
    const shopItemUpdate = {
        purchaseCount: increment(1)
    };

    // Run updates
    await Promise.all([
        updateDoc(userRef, updates),
        updateDoc(itemRef, shopItemUpdate) 
    ]);

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
    const buyerName = userData.displayName || userData.username || 'Unknown user';
    const timestamp = new Date().toLocaleString();
    sendSlackMessage(
      `🛒 *Purchase Alert!* \n*User:* ${buyerName} \n*Item:* ${itemData.name} \n*Amount:* $${totalCost.toLocaleString()} \n*Time:* ${timestamp}`
    );
    
    alert(isFree ? `🎁 Enjoy your free item!` : `Purchased ${itemData.name}! \nTotal paid: $${totalCost.toLocaleString()}`);
    
    // DATA ENGINEERING FIX: updates object already contains the delta via increment,
    // so we update the local balance correctly for the UI render.
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

// Periodic refresh to keep BPS rates and Status Labels live in the Shop UI
setInterval(() => {
  if (localUserData) {
    renderShop(); 
  }
}, 15000); 

export { loadShopItems, renderShop };