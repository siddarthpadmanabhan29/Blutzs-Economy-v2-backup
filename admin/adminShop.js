import { db, auth } from "../firebaseConfig.js";
import { 
  collection, addDoc, onSnapshot, getDocs, updateDoc, doc, deleteDoc 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { getDOMElements, logAdminAction } from "./adminUtils.js";

let shopItems = [];
let subscriptionItems = [];
let activeShopListener = null;
let activeSubListener = null;

export function initShopUI() {
  const el = getDOMElements();
  
  if (el.addItemBtn) {
    el.addItemBtn.addEventListener("click", addShopItem);
  }

  if (el.adminShopInventory) {
    el.adminShopInventory.addEventListener("click", handleShopActions);
  } else {
    console.warn("❌ Admin shop inventory container not found - buttons won't work");
  }

  // Start real-time listener
  listenForShopItems();
}

/**
 * Real-time listener for shop items
 */
export function listenForShopItems() {
  const shopRef = collection(db, "shop");
  
  if (activeShopListener) activeShopListener();

  activeShopListener = onSnapshot(shopRef, (snapshot) => {
    shopItems = [];
    snapshot.forEach((doc) => {
      shopItems.push({ id: doc.id, ...doc.data() });
    });
    renderAdminShopUI();
  }, (err) => {
    console.error("❌ Failed to listen to shop items:", err);
  });
}

/**
 * Renders the admin shop management UI
 */
function renderAdminShopUI() {
  const el = getDOMElements();
  
  if (!el.adminShopInventory) {
    console.warn("Admin shop inventory container not found");
    return;
  }

  el.adminShopInventory.innerHTML = "";

  if (shopItems.length === 0) {
    el.adminShopInventory.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; color: #888; padding: 30px;">
        <p>📦 No items in shop yet. Add one below!</p>
      </div>
    `;
    return;
  }

  shopItems.forEach((item) => {
    const stock = Number(item.stock || 0);
    const purchaseCount = Number(item.purchaseCount || 0);

    const stockColor = stock >= 10 ? '#2ecc71' : stock > 0 ? '#f39c12' : '#e74c3c';
    const stockStatus = stock >= 10 ? 'Good Stock' : stock > 0 ? 'Low Stock' : 'Out of Stock';

    const itemBox = document.createElement("div");
    itemBox.style.cssText = `
      background: rgba(0, 0, 0, 0.2);
      border: 1px solid #333;
      border-radius: 12px;
      padding: 15px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    `;

    itemBox.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: start;">
        <div>
          <h4 style="margin: 0 0 5px 0; color: #fff;">${item.name}</h4>
          <p style="margin: 0; font-size: 0.75rem; color: #888;">
            Cost: <span style="color: #f1c40f;">$${Number(item.cost || 0).toLocaleString()}</span>
            | Purchases: <span style="color: #3498db;">${purchaseCount}</span>
          </p>
        </div>
        <div style="display: flex; gap: 8px;">
          <button data-action="edit-item" data-item-id="${item.id}" 
            style="background: #f39c12; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 0.75rem; font-weight: bold;">
            EDIT
          </button>
          <button data-action="delete-item" data-item-id="${item.id}" 
            style="background: #e74c3c; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 0.75rem; font-weight: bold;">
            DELETE
          </button>
        </div>
      </div>

      <div style="background: rgba(255, 255, 255, 0.05); padding: 12px; border-radius: 8px; border-left: 3px solid ${stockColor};">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <span style="font-size: 0.8rem; font-weight: 700; color: #888; text-transform: uppercase;">Stock Management</span>
          <span style="background: ${stockColor}; color: white; font-size: 0.65rem; padding: 3px 8px; border-radius: 4px; font-weight: bold;">
            ${stock} Units (${stockStatus})
          </span>
        </div>

        <div style="display: flex; gap: 10px; align-items: center;">
          <input type="number" data-stock-input="${item.id}" value="${stock}" min="0" max="999"
            style="width: 70px; padding: 8px; background: #111; border: 1px solid #333; border-radius: 6px; color: #fff; font-size: 0.9rem; font-weight: bold;">
          
          <button data-action="update-stock" data-item-id="${item.id}"
            style="background: #3498db; color: white; border: none; padding: 8px 15px; border-radius: 6px; cursor: pointer; font-size: 0.8rem; font-weight: bold; flex-grow: 1;">
            Update Stock
          </button>

          <div style="display: flex; gap: 5px;">
            <button data-action="adjust-stock" data-item-id="${item.id}" data-adjust="10"
              style="background: #2ecc71; color: white; border: none; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 0.75rem; font-weight: bold; min-width: 35px;">
              +10
            </button>
            <button data-action="adjust-stock" data-item-id="${item.id}" data-adjust="-10"
              style="background: #e67e22; color: white; border: none; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 0.75rem; font-weight: bold; min-width: 35px;">
              -10
            </button>
          </div>
        </div>
      </div>

      <div style="font-size: 0.75rem; color: #999;">${item.image ? '🖼️ Has image' : '❌ No image'}</div>
    `;

    el.adminShopInventory.appendChild(itemBox);
  });
}

/**
 * Handle admin shop actions (update stock, delete item, edit item, etc.)
 */
async function handleShopActions(e) {
  const action = e.target.dataset.action;
  const itemId = e.target.dataset.itemId;

  console.log("🔧 Shop action:", action, "Item:", itemId);

  if (action === "update-stock") {
    await updateItemStock(itemId);
  } else if (action === "adjust-stock") {
    const adjustment = Number(e.target.dataset.adjust);
    await adjustItemStock(itemId, adjustment);
  } else if (action === "delete-item") {
    await deleteShopItem(itemId);
  } else if (action === "edit-item") {
    showEditItemModal(itemId);
  }
}

/**
 * Update item stock from input field
 */
async function updateItemStock(itemId) {
  console.log("📝 Updating stock for item:", itemId);
  
  const el = getDOMElements();
  const inputField = document.querySelector(`input[data-stock-input="${itemId}"]`);
  
  if (!inputField) {
    console.warn("❌ Stock input field not found for item:", itemId);
    return;
  }

  const newStock = Math.max(0, parseInt(inputField.value) || 0);
  const itemRef = doc(db, "shop", itemId);

  try {
    await updateDoc(itemRef, { stock: newStock });
    const itemName = shopItems.find(i => i.id === itemId)?.name || "Item";
    await logAdminAction(auth.currentUser.uid, `Updated ${itemName} stock to ${newStock} units`);
    console.log(`✅ Updated stock for item ${itemId} to ${newStock}`);
    alert(`✅ Updated "${itemName}" stock to ${newStock} units`);
  } catch (err) {
    console.error("❌ Failed to update stock:", err);
    alert("Failed to update stock. Check console.");
  }
}

/**
 * Adjust stock by a fixed amount (+/- 10)
 */
async function adjustItemStock(itemId, adjustment) {
  console.log("⚙️ Adjusting stock for item:", itemId, "Adjustment:", adjustment);
  
  const el = getDOMElements();
  const inputField = document.querySelector(`input[data-stock-input="${itemId}"]`);
  
  if (!inputField) {
    console.warn("❌ Stock input field not found for item:", itemId);
    return;
  }

  const currentStock = Number(inputField.value || 0);
  const newStock = Math.max(0, currentStock + adjustment);
  
  inputField.value = newStock;

  const itemRef = doc(db, "shop", itemId);

  try {
    await updateDoc(itemRef, { stock: newStock });
    const itemName = shopItems.find(i => i.id === itemId)?.name || "Item";
    const action = adjustment > 0 ? `added ${adjustment}` : `removed ${Math.abs(adjustment)}`;
    await logAdminAction(auth.currentUser.uid, `${itemName}: ${action} units (now ${newStock})`);
    console.log(`✅ Adjusted ${itemName} stock by ${adjustment} (new total: ${newStock})`);
    alert(`✅ ${itemName}: ${action} units (now ${newStock})`);
  } catch (err) {
    console.error("❌ Failed to adjust stock:", err);
    alert("Failed to adjust stock. Check console.");
  }
}

/**
 * Delete a shop item
 */
async function deleteShopItem(itemId) {
  const itemName = shopItems.find(i => i.id === itemId)?.name || "Item";
  
  console.log("🗑️ Delete requested for item:", itemId, itemName);
  
  if (!confirm(`⚠️ Are you sure you want to DELETE "${itemName}" from the shop? This action cannot be undone.`)) {
    console.log("❌ Delete cancelled by user");
    return;
  }

  const itemRef = doc(db, "shop", itemId);

  try {
    await deleteDoc(itemRef);
    await logAdminAction(auth.currentUser.uid, `Deleted shop item: ${itemName}`);
    console.log(`✅ Deleted item ${itemId}`);
    alert(`✅ "${itemName}" has been removed from the shop.`);
  } catch (err) {
    console.error("❌ Failed to delete item:", err);
    alert("Failed to delete item. Check console.");
  }
}

/**
 * Show edit modal for an existing item
 */
function showEditItemModal(itemId) {
  const item = shopItems.find(i => i.id === itemId);
  if (!item) return;

  // Create modal overlay
  const modal = document.createElement("div");
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.8);
    z-index: 2000;
    display: flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(5px);
  `;

  modal.innerHTML = `
    <div style="
      background: rgba(0, 0, 0, 0.9);
      border: 1px solid #444;
      border-radius: 15px;
      padding: 25px;
      width: 90%;
      max-width: 500px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    ">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <h3 style="margin: 0; color: #fff; font-size: 1.2rem;">Edit Item: ${item.name}</h3>
        <button id="close-edit-modal" style="
          background: transparent;
          border: none;
          color: #888;
          font-size: 1.5rem;
          cursor: pointer;
          padding: 5px;
        ">×</button>
      </div>

      <div style="display: flex; flex-direction: column; gap: 15px;">
        <div>
          <label style="display: block; color: #aaa; font-size: 0.7rem; font-weight: 800; text-transform: uppercase; margin-bottom: 5px;">Item Name</label>
          <input id="edit-item-name" type="text" value="${item.name}" style="
            width: 100%;
            height: 45px;
            background: #111;
            border: 1px solid #444;
            color: #fff;
            padding: 0 15px;
            border-radius: 8px;
            box-sizing: border-box;
            font-size: 0.9rem;
          ">
        </div>

        <div>
          <label style="display: block; color: #aaa; font-size: 0.7rem; font-weight: 800; text-transform: uppercase; margin-bottom: 5px;">Price ($)</label>
          <input id="edit-item-cost" type="number" value="${item.cost || 0}" min="0" step="0.01" style="
            width: 100%;
            height: 45px;
            background: #111;
            border: 1px solid #444;
            color: #2ecc71;
            padding: 0 15px;
            border-radius: 8px;
            box-sizing: border-box;
            font-size: 0.9rem;
            font-weight: bold;
          ">
        </div>

        <div>
          <label style="display: block; color: #aaa; font-size: 0.7rem; font-weight: 800; text-transform: uppercase; margin-bottom: 5px;">Stock Quantity</label>
          <input id="edit-item-stock" type="number" value="${item.stock || 0}" min="0" style="
            width: 100%;
            height: 45px;
            background: #111;
            border: 1px solid #444;
            color: #f39c12;
            padding: 0 15px;
            border-radius: 8px;
            box-sizing: border-box;
            font-size: 0.9rem;
            font-weight: bold;
          ">
        </div>

        <div>
          <label style="display: block; color: #aaa; font-size: 0.7rem; font-weight: 800; text-transform: uppercase; margin-bottom: 5px;">Image URL (Optional)</label>
          <input id="edit-item-image" type="url" value="${item.image || ''}" placeholder="https://imgur.com/image.png" style="
            width: 100%;
            height: 45px;
            background: #111;
            border: 1px solid #444;
            color: #888;
            padding: 0 15px;
            border-radius: 8px;
            box-sizing: border-box;
            font-size: 0.8rem;
          ">
        </div>

        <div style="display: flex; gap: 10px; margin-top: 10px;">
          <button id="save-edit-item" data-item-id="${itemId}" style="
            flex: 1;
            height: 50px;
            background: #3498db;
            color: #fff;
            border: none;
            border-radius: 8px;
            font-weight: 900;
            cursor: pointer;
            text-transform: uppercase;
            letter-spacing: 1px;
          ">Save Changes</button>
          <button id="cancel-edit-item" style="
            flex: 1;
            height: 50px;
            background: #6c757d;
            color: #fff;
            border: none;
            border-radius: 8px;
            font-weight: 900;
            cursor: pointer;
            text-transform: uppercase;
            letter-spacing: 1px;
          ">Cancel</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Event listeners
  document.getElementById("close-edit-modal").addEventListener("click", () => modal.remove());
  document.getElementById("cancel-edit-item").addEventListener("click", () => modal.remove());
  document.getElementById("save-edit-item").addEventListener("click", async (e) => {
    await saveEditedItem(e.target.dataset.itemId);
    modal.remove();
  });

  // Close on background click
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.remove();
  });
}

/**
 * Save edited item changes
 */
async function saveEditedItem(itemId) {
  const name = document.getElementById("edit-item-name").value.trim();
  const cost = parseFloat(document.getElementById("edit-item-cost").value);
  const stock = parseInt(document.getElementById("edit-item-stock").value) || 0;
  const image = document.getElementById("edit-item-image").value.trim();

  if (!name || isNaN(cost) || cost < 0) {
    alert("❌ Please enter valid name and price.");
    return;
  }

  if (stock < 0) {
    alert("❌ Stock cannot be negative.");
    return;
  }

  const itemRef = doc(db, "shop", itemId);
  const originalItem = shopItems.find(i => i.id === itemId);

  try {
    const updates = {
      name,
      cost,
      stock,
      image: image || null
    };

    await updateDoc(itemRef, updates);
    
    // Log changes
    const changes = [];
    if (originalItem.name !== name) changes.push(`name: "${originalItem.name}" → "${name}"`);
    if (originalItem.cost !== cost) changes.push(`price: $${originalItem.cost} → $${cost}`);
    if (originalItem.stock !== stock) changes.push(`stock: ${originalItem.stock} → ${stock}`);
    if (originalItem.image !== image) changes.push(`image updated`);

    const changeText = changes.length > 0 ? ` (${changes.join(", ")})` : "";
    await logAdminAction(auth.currentUser.uid, `Edited item "${name}"${changeText}`);
    
    console.log(`✅ Updated item ${itemId}`);
    alert(`✅ Item "${name}" updated successfully!`);
  } catch (err) {
    console.error("❌ Failed to update item:", err);
    alert("Failed to update item. Check console.");
  }
}

/**
 * Add a new shop item
 */
async function addShopItem() {
  const el = getDOMElements();
  const name = el.newItemName?.value?.trim();
  const cost = parseFloat(el.newItemPrice?.value);
  const stock = parseInt(el.newItemStock?.value) || 10;
  const image = el.newItemImage?.value?.trim();
  
  if (!name || isNaN(cost) || cost <= 0) {
    return alert("❌ Enter valid item name and cost.");
  }
  
  if (stock < 0) {
    return alert("❌ Stock cannot be negative.");
  }

  try {
    await addDoc(collection(db, "shop"), { 
      name, 
      cost, 
      stock: stock,  // Initialize with specified stock
      image,
      purchaseCount: 0,
      createdAt: new Date().toISOString()
    });

    await logAdminAction(auth.currentUser.uid, `Added shop item: ${name} (Stock: ${stock}, Price: $${cost.toLocaleString()})`);
    
    alert(`✅ Added item: ${name} with ${stock} units in stock!`);
    
    if (el.newItemName) el.newItemName.value = "";
    if (el.newItemPrice) el.newItemPrice.value = "";
    if (el.newItemStock) el.newItemStock.value = "10";
    if (el.newItemImage) el.newItemImage.value = "";
  } catch (err) {
    console.error("❌ Error adding item:", err);
    alert("Failed to add item. Check console.");
  }
}

// ==================== SUBSCRIPTION SHOP MANAGEMENT ====================

/**
 * Initialize subscription shop admin UI
 */
export function initSubscriptionShopUI() {
  const el = getDOMElements();
  
  if (el.addSubscriptionBtn) {
    el.addSubscriptionBtn.addEventListener("click", addSubscriptionItem);
  }

  if (el.adminSubscriptionInventory) {
    el.adminSubscriptionInventory.addEventListener("click", handleSubscriptionActions);
  } else {
    console.warn("❌ Admin subscription inventory container not found");
  }

  // Start real-time listener
  listenForSubscriptionItems();
}

/**
 * Real-time listener for subscription items
 */
export function listenForSubscriptionItems() {
  const subRef = collection(db, "subscriptionShop");
  
  if (activeSubListener) activeSubListener();

  activeSubListener = onSnapshot(subRef, (snapshot) => {
    subscriptionItems = [];
    snapshot.forEach((doc) => {
      subscriptionItems.push({ id: doc.id, ...doc.data() });
    });
    renderAdminSubscriptionUI();
  }, (err) => {
    console.error("❌ Failed to listen to subscription items:", err);
  });
}

/**
 * Render subscription items in admin panel
 */
function renderAdminSubscriptionUI() {
  const el = getDOMElements();
  
  if (!el.adminSubscriptionInventory) {
    console.warn("Admin subscription inventory container not found");
    return;
  }

  el.adminSubscriptionInventory.innerHTML = "";

  if (subscriptionItems.length === 0) {
    el.adminSubscriptionInventory.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; color: #888; padding: 30px;">
        <p>💚 No subscription items yet. Add one below!</p>
      </div>
    `;
    return;
  }

  subscriptionItems.forEach((item) => {
    const subscriberCount = Number(item.subscriberCount || 0);
    const totalRevenue = Number(item.totalRevenue || 0);

    const itemBox = document.createElement("div");
    itemBox.style.cssText = `
      background: rgba(0, 0, 0, 0.2);
      border: 2px solid #2ecc71;
      border-radius: 12px;
      padding: 15px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    `;

    itemBox.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: start;">
        <div>
          <h4 style="margin: 0 0 5px 0; color: #2ecc71;">${item.name}</h4>
          <p style="margin: 0; font-size: 0.75rem; color: #888;">
            Cost: <span style="color: #f1c40f;">$${Number(item.cost || 0).toLocaleString()}</span>
            | Subscribers: <span style="color: #3498db;">${subscriberCount}</span>
            | Revenue: <span style="color: #2ecc71;">$${totalRevenue.toLocaleString()}</span>
          </p>
        </div>
        <div style="display: flex; gap: 8px;">
          <button data-action="edit-subscription" data-item-id="${item.id}" 
            style="background: #f39c12; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 0.75rem; font-weight: bold;">
            EDIT
          </button>
          <button data-action="delete-subscription" data-item-id="${item.id}" 
            style="background: #e74c3c; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 0.75rem; font-weight: bold;">
            DELETE
          </button>
        </div>
      </div>

      <div style="background: rgba(46, 204, 113, 0.1); padding: 12px; border-radius: 8px; border-left: 3px solid #2ecc71;">
        <div style="font-size: 0.8rem; color: #888; font-weight: 700; text-transform: uppercase; margin-bottom: 8px;">Renewal Settings</div>
        <div style="font-size: 0.8rem; color: #ccc;">
          <div>🔄 Renews every <span style="color: #f1c40f; font-weight: bold;">${item.renewalInterval} ${item.renewalType}</span></div>
          <div style="margin-top: 4px;">📅 First charge: <span style="color: #2ecc71;">$${Number(item.cost).toLocaleString()}</span></div>
        </div>
      </div>

      <div style="font-size: 0.75rem; color: #999;">${item.description ? '📝 ' + item.description.substring(0, 50) + '...' : '❌ No description'}</div>
    `;

    el.adminSubscriptionInventory.appendChild(itemBox);
  });
}

/**
 * Handle subscription admin actions
 */
async function handleSubscriptionActions(e) {
  const action = e.target.dataset.action;
  const itemId = e.target.dataset.itemId;

  console.log("🔧 Subscription action:", action, "Item:", itemId);

  if (action === "delete-subscription") {
    await deleteSubscriptionItem(itemId);
  } else if (action === "edit-subscription") {
    showEditSubscriptionModal(itemId);
  }
}

/**
 * Delete a subscription item
 */
async function deleteSubscriptionItem(itemId) {
  const itemName = subscriptionItems.find(i => i.id === itemId)?.name || "Item";
  
  console.log("🗑️ Delete subscription item:", itemId, itemName);
  
  if (!confirm(`⚠️ Are you sure you want to DELETE "${itemName}" subscription? This won't affect existing subscribers.`)) {
    return;
  }

  const itemRef = doc(db, "subscriptionShop", itemId);

  try {
    await deleteDoc(itemRef);
    await logAdminAction(auth.currentUser.uid, `Deleted subscription item: ${itemName}`);
    alert(`✅ "${itemName}" has been removed from subscription shop.`);
  } catch (err) {
    console.error("❌ Failed to delete subscription:", err);
    alert("Failed to delete subscription. Check console.");
  }
}

/**
 * Show edit modal for subscription item
 */
function showEditSubscriptionModal(itemId) {
  const item = subscriptionItems.find(i => i.id === itemId);
  if (!item) return;

  const modal = document.createElement("div");
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.8);
    z-index: 2000;
    display: flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(5px);
  `;

  modal.innerHTML = `
    <div style="
      background: rgba(0, 0, 0, 0.9);
      border: 2px solid #2ecc71;
      border-radius: 15px;
      padding: 25px;
      width: 90%;
      max-width: 550px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
      max-height: 90vh;
      overflow-y: auto;
    ">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <h3 style="margin: 0; color: #2ecc71; font-size: 1.2rem;">Edit Subscription: ${item.name}</h3>
        <button id="close-edit-sub-modal" style="
          background: transparent;
          border: none;
          color: #888;
          font-size: 1.5rem;
          cursor: pointer;
          padding: 5px;
        ">×</button>
      </div>

      <div style="display: flex; flex-direction: column; gap: 15px;">
        <div>
          <label style="display: block; color: #aaa; font-size: 0.7rem; font-weight: 800; text-transform: uppercase; margin-bottom: 5px;">Name</label>
          <input id="edit-sub-name" type="text" value="${item.name}" style="
            width: 100%;
            height: 45px;
            background: #111;
            border: 1px solid #2ecc71;
            color: #fff;
            padding: 0 15px;
            border-radius: 8px;
            box-sizing: border-box;
            font-size: 0.9rem;
          ">
        </div>

        <div>
          <label style="display: block; color: #aaa; font-size: 0.7rem; font-weight: 800; text-transform: uppercase; margin-bottom: 5px;">Description</label>
          <textarea id="edit-sub-desc" style="
            width: 100%;
            height: 60px;
            background: #111;
            border: 1px solid #2ecc71;
            color: #fff;
            padding: 10px;
            border-radius: 8px;
            box-sizing: border-box;
            font-size: 0.9rem;
            font-family: inherit;
          ">${item.description || ''}</textarea>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
          <div>
            <label style="display: block; color: #aaa; font-size: 0.7rem; font-weight: 800; text-transform: uppercase; margin-bottom: 5px;">Cost ($)</label>
            <input id="edit-sub-cost" type="number" value="${item.cost || 0}" min="0" step="0.01" style="
              width: 100%;
              height: 45px;
              background: #111;
              border: 1px solid #f1c40f;
              color: #f1c40f;
              padding: 0 15px;
              border-radius: 8px;
              box-sizing: border-box;
              font-size: 0.9rem;
              font-weight: bold;
            ">
          </div>
          <div>
            <label style="display: block; color: #aaa; font-size: 0.7rem; font-weight: 800; text-transform: uppercase; margin-bottom: 5px;">Renewal Interval</label>
            <input id="edit-sub-interval" type="number" value="${item.renewalInterval || 7}" min="1" style="
              width: 100%;
              height: 45px;
              background: #111;
              border: 1px solid #3498db;
              color: #3498db;
              padding: 0 15px;
              border-radius: 8px;
              box-sizing: border-box;
              font-size: 0.9rem;
              font-weight: bold;
            ">
          </div>
        </div>

        <div>
          <label style="display: block; color: #aaa; font-size: 0.7rem; font-weight: 800; text-transform: uppercase; margin-bottom: 5px;">Renewal Type</label>
          <select id="edit-sub-type" style="
            width: 100%;
            height: 45px;
            background: #111;
            border: 1px solid #3498db;
            color: #3498db;
            padding: 0 15px;
            border-radius: 8px;
            box-sizing: border-box;
            font-size: 0.9rem;
            font-weight: bold;
          ">
            <option value="days" ${item.renewalType === 'days' ? 'selected' : ''}>Days</option>
            <option value="months" ${item.renewalType === 'months' ? 'selected' : ''}>Months</option>
          </select>
        </div>

        <div>
          <label style="display: block; color: #aaa; font-size: 0.7rem; font-weight: 800; text-transform: uppercase; margin-bottom: 5px;">Image URL (Optional)</label>
          <input id="edit-sub-image" type="url" value="${item.image || ''}" placeholder="https://imgur.com/image.png" style="
            width: 100%;
            height: 45px;
            background: #111;
            border: 1px solid #888;
            color: #888;
            padding: 0 15px;
            border-radius: 8px;
            box-sizing: border-box;
            font-size: 0.8rem;
          ">
        </div>

        <div style="display: flex; gap: 10px; margin-top: 10px;">
          <button id="save-edit-subscription" data-item-id="${itemId}" style="
            flex: 1;
            height: 50px;
            background: #2ecc71;
            color: #fff;
            border: none;
            border-radius: 8px;
            font-weight: 900;
            cursor: pointer;
            text-transform: uppercase;
            letter-spacing: 1px;
          ">Save Changes</button>
          <button id="cancel-edit-subscription" style="
            flex: 1;
            height: 50px;
            background: #6c757d;
            color: #fff;
            border: none;
            border-radius: 8px;
            font-weight: 900;
            cursor: pointer;
            text-transform: uppercase;
            letter-spacing: 1px;
          ">Cancel</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  document.getElementById("close-edit-sub-modal").addEventListener("click", () => modal.remove());
  document.getElementById("cancel-edit-subscription").addEventListener("click", () => modal.remove());
  document.getElementById("save-edit-subscription").addEventListener("click", async (e) => {
    await saveEditedSubscription(e.target.dataset.itemId);
    modal.remove();
  });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.remove();
  });
}

/**
 * Save edited subscription item
 */
async function saveEditedSubscription(itemId) {
  const name = document.getElementById("edit-sub-name").value.trim();
  const description = document.getElementById("edit-sub-desc").value.trim();
  const cost = parseFloat(document.getElementById("edit-sub-cost").value);
  const renewalInterval = parseInt(document.getElementById("edit-sub-interval").value) || 7;
  const renewalType = document.getElementById("edit-sub-type").value;
  const image = document.getElementById("edit-sub-image").value.trim();

  if (!name || isNaN(cost) || cost < 0) {
    alert("❌ Please enter valid name and cost.");
    return;
  }

  if (renewalInterval < 1) {
    alert("❌ Renewal interval must be at least 1.");
    return;
  }

  const itemRef = doc(db, "subscriptionShop", itemId);
  const originalItem = subscriptionItems.find(i => i.id === itemId);

  try {
    const updates = {
      name,
      description,
      cost,
      renewalInterval,
      renewalType,
      image: image || null
    };

    await updateDoc(itemRef, updates);
    
    const changes = [];
    if (originalItem.name !== name) changes.push(`name: "${originalItem.name}" → "${name}"`);
    if (originalItem.cost !== cost) changes.push(`cost: $${originalItem.cost} → $${cost}`);
    if (originalItem.renewalInterval !== renewalInterval || originalItem.renewalType !== renewalType) 
      changes.push(`renewal: ${originalItem.renewalInterval}${originalItem.renewalType} → ${renewalInterval}${renewalType}`);

    const changeText = changes.length > 0 ? ` (${changes.join(", ")})` : "";
    await logAdminAction(auth.currentUser.uid, `Edited subscription "${name}"${changeText}`);
    
    alert(`✅ Subscription "${name}" updated successfully!`);
  } catch (err) {
    console.error("❌ Failed to update subscription:", err);
    alert("Failed to update subscription. Check console.");
  }
}

/**
 * Add new subscription item
 */
async function addSubscriptionItem() {
  const el = getDOMElements();
  const name = el.newSubscriptionName?.value?.trim();
  const description = el.newSubscriptionDesc?.value?.trim();
  const cost = parseFloat(el.newSubscriptionCost?.value);
  const renewalInterval = parseInt(el.newSubscriptionInterval?.value) || 7;
  const renewalType = el.newSubscriptionType?.value || "days";
  const image = el.newSubscriptionImage?.value?.trim();
  
  if (!name || isNaN(cost) || cost <= 0) {
    return alert("❌ Enter valid name and cost.");
  }
  
  if (renewalInterval < 1) {
    return alert("❌ Renewal interval must be at least 1.");
  }

  try {
    await addDoc(collection(db, "subscriptionShop"), { 
      name, 
      description,
      cost, 
      renewalInterval,
      renewalType,
      image,
      subscriberCount: 0,
      totalRevenue: 0,
      createdAt: new Date().toISOString()
    });

    await logAdminAction(auth.currentUser.uid, `Added subscription: ${name} ($${cost}/${renewalInterval}${renewalType})`);
    
    alert(`✅ Added subscription: ${name}!`);
    
    if (el.newSubscriptionName) el.newSubscriptionName.value = "";
    if (el.newSubscriptionDesc) el.newSubscriptionDesc.value = "";
    if (el.newSubscriptionCost) el.newSubscriptionCost.value = "";
    if (el.newSubscriptionInterval) el.newSubscriptionInterval.value = "7";
    if (el.newSubscriptionType) el.newSubscriptionType.value = "days";
    if (el.newSubscriptionImage) el.newSubscriptionImage.value = "";
  } catch (err) {
    console.error("❌ Error adding subscription:", err);
    alert("Failed to add subscription. Check console.");
  }
}
