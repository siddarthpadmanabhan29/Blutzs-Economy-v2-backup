// ---------- inventory.js (FIXED: Prevents Multiple Clicks) ----------
console.log("inventory.js loaded");

import { db, auth } from "./firebaseConfig.js";
import { 
  doc, getDoc, updateDoc, onSnapshot, collection, deleteDoc, arrayUnion 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { updateBalanceDisplay } from "./main.js";

const inventoryContainer = document.getElementById("inventory-items");
const inventoryValueEl = document.getElementById("inventory-value");

function loadInventory() {
  auth.onAuthStateChanged(async (user) => {
    if (!user) return;

    const userRef = doc(db, "users", user.uid);
    const invRef = collection(userRef, "inventory");

    onSnapshot(invRef, (snapshot) => {
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
        
        // Style coupons differently
        if (item.type === 'coupon') {
            itemCard.classList.add('coupon-item'); 
            itemCard.style.border = "2px dashed #8e44ad"; 
        }

        itemCard.innerHTML = `
          <strong>${item.name}</strong><br>
          Value: $${item.value}<br>
          <button class="use-item" data-id="${itemDoc.id}">Use</button>
          <button class="sell-item" data-id="${itemDoc.id}">Sell</button>
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
  // Pass the event object (e) to the function so we can disable the button
  document.querySelectorAll(".use-item").forEach((btn) => {
    btn.addEventListener("click", (e) => useItem(btn.dataset.id, e.target));
  });

  document.querySelectorAll(".sell-item").forEach((btn) => {
    btn.addEventListener("click", (e) => sellItem(btn.dataset.id, e.target));
  });
}

// ---------- UPDATED: Use Item (Disables Button) ----------
async function useItem(itemId, btnElement) {
  const user = auth.currentUser;
  if (!user) return;

  // 1. DISABLE BUTTON IMMEDIATELY to prevent double clicks
  if(btnElement) {
    btnElement.disabled = true;
    btnElement.textContent = "Processing...";
  }

  const userRef = doc(db, "users", user.uid);
  const itemRef = doc(db, "users", user.uid, "inventory", itemId);

  try {
    const itemSnap = await getDoc(itemRef);
    if (!itemSnap.exists()) {
      alert("Item not found (already used?)");
      return; 
    }
    const itemData = itemSnap.data();

    // COUPON LOGIC
    if (itemData.type === "coupon") {
      await updateDoc(userRef, {
        activeDiscount: itemData.discountValue,
        history: arrayUnion({
            message: `Activated Coupon: ${itemData.name}`,
            type: "usage",
            timestamp: new Date().toISOString()
        })
      });

      await deleteDoc(itemRef);
      alert(`✅ Coupon Activated! You now have ${(itemData.discountValue * 100)}% off.`);
      return; 
    }

    // REGULAR ITEM LOGIC
    await Promise.all([
      updateDoc(userRef, {
        history: arrayUnion({
          message: `Used ${itemData.name}`,
          type: "usage",
          timestamp: new Date().toISOString()
        })
      }),
      deleteDoc(itemRef)
    ]);

    alert(`You used ${itemData.name}!`);

  } catch(e) {
    console.error(e);
    alert("Error using item: " + e.message);
    // If error, re-enable button so they can try again
    if(btnElement) {
      btnElement.disabled = false;
      btnElement.textContent = "Use";
    }
  }
}

async function sellItem(itemId, btnElement) {
  const user = auth.currentUser;
  if (!user) return;

  // 1. DISABLE BUTTON IMMEDIATELY
  if(btnElement) {
    btnElement.disabled = true;
    btnElement.textContent = "Selling...";
  }

  const userRef = doc(db, "users", user.uid);
  const itemRef = doc(db, "users", user.uid, "inventory", itemId);

  const [userSnap, itemSnap] = await Promise.all([getDoc(userRef), getDoc(itemRef)]);
  if (!userSnap.exists() || !itemSnap.exists()) return;

  const userData = userSnap.data();
  const item = itemSnap.data();
  const newBalance = (userData.balance || 0) + (item.value || 0);

  try {
    await Promise.all([
        updateDoc(userRef, { 
            balance: newBalance,
            history: arrayUnion({
                message: `Sold ${item.name} for $${item.value}`,
                type: "transfer-in", 
                timestamp: new Date().toISOString()
            })
        }),
        deleteDoc(itemRef)
    ]);

    updateBalanceDisplay(newBalance, "user-balance", "gain");
  } catch(e) {
    alert("Error selling item: " + e.message);
    // Re-enable on error
    if(btnElement) {
      btnElement.disabled = false;
      btnElement.textContent = "Sell";
    }
  }
}

auth.onAuthStateChanged((user) => {
  if (user) loadInventory();
});

export { loadInventory };