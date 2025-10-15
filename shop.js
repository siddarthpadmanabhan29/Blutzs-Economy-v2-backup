// ---------- shop.js ----------
console.log("shop.js loaded");

import { db, auth } from "./firebaseConfig.js";
import { 
  doc, getDoc, updateDoc, collection, onSnapshot, arrayUnion 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { updateBalanceDisplay } from "./main.js";

// Container for shop items
const shopItemsContainer = document.getElementById("shop-items");

// Load shop items with realtime updates
async function loadShopItems() {
  const user = auth.currentUser;
  if (!user) return;

  // Get the user's balance first
  const userRef = doc(db, "users", user.uid);
  const userSnap = await getDoc(userRef);
  const userBalance = userSnap.exists() ? Number(userSnap.data().balance || 0) : 0;

  const shopRef = collection(db, "shop");
  onSnapshot(shopRef, (snapshot) => {
    shopItemsContainer.innerHTML = "";

    if (snapshot.empty) {
      shopItemsContainer.innerHTML = "<p>No items available in the shop.</p>";
      return;
    }

    snapshot.forEach((docSnap) => {
      const item = docSnap.data();
      const cost = Number(item.cost);
      const affordable = userBalance >= cost;

      const itemCard = document.createElement("div");
      itemCard.classList.add("shop-item");
      if (!affordable) itemCard.classList.add("unaffordable");

      itemCard.innerHTML = `
        <div class="shop-item-image">
          <img src="${item.image || 'https://via.placeholder.com/150?text=No+Image'}" alt="${item.name}">
        </div>
        <div class="shop-item-info">
          <h4>${item.name}</h4>
          <p class="shop-price">$${cost.toLocaleString()}</p>
          <button class="btn-primary buy-item-btn" data-id="${docSnap.id}" ${!affordable ? "disabled" : ""}>
            ${affordable ? "Buy" : "Not Enough Money 💸"}
          </button>
        </div>
      `;

      shopItemsContainer.appendChild(itemCard);
    });

    attachBuyListeners();
  });
}

// Attach buy button listeners
function attachBuyListeners() {
  document.querySelectorAll(".buy-item-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const itemId = btn.dataset.id;
      await buyItem(itemId);
    });
  });
}

// Buy an item
async function buyItem(itemId) {
  const user = auth.currentUser;
  if (!user) return alert("You must be logged in.");

  const userRef = doc(db, "users", user.uid);
  const itemRef = doc(db, "shop", itemId);

  const [userSnap, itemSnap] = await Promise.all([getDoc(userRef), getDoc(itemRef)]);
  if (!userSnap.exists() || !itemSnap.exists()) return alert("User or item not found.");

  const userData = userSnap.data();
  const itemData = itemSnap.data();
  const balance = Number(userData.balance || 0);
  const cost = Number(itemData.cost);

  if (balance < cost) {
    return alert("Not enough balance to buy this item!");
  }

  const newBalance = balance - cost;

  try {
    // Update user balance, inventory, and history atomically
    await updateDoc(userRef, {
      balance: newBalance,
      [`inventory.${itemId}`]: (userData.inventory?.[itemId] || 0) + 1,
      history: arrayUnion({
        message: `Bought ${itemData.name} for $${cost.toLocaleString()}`,
        type: "purchase",
        timestamp: new Date().toISOString()
      })
    });

    // Update UI balance
    updateBalanceDisplay(newBalance, "user-balance", "loss");

    alert(`You purchased ${itemData.name} for $${cost}!`);
    console.log(`Purchased ${itemData.name} for $${cost}`);
  } catch (err) {
    console.error("Purchase failed:", err);
    alert("Purchase failed. Try again later.");
  }
}

// Initialize shop only when logged in
auth.onAuthStateChanged((user) => {
  if (user) loadShopItems();
});

export { loadShopItems };
