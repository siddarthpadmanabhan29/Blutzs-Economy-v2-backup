// ---------- inventory.js (QUOTA OPTIMIZED + MEMBERSHIP USAGE TRACKING + SLACK NOTIFICATIONS) ----------
console.log("inventory.js loaded");

import { db, auth } from "./firebaseConfig.js";
import { 
  doc, getDoc, updateDoc, onSnapshot, collection, deleteDoc, increment 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { updateBalanceDisplay } from "./main.js";
import { logHistory } from "./historyManager.js";
import { PLANS } from "./membership_plans.js";
import { sendSlackMessage } from "./slackNotifier.js"; // <-- NEW

const inventoryContainer = document.getElementById("inventory-items");
const inventoryValueEl = document.getElementById("inventory-value");

// QUOTA PROTECTION: Store the unsubscribe function globally to kill duplicate listeners
let unsubscribeInventory = null;

function loadInventory() {
  auth.onAuthStateChanged(async (user) => {
    if (unsubscribeInventory) {
      unsubscribeInventory();
      unsubscribeInventory = null;
    }

    if (!user) return;

    const userRef = doc(db, "users", user.uid);
    const invRef = collection(userRef, "inventory");

    unsubscribeInventory = onSnapshot(invRef, (snapshot) => {
      inventoryContainer.innerHTML = "";
      let totalValue = 0;

      if (snapshot.empty) {
        inventoryContainer.innerHTML = "<p>Your inventory is empty.</p>";
        inventoryValueEl.textContent = "Inventory Value: $0";
        return;
      }

      snapshot.forEach((itemDoc) => {
        const item = itemDoc.data();
        totalValue += item.value || 0;

        const itemCard = document.createElement("div");
        itemCard.classList.add("inventory-item");
        
        const isFreeItem = item.isFree === true;

        if (item.type === 'coupon') {
            itemCard.classList.add('coupon-item'); 
            itemCard.style.border = "2px dashed #8e44ad"; 
        } else if (isFreeItem) {
            itemCard.style.border = "2px solid #2ecc71"; 
        }

        itemCard.innerHTML = `
          <strong>${item.name}</strong><br>
          ${isFreeItem ? `<span style="color: #e74c3c; font-weight: bold;">UNSELLABLE 🎁</span>` : `Value: $${item.value}`}<br>
          <button class="use-item" data-id="${itemDoc.id}">Use</button>
          ${!isFreeItem ? `<button class="sell-item" data-id="${itemDoc.id}">Sell</button>` : ''}
        `;
        inventoryContainer.appendChild(itemCard);
      });

      inventoryValueEl.textContent = `Inventory Value: $${totalValue}`;
      attachInventoryListeners();
    }, (error) => {
      console.error("Inventory Error:", error);
      inventoryContainer.innerHTML = "<p style='color:red'>Error loading inventory.</p>";
    });
  });
}

function attachInventoryListeners() {
  document.querySelectorAll(".use-item").forEach((btn) => {
    btn.addEventListener("click", (e) => useItem(btn.dataset.id, e.target));
  });

  document.querySelectorAll(".sell-item").forEach((btn) => {
    btn.addEventListener("click", (e) => sellItem(btn.dataset.id, e.target));
  });
}

// ---------- Use Item ----------
async function useItem(itemId, btnElement) {
  const user = auth.currentUser;
  if (!user) return;

  if(btnElement) {
    btnElement.disabled = true;
    btnElement.textContent = "Processing...";
  }

  const userRef = doc(db, "users", user.uid);
  const itemRef = doc(db, "users", user.uid, "inventory", itemId);

  try {
    const [userSnap, itemSnap] = await Promise.all([getDoc(userRef), getDoc(itemRef)]);
    
    if (!userSnap.exists() || !itemSnap.exists()) {
      alert("Item not found (already used?)");
      return; 
    }
    
    const userData = userSnap.data();
    const itemData = itemSnap.data();
    const tier = userData.membershipLevel || 'standard';
    const plan = PLANS[tier];

    const buyerName = userData.displayName || userData.username || 'Unknown user';
    const timestamp = new Date().toLocaleString();

    // 1. Handle Coupon Logic
    if (itemData.type === "coupon") {
      await updateDoc(userRef, { activeDiscount: itemData.discountValue });
      await logHistory(user.uid, `Activated Coupon: ${itemData.name}`, "usage");
      await deleteDoc(itemRef);
      alert(`✅ Coupon Activated! You now have ${(itemData.discountValue * 100)}% off.`);

      // --- SLACK NOTIFICATION ---
      sendSlackMessage(
        `🎯 *Item Used!* \n*User:* ${buyerName} \n*Item:* ${itemData.name} \n*Type:* Coupon \n*Time:* ${timestamp}`
      );
      return; 
    }

    // 2. Handle Membership Perk Updates (Cashback + Order Counting)
    const updates = {};
    let cashbackMsg = "";

    if (itemData.type !== "coupon") {
        if (plan.cashback > 0) {
            const purchasePriceEstimate = itemData.value * 2;
            const cashbackAmount = Math.floor(purchasePriceEstimate * plan.cashback);
            if (cashbackAmount > 0) {
                updates.balance = increment(cashbackAmount);
                cashbackMsg = ` (Received $${cashbackAmount.toLocaleString()} Cashback!)`;
            }
        }

        if (plan.shopFreeFreq > 0 && itemData.isFree !== true) {
            updates.shopOrderCount = increment(1);
        }
    }

    if (Object.keys(updates).length > 0) {
        await updateDoc(userRef, updates);
        if (updates.balance) {
            const cashbackVal = Math.floor((itemData.value * 2) * plan.cashback);
            updateBalanceDisplay(Number(userData.balance) + cashbackVal, "user-balance", "gain");
        }
    }

    await logHistory(user.uid, `Used ${itemData.name}${cashbackMsg}`, "usage");
    await deleteDoc(itemRef);
    alert(`You used ${itemData.name}!${cashbackMsg}`);

    // --- SLACK NOTIFICATION ---
    sendSlackMessage(
      `🎯 *Item Used!* \n*User:* ${buyerName} \n*Item:* ${itemData.name} \n*Type:* Regular \n*Time:* ${timestamp}`
    );

  } catch(e) {
    console.error(e);
    alert("Error using item: " + e.message);
    if(btnElement) {
      btnElement.disabled = false;
      btnElement.textContent = "Use";
    }
  }
}

// ---------- Sell Item ----------
async function sellItem(itemId, btnElement) {
  const user = auth.currentUser;
  if (!user) return;

  if(btnElement) {
    btnElement.disabled = true;
    btnElement.textContent = "Selling...";
  }

  const userRef = doc(db, "users", user.uid);
  const itemRef = doc(db, "users", user.uid, "inventory", itemId);

  try {
    const [userSnap, itemSnap] = await Promise.all([getDoc(userRef), getDoc(itemRef)]);
    if (!userSnap.exists() || !itemSnap.exists()) return;

    const userData = userSnap.data();
    const item = itemSnap.data();

    if (item.isFree === true) {
        alert("⛔ Membership 'Free Items' cannot be sold for cash.");
        if(btnElement) {
            btnElement.disabled = true;
            btnElement.textContent = "Locked";
        }
        return;
    }

    const newBalance = (userData.balance || 0) + (item.value || 0);

    await updateDoc(userRef, { balance: newBalance });
    await logHistory(user.uid, `Sold ${item.name} for $${item.value}`, "transfer-in");
    await deleteDoc(itemRef);
    updateBalanceDisplay(newBalance, "user-balance", "gain");

    // --- SLACK NOTIFICATION ---
    const sellerName = userData.displayName || userData.username || 'Unknown user';
    const timestamp = new Date().toLocaleString();
    sendSlackMessage(
      `💰 *Item Sold!* \n*User:* ${sellerName} \n*Item:* ${item.name} \n*Amount:* $${item.value} \n*Time:* ${timestamp}`
    );

  } catch(e) {
    alert("Error selling item: " + e.message);
    if(btnElement) {
      btnElement.disabled = false;
      btnElement.textContent = "Sell";
    }
  }
}

// Initial Call
loadInventory();

export { loadInventory };
