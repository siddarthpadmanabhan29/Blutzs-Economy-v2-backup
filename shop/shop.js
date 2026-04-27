// ---------- shop.js (QUOTA OPTIMIZED + SYSTEM UI INTEGRATED) ----------
console.log("shop.js loaded");

import { db, auth } from "../firebaseConfig.js";
import { 
 doc, getDoc, updateDoc, collection, getDocs, addDoc, increment 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { logHistory } from "../historyManager.js";
import { PLANS, isNextItemFree } from "../membership_plans.js";
import { sendSlackMessage } from "../slackNotifier.js";
// NEW: Import the central source of truth for economy math
import { getLiveMarketRate } from "../economyUtils.js";

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
 * Renders the shop UI based on local variables with updated high-fidelity design.
 */
function renderShop(externalUserData = null) {
  if (!shopItemsContainer) return;

  if (externalUserData) localUserData = externalUserData;
  
  shopItemsContainer.innerHTML = "";

  // Update Global Dashboard Stats Bar with Real-Time Resistance Math
  populateSummaryBar(localUserData);

  if (currentShopItems.length === 0) {
    shopItemsContainer.innerHTML = "<p style='color:gray; font-style:italic; text-align:center; grid-column: 1/-1; padding: 20px;'>No items found in market catalog...</p>";
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
    let priceDisplay = isFree ? `<span style="color: #2ecc71; font-weight: 800;">FREE 🎁</span>` : 
          `$${discountedPrice.toLocaleString()}`;

    const affordable = userBalance >= totalCost;
    const isExpired = localUserData?.expirationDate && new Date(localUserData.expirationDate) < new Date();
    
    // ========== STOCK MANAGEMENT ==========
    const stock = Number(item.stock || 0);
    const outOfStock = stock <= 0;
    const isDisabled = !affordable || isExpired || outOfStock;

    let btnText = isFree ? "Claim" : (affordable ? "Purchase" : "Insufficient");

    const itemCard = document.createElement("div");
    itemCard.classList.add("shop-item");
    
    // FIXED: Added missing colons (:) and semicolons (;) for position and overflow
    itemCard.style.cssText = `
        background: #1a1a1a;
        border: 1px solid #333;
        border-radius: 16px;
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 15px;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
        text-align: center;
        box-shadow: 0 4px 10px rgba(0,0,0,0.2);
        position: relative;
        overflow: hidden;
        ${outOfStock ? 'opacity: 0.6;' : ''}
    `;

    let discountBadgeHTML = "";
    if (activeDiscount > 0 && !isFree) {
        const discountPercent = Math.round(activeDiscount * 100);
        discountBadgeHTML = `
            <div style="
                position: absolute;
                top: 12px;
                right: -32px;
                background: #e67e22;
                color: white;
                font-size: 0.6rem;
                font-weight: 900;
                padding: 5px 35px;
                transform: rotate(45deg);
                box-shadow: 0 2px 5px rgba(0,0,0,0.3);
                text-transform: uppercase;
                letter-spacing: 1px;
                z-index: 10;
                pointer-events: none;
            ">
                ${discountPercent}% OFF
            </div>
        `;
    }

    // ========== OUT OF STOCK BADGE ==========
    let outOfStockBadgeHTML = "";
    if (outOfStock) {
        outOfStockBadgeHTML = `
            <div style="
                position: absolute;
                top: 12px;
                left: 12px;
                background: #e74c3c;
                color: white;
                font-size: 0.65rem;
                font-weight: 900;
                padding: 6px 12px;
                border-radius: 20px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                z-index: 10;
                pointer-events: none;
            ">
                OUT OF STOCK
            </div>
        `;
    }

    itemCard.onmouseenter = () => { if (!outOfStock) itemCard.style.transform = "translateY(-4px)"; };
    itemCard.onmouseleave = () => { itemCard.style.transform = "translateY(0)"; };

    // ========== BUTTON TEXT AND COLOR LOGIC ==========
    let btnColor = '#3498db';
    if (outOfStock) {
        btnText = "Out of Stock";
        btnColor = '#555';
    } else if (!affordable) {
        btnText = "Insufficient";
        btnColor = '#e74c3c';
    } else if (isExpired) {
        btnText = "ID Expired";
        btnColor = '#e67e22';
    }

    itemCard.innerHTML = `
        ${discountBadgeHTML}
        ${outOfStockBadgeHTML}
        <div class="shop-item-image" style="width:100%; height:120px; border-radius:8px; overflow:hidden; background:rgba(0,0,0,0.1);">
          <img src="${item.image || 'https://via.placeholder.com/150?text=Item'}" alt="${item.name}" style="width:100%; height:100%; object-fit:cover;">
        </div>
        <div class="shop-item-info">
          <h4 style="margin:0; font-size: 0.9rem;">${item.name}</h4>
        <div class="shop-price" style="margin: 5px 0;">
            ${activeDiscount > 0 && !isFree ? `<span style="text-decoration: line-through; color: gray; font-size: 0.7rem; margin-right:5px;">$${originalCost.toLocaleString()}</span>` : ""}
            <span style="font-weight: 800; color: ${isFree ? '#2ecc71' : 'var(--text-main)'};">${priceDisplay}</span>
        </div>
        <div style="font-size: 0.75rem; color: ${stock >= 5 ? '#2ecc71' : stock > 0 ? '#f39c12' : '#e74c3c'}; font-weight: 700; margin: 5px 0;">
          ${stock >= 5 ? `✓ In Stock (${stock})` : stock > 0 ? `⚠ Only ${stock} left` : '❌ Out of Stock'}
        </div>
        <button class="buy-item-btn" data-id="${item.id}" ${isDisabled ? "disabled" : ""} 
            style="width: 100%; padding: 8px; border-radius: 6px; border:none; background: ${isDisabled ? '#555' : btnColor}; color:white; font-weight:bold; cursor:${isDisabled ? 'not-allowed' : 'pointer'};">
          ${btnText}
        </button>
      </div>
    `;

    shopItemsContainer.appendChild(itemCard);
  });

  attachBuyListeners();
}

/**
 * Syncs the dashboard's top stats bar with dynamic Resistance math
 */
async function populateSummaryBar(data) {
    if (!data) return;
    
    // FETCH REAL DATA using the shared logic (Wealth / Index * 1350)
    const { rate, globalSupply, volatilityIndex: adminIndex } = await getLiveMarketRate();

    // CALCULATE USER SPECIFIC WEALTH
    const balance = Number(data.balance || 0);
    
    // FIX: Ensure bps is extracted as a number and not an [object Object]
    let bps = 0;
    if (data.bpsBalance !== undefined && data.bpsBalance !== null) {
        if (typeof data.bpsBalance === 'object') {
            bps = Number(data.bpsBalance.value || data.bpsBalance.amount || 0);
        } else {
            bps = Number(data.bpsBalance);
        }
    }

    const retirement = Number(data.retirementSavings || 0);
    
    // Net Worth synced with the Resistance dynamic rate
    const netWorth = balance + retirement + (bps * rate);

    // Target Dashboard IDs from index.html
    const totalWealthEl = document.getElementById("stat-total-wealth");
    const balanceEl = document.getElementById("user-balance");
    const bpsEl = document.getElementById("user-bps");
    const bpsRateHeader = document.getElementById("dynamic-bps-rate");

    if (totalWealthEl) totalWealthEl.textContent = `$${netWorth.toLocaleString()}`;
    if (balanceEl) balanceEl.textContent = `$${balance.toLocaleString()}`;
    if (bpsEl) bpsEl.textContent = `${bps.toLocaleString()}`;
    if (bpsRateHeader) bpsRateHeader.textContent = `$${rate.toLocaleString()}`;

    // Update Dashboard Market Status
    const marketStatusLabel = document.getElementById("volatility-display");
    if (marketStatusLabel) {
        if (adminIndex > 45000000) {
            marketStatusLabel.textContent = "HEAVY RESISTANCE";
            marketStatusLabel.style.color = "#e74c3c";
        } else if (adminIndex < 25000000) {
            marketStatusLabel.textContent = "OPEN MARKET";
            marketStatusLabel.style.color = "#2ecc71";
        } else {
            marketStatusLabel.textContent = "STABLE MARKET";
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
                     `Tax (${plan.taxRate * 100}%):$${taxAmount.toLocaleString()}\n` +
                     `---------------------------\n` +
                     `Total Deduction: $${totalCost.toLocaleString()}\n\n` +
                     `Would you like to proceed?`;
    }

    if (!confirm(confirmMsg)) {
        return resetBtn(btnElement);
    }

    // Now disable and process
    btnElement.disabled = true;
    btnElement.textContent = "Wait...";

    if (Number(userData.balance || 0) < totalCost) {
        alert(`Insufficient funds! Total cost is$${totalCost.toLocaleString()}`);
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
        purchaseCount: increment(1),
        stock: increment(-1),  // Decrease stock by 1
        lastPurchasedAt: new Date().toISOString()
    };

    // Run updates
    await Promise.all([
        updateDoc(userRef, updates),
        updateDoc(itemRef, shopItemUpdate) 
    ]);

    const logMsg = isFree ? `FREE CLAIM: ${itemData.name}` : `Bought ${itemData.name}: $${basePrice.toLocaleString()} +$${taxAmount.toLocaleString()} tax`;
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
    const buyerName = userData.username || 'Unknown user';
    sendSlackMessage(`🛒 *Purchase:* ${buyerName} bought ${itemData.name} for *$${totalCost.toLocaleString()}*`);
    
    alert(isFree ? `🎁 Enjoy your free item!` : `Purchased ${itemData.name}!`);
    
    // Update local context and re-render
    // FIX: Use numerical calculations for localUserData instead of the Firestore increment objects
    const newBalance = Number(userData.balance || 0) - totalCost;
    const newBpsBalance = Number(userData.bpsBalance || 0) + plan.bpsPerPurchase;
    
    localUserData = { 
        ...userData, 
        balance: newBalance, 
        bpsBalance: newBpsBalance, 
        activeDiscount: 0 
    };
    
    if (isFree) localUserData.shopOrderCount = 0;
    
    // Update the item stock in local data
    const itemIndex = currentShopItems.findIndex(i => i.id === itemId);
    if (itemIndex !== -1) {
        currentShopItems[itemIndex].stock = Math.max(0, (currentShopItems[itemIndex].stock || 1) - 1);
    }
    
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
        btn.textContent = "Purchase";
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