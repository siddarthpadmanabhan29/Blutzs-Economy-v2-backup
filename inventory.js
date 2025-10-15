// ---------- inventory.js ----------
console.log("inventory.js loaded");

import { db, auth } from "./firebaseConfig.js";
import { 
  doc, getDoc, updateDoc, onSnapshot, collection 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { updateBalanceDisplay } from "./main.js";

const inventoryContainer = document.getElementById("inventory-items");
const inventoryValueEl = document.getElementById("inventory-value");

// ---------- Load Inventory ----------
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
    });
  });
}

// ---------- Button Actions ----------
function attachInventoryListeners() {
  document.querySelectorAll(".use-item").forEach((btn) => {
    btn.addEventListener("click", () => useItem(btn.dataset.id));
  });

  document.querySelectorAll(".sell-item").forEach((btn) => {
    btn.addEventListener("click", () => sellItem(btn.dataset.id));
  });
}

// ---------- Use Item ----------
async function useItem(itemId) {
  const user = auth.currentUser;
  if (!user) return alert("You must be logged in.");

  const itemRef = doc(db, "users", user.uid, "inventory", itemId);
  const itemSnap = await getDoc(itemRef);
  if (!itemSnap.exists()) return alert("Item not found.");

  const item = itemSnap.data();

  // Example: Using item just deletes it (you can expand logic later)
  await updateDoc(itemRef, { used: true });
  alert(`You used ${item.name}!`);
}

// ---------- Sell Item ----------
async function sellItem(itemId) {
  const user = auth.currentUser;
  if (!user) return alert("You must be logged in.");

  const userRef = doc(db, "users", user.uid);
  const itemRef = doc(db, "users", user.uid, "inventory", itemId);

  const [userSnap, itemSnap] = await Promise.all([getDoc(userRef), getDoc(itemRef)]);
  if (!userSnap.exists() || !itemSnap.exists()) return;

  const userData = userSnap.data();
  const item = itemSnap.data();

  const newBalance = (userData.balance || 0) + (item.value || 0);

  // Remove item from inventory and update balance
  await updateDoc(userRef, { balance: newBalance });
  await updateDoc(itemRef, { sold: true });

  updateBalanceDisplay(newBalance, "user-balance", "gain");
  alert(`You sold ${item.name} for $${item.value}!`);
}

// ---------- Export ----------
export { loadInventory };
