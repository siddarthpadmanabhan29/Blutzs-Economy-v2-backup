import { db, auth } from "../firebaseConfig.js";
import { 
  collection, addDoc, onSnapshot, getDocs, updateDoc, doc, deleteDoc, query, where 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { getDOMElements, logAdminAction } from "./adminUtils.js";

let shopItems = [];
let subscriptionItems = [];
let stockCompanies = [];
let activeShopListener = null;
let activeSubListener = null;
let activeStockListener = null;

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

  listenForShopItems();
}

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

async function handleShopActions(e) {
  const action = e.target.dataset.action;
  const itemId = e.target.dataset.itemId;

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

async function updateItemStock(itemId) {
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
    alert(`✅ Updated "${itemName}" stock to ${newStock} units`);
  } catch (err) {
    console.error("❌ Failed to update stock:", err);
    alert("Failed to update stock. Check console.");
  }
}

async function adjustItemStock(itemId, adjustment) {
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
    alert(`✅ ${itemName}: ${action} units (now ${newStock})`);
  } catch (err) {
    console.error("❌ Failed to adjust stock:", err);
    alert("Failed to adjust stock. Check console.");
  }
}

async function deleteShopItem(itemId) {
  const itemName = shopItems.find(i => i.id === itemId)?.name || "Item";
  
  if (!confirm(`⚠️ Are you sure you want to DELETE "${itemName}" from the shop? This action cannot be undone.`)) {
    return;
  }

  const itemRef = doc(db, "shop", itemId);

  try {
    await deleteDoc(itemRef);
    await logAdminAction(auth.currentUser.uid, `Deleted shop item: ${itemName}`);
    alert(`✅ "${itemName}" has been removed from the shop.`);
  } catch (err) {
    console.error("❌ Failed to delete item:", err);
    alert("Failed to delete item. Check console.");
  }
}

function showEditItemModal(itemId) {
  const item = shopItems.find(i => i.id === itemId);
  if (!item) return;

  const modal = document.createElement("div");
  modal.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    background: rgba(0,0,0,0.8); z-index: 2000;
    display: flex; align-items: center; justify-content: center;
    backdrop-filter: blur(5px);
  `;

  modal.innerHTML = `
    <div style="background: rgba(0,0,0,0.9); border: 1px solid #444; border-radius: 15px; padding: 25px; width: 90%; max-width: 500px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <h3 style="margin: 0; color: #fff; font-size: 1.2rem;">Edit Item: ${item.name}</h3>
        <button id="close-edit-modal" style="background: transparent; border: none; color: #888; font-size: 1.5rem; cursor: pointer;">×</button>
      </div>
      <div style="display: flex; flex-direction: column; gap: 15px;">
        <div>
          <label style="display: block; color: #aaa; font-size: 0.7rem; font-weight: 800; text-transform: uppercase; margin-bottom: 5px;">Item Name</label>
          <input id="edit-item-name" type="text" value="${item.name}" style="width: 100%; height: 45px; background: #111; border: 1px solid #444; color: #fff; padding: 0 15px; border-radius: 8px; box-sizing: border-box; font-size: 0.9rem;">
        </div>
        <div>
          <label style="display: block; color: #aaa; font-size: 0.7rem; font-weight: 800; text-transform: uppercase; margin-bottom: 5px;">Price ($)</label>
          <input id="edit-item-cost" type="number" value="${item.cost || 0}" min="0" step="0.01" style="width: 100%; height: 45px; background: #111; border: 1px solid #444; color: #2ecc71; padding: 0 15px; border-radius: 8px; box-sizing: border-box; font-size: 0.9rem; font-weight: bold;">
        </div>
        <div>
          <label style="display: block; color: #aaa; font-size: 0.7rem; font-weight: 800; text-transform: uppercase; margin-bottom: 5px;">Stock Quantity</label>
          <input id="edit-item-stock" type="number" value="${item.stock || 0}" min="0" style="width: 100%; height: 45px; background: #111; border: 1px solid #444; color: #f39c12; padding: 0 15px; border-radius: 8px; box-sizing: border-box; font-size: 0.9rem; font-weight: bold;">
        </div>
        <div>
          <label style="display: block; color: #aaa; font-size: 0.7rem; font-weight: 800; text-transform: uppercase; margin-bottom: 5px;">Image URL (Optional)</label>
          <input id="edit-item-image" type="url" value="${item.image || ''}" placeholder="https://imgur.com/image.png" style="width: 100%; height: 45px; background: #111; border: 1px solid #444; color: #888; padding: 0 15px; border-radius: 8px; box-sizing: border-box; font-size: 0.8rem;">
        </div>
        <div style="display: flex; gap: 10px; margin-top: 10px;">
          <button id="save-edit-item" data-item-id="${itemId}" style="flex: 1; height: 50px; background: #3498db; color: #fff; border: none; border-radius: 8px; font-weight: 900; cursor: pointer; text-transform: uppercase; letter-spacing: 1px;">Save Changes</button>
          <button id="cancel-edit-item" style="flex: 1; height: 50px; background: #6c757d; color: #fff; border: none; border-radius: 8px; font-weight: 900; cursor: pointer; text-transform: uppercase; letter-spacing: 1px;">Cancel</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  document.getElementById("close-edit-modal").addEventListener("click", () => modal.remove());
  document.getElementById("cancel-edit-item").addEventListener("click", () => modal.remove());
  document.getElementById("save-edit-item").addEventListener("click", async (e) => {
    await saveEditedItem(e.target.dataset.itemId);
    modal.remove();
  });
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
}

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
    await updateDoc(itemRef, { name, cost, stock, image: image || null });
    
    const changes = [];
    if (originalItem.name !== name) changes.push(`name: "${originalItem.name}" → "${name}"`);
    if (originalItem.cost !== cost) changes.push(`price: $${originalItem.cost} → $${cost}`);
    if (originalItem.stock !== stock) changes.push(`stock: ${originalItem.stock} → ${stock}`);
    if (originalItem.image !== image) changes.push(`image updated`);

    const changeText = changes.length > 0 ? ` (${changes.join(", ")})` : "";
    await logAdminAction(auth.currentUser.uid, `Edited item "${name}"${changeText}`);
    alert(`✅ Item "${name}" updated successfully!`);
  } catch (err) {
    console.error("❌ Failed to update item:", err);
    alert("Failed to update item. Check console.");
  }
}

async function addShopItem() {
  const el = getDOMElements();
  const name = el.newItemName?.value?.trim();
  const cost = parseFloat(el.newItemPrice?.value);
  const stock = parseInt(el.newItemStock?.value) || 10;
  const image = el.newItemImage?.value?.trim();
  
  if (!name || isNaN(cost) || cost <= 0) return alert("❌ Enter valid item name and cost.");
  if (stock < 0) return alert("❌ Stock cannot be negative.");

  try {
    await addDoc(collection(db, "shop"), { 
      name, cost, stock,
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

// ==================== STOCK MARKET MANAGEMENT ====================

export function initStockMarketAdminUI() {
  const el = getDOMElements();

  if (el.addStockCompanyBtn) {
    el.addStockCompanyBtn.addEventListener("click", addStockCompany);
  }

  if (el.adminStockCompanyList) {
    el.adminStockCompanyList.addEventListener("click", handleStockCompanyActions);
  }

  listenForStockCompanies();
}

function listenForStockCompanies() {
  const stockRef = collection(db, "stockCompanies");
  if (activeStockListener) activeStockListener();

  activeStockListener = onSnapshot(stockRef, (snapshot) => {
    stockCompanies = [];
    snapshot.forEach((docSnap) => {
      stockCompanies.push({ id: docSnap.id, ...docSnap.data() });
    });
    renderAdminStockCompanies();
  }, (err) => {
    console.error("❌ Failed to listen to stock companies:", err);
  });
}

function renderAdminStockCompanies() {
  const el = getDOMElements();
  if (!el.adminStockCompanyList) return;

  el.adminStockCompanyList.innerHTML = "";

  if (stockCompanies.length === 0) {
    el.adminStockCompanyList.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: #888; padding: 20px;">📈 No listed companies yet.</div>`;
    return;
  }

  stockCompanies.forEach((company) => {
    const basePrice = Number(company.basePrice || 0);
    const shareCount = Number(company.availableShares || 0);
    const marketTrend = Number(company.marketTrend || 0);
    const volatility = Number(company.volatility || 0);
    const trendColor = marketTrend >= 0 ? '#2ecc71' : '#e74c3c';

    const itemBox = document.createElement("div");
    itemBox.style.cssText = "background: rgba(0,0,0,0.2); border: 1px solid #3498db; border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 10px;";
    itemBox.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: start; gap: 8px;">
        <div>
          <h4 style="margin: 0 0 4px 0; color: #fff;">${company.name}</h4>
          <p style="margin: 0; color: #aaa; font-size: 0.75rem;">Owner: <strong style="color: #2ecc71;">${company.ownerName || "Unknown"}</strong></p>
        </div>
        <div style="display: flex; gap: 6px;">
          <button data-action="edit-stock-company" data-company-id="${company.id}" 
            style="background: #f39c12; color: white; border: none; padding: 6px 9px; border-radius: 6px; cursor: pointer; font-size: 0.75rem; font-weight: bold;">
            EDIT
          </button>
          <button data-action="delete-stock-company" data-company-id="${company.id}" 
            style="background: #e74c3c; color: white; border: none; padding: 6px 9px; border-radius: 6px; cursor: pointer; font-size: 0.75rem; font-weight: bold;">
            DELETE
          </button>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; font-size: 0.75rem; color: #ccc;">
        <div style="background: rgba(255,255,255,0.03); padding: 8px; border-radius: 8px;">
          Base Price<br><strong style="color: #f1c40f;">$${basePrice.toLocaleString()}</strong>
        </div>
        <div style="background: rgba(255,255,255,0.03); padding: 8px; border-radius: 8px;">
          Shares Available<br><strong style="color: #3498db;">${shareCount}</strong>
        </div>
        <div style="background: rgba(255,255,255,0.03); padding: 8px; border-radius: 8px;">
          Market Trend<br><strong style="color: ${trendColor};">${marketTrend >= 0 ? '+' : ''}${marketTrend}%</strong>
        </div>
        <div style="background: rgba(255,255,255,0.03); padding: 8px; border-radius: 8px;">
          Volatility<br><strong style="color: #9b59b6;">${volatility}%</strong>
        </div>
        <div style="background: rgba(255,255,255,0.03); padding: 8px; border-radius: 8px; grid-column: 1/-1;">
          Dividend Yield<br><strong style="color: #8e44ad;">${Number(company.dividendRate || 0)}%</strong>
        </div>
      </div>

      <p style="margin: 0; color: #888; font-size: 0.75rem;">${company.description || "No description provided."}</p>
    `;
    el.adminStockCompanyList.appendChild(itemBox);
  });
}

async function handleStockCompanyActions(e) {
  const action = e.target.dataset.action;
  const companyId = e.target.dataset.companyId;

  if (action === "delete-stock-company") await deleteStockCompany(companyId);
  if (action === "edit-stock-company") showEditStockCompanyModal(companyId);
}

async function deleteStockCompany(companyId) {
  const company = stockCompanies.find((item) => item.id === companyId);
  if (!company) return;
  if (!confirm(`Delete company "${company.name}" from the market?`)) return;

  try {
    await deleteDoc(doc(db, "stockCompanies", companyId));
    await logAdminAction(auth.currentUser.uid, `Deleted stock company: ${company.name}`);
    alert(`✅ Removed ${company.name} from the stock market.`);
  } catch (err) {
    console.error("Failed to delete stock company:", err);
    alert("Failed to delete company.");
  }
}

/**
 * Edit modal for stock company — lets admins control
 * basePrice, marketTrend, volatility, dividendRate, availableShares
 */
function showEditStockCompanyModal(companyId) {
  const company = stockCompanies.find(c => c.id === companyId);
  if (!company) return;

  const modal = document.createElement("div");
  modal.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    background: rgba(0,0,0,0.85); z-index: 2000;
    display: flex; align-items: center; justify-content: center;
    backdrop-filter: blur(5px);
  `;

  modal.innerHTML = `
    <div style="
      background: rgba(0,0,0,0.95);
      border: 2px solid #3498db;
      border-radius: 15px;
      padding: 25px;
      width: 90%;
      max-width: 520px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.6);
      max-height: 90vh;
      overflow-y: auto;
    ">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <div>
          <h3 style="margin: 0; color: #3498db; font-size: 1.1rem;">Edit Company: ${company.name}</h3>
          <p style="margin: 4px 0 0 0; font-size: 0.65rem; color: #888; text-transform: uppercase; font-weight: 800;">Market Control Panel</p>
        </div>
        <button id="close-edit-company-modal" style="background: transparent; border: none; color: #888; font-size: 1.5rem; cursor: pointer; padding: 5px;">×</button>
      </div>

      <div style="display: flex; flex-direction: column; gap: 15px;">

        <div style="background: rgba(52,152,219,0.05); border: 1px solid rgba(52,152,219,0.2); border-radius: 10px; padding: 12px;">
          <p style="margin: 0; font-size: 0.65rem; color: #3498db; font-weight: 800; text-transform: uppercase; letter-spacing: 1px;">
            ℹ️ Price changes here set the anchor. Buy/sell pressure will then move it from this new base.
          </p>
        </div>

        <div>
          <label style="display: block; color: #aaa; font-size: 0.7rem; font-weight: 800; text-transform: uppercase; margin-bottom: 5px;">Company Name</label>
          <input id="edit-company-name" type="text" value="${company.name}" style="width: 100%; height: 42px; background: #111; border: 1px solid #444; color: #fff; padding: 0 15px; border-radius: 8px; box-sizing: border-box; font-size: 0.9rem;">
        </div>

        <div>
          <label style="display: block; color: #aaa; font-size: 0.7rem; font-weight: 800; text-transform: uppercase; margin-bottom: 5px;">Description</label>
          <textarea id="edit-company-description" rows="2" style="width: 100%; background: #111; border: 1px solid #444; color: #fff; padding: 10px 15px; border-radius: 8px; box-sizing: border-box; font-size: 0.85rem; font-family: inherit; resize: vertical;">${company.description || ''}</textarea>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div>
            <label style="display: block; color: #aaa; font-size: 0.7rem; font-weight: 800; text-transform: uppercase; margin-bottom: 5px;">Base Price ($)</label>
            <input id="edit-company-price" type="number" value="${company.basePrice || 0}" min="0" step="0.01"
              style="width: 100%; height: 42px; background: #111; border: 1px solid #f1c40f; color: #f1c40f; padding: 0 15px; border-radius: 8px; box-sizing: border-box; font-weight: bold;">
          </div>
          <div>
            <label style="display: block; color: #aaa; font-size: 0.7rem; font-weight: 800; text-transform: uppercase; margin-bottom: 5px;">Available Shares</label>
            <input id="edit-company-shares" type="number" value="${company.availableShares || 0}" min="0"
              style="width: 100%; height: 42px; background: #111; border: 1px solid #3498db; color: #3498db; padding: 0 15px; border-radius: 8px; box-sizing: border-box; font-weight: bold;">
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div>
            <label style="display: block; color: #aaa; font-size: 0.7rem; font-weight: 800; text-transform: uppercase; margin-bottom: 5px;">Market Trend (%)</label>
            <input id="edit-company-trend" type="number" value="${company.marketTrend || 0}" step="0.1"
              style="width: 100%; height: 42px; background: #111; border: 1px solid #2ecc71; color: #2ecc71; padding: 0 15px; border-radius: 8px; box-sizing: border-box; font-weight: bold;">
            <p style="margin: 4px 0 0 0; font-size: 0.6rem; color: #666;">Positive = bullish, negative = bearish</p>
          </div>
          <div>
            <label style="display: block; color: #aaa; font-size: 0.7rem; font-weight: 800; text-transform: uppercase; margin-bottom: 5px;">Volatility (%)</label>
            <input id="edit-company-volatility" type="number" value="${company.volatility || 0}" min="0" step="0.1"
              style="width: 100%; height: 42px; background: #111; border: 1px solid #9b59b6; color: #9b59b6; padding: 0 15px; border-radius: 8px; box-sizing: border-box; font-weight: bold;">
            <p style="margin: 4px 0 0 0; font-size: 0.6rem; color: #666;">Higher = wilder price swings</p>
          </div>
        </div>

        <div>
          <label style="display: block; color: #aaa; font-size: 0.7rem; font-weight: 800; text-transform: uppercase; margin-bottom: 5px;">Dividend Yield (%)</label>
          <input id="edit-company-dividend" type="number" value="${company.dividendRate || 0}" min="0" step="0.1"
            style="width: 100%; height: 42px; background: #111; border: 1px solid #8e44ad; color: #8e44ad; padding: 0 15px; border-radius: 8px; box-sizing: border-box; font-weight: bold;">
        </div>

        <div style="display: flex; gap: 10px; margin-top: 5px;">
          <button id="save-edit-company" data-company-id="${companyId}" style="
            flex: 2; height: 50px; background: #3498db; color: #fff;
            border: none; border-radius: 8px; font-weight: 900;
            cursor: pointer; text-transform: uppercase; letter-spacing: 1px;">
            Save Changes
          </button>
          <button id="cancel-edit-company" style="
            flex: 1; height: 50px; background: #6c757d; color: #fff;
            border: none; border-radius: 8px; font-weight: 900;
            cursor: pointer; text-transform: uppercase; letter-spacing: 1px;">
            Cancel
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  document.getElementById("close-edit-company-modal").addEventListener("click", () => modal.remove());
  document.getElementById("cancel-edit-company").addEventListener("click", () => modal.remove());
  document.getElementById("save-edit-company").addEventListener("click", async (e) => {
    await saveEditedStockCompany(e.target.dataset.companyId);
    modal.remove();
  });
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
}

async function saveEditedStockCompany(companyId) {
  const name = document.getElementById("edit-company-name").value.trim();
  const description = document.getElementById("edit-company-description").value.trim();
  const basePrice = parseFloat(document.getElementById("edit-company-price").value);
  const availableShares = parseInt(document.getElementById("edit-company-shares").value) || 0;
  const marketTrend = parseFloat(document.getElementById("edit-company-trend").value) || 0;
  const volatility = parseFloat(document.getElementById("edit-company-volatility").value) || 0;
  const dividendRate = parseFloat(document.getElementById("edit-company-dividend").value) || 0;

  if (!name) {
    alert("❌ Company name cannot be empty.");
    return;
  }
  if (isNaN(basePrice) || basePrice < 0) {
    alert("❌ Base price must be at least $0.");
    return;
  }
  if (availableShares < 0) {
    alert("❌ Available shares cannot be negative.");
    return;
  }

  const companyRef = doc(db, "stockCompanies", companyId);
  const original = stockCompanies.find(c => c.id === companyId);

  try {
    await updateDoc(companyRef, {
      name,
      description,
      basePrice,
      availableShares,
      marketTrend,
      volatility,
      dividendRate
    });

    // Log what changed
    const changes = [];
    if (original.name !== name) changes.push(`name: "${original.name}" → "${name}"`);
    if (original.basePrice !== basePrice) changes.push(`basePrice: $${original.basePrice} → $${basePrice}`);
    if (original.availableShares !== availableShares) changes.push(`shares: ${original.availableShares} → ${availableShares}`);
    if (original.marketTrend !== marketTrend) changes.push(`trend: ${original.marketTrend}% → ${marketTrend}%`);
    if (original.volatility !== volatility) changes.push(`volatility: ${original.volatility}% → ${volatility}%`);
    if (original.dividendRate !== dividendRate) changes.push(`dividend: ${original.dividendRate}% → ${dividendRate}%`);

    const changeText = changes.length > 0 ? ` (${changes.join(", ")})` : "";
    await logAdminAction(auth.currentUser.uid, `Edited stock company "${name}"${changeText}`);
    alert(`✅ "${name}" updated successfully!`);
  } catch (err) {
    console.error("❌ Failed to update stock company:", err);
    alert("Failed to update company. Check console.");
  }
}

async function addStockCompany() {
  const el = getDOMElements();
  const name = el.newCompanyName?.value?.trim();
  const description = el.newCompanyDescription?.value?.trim();
  const basePrice = parseFloat(el.newCompanyPrice?.value);
  const shares = parseInt(el.newCompanyShares?.value, 10) || 0;
  const ownerUsername = el.newCompanyOwner?.value?.trim().toLowerCase();
  const dividendRate = parseFloat(el.newCompanyDividend?.value) || 0;

  if (!name || isNaN(basePrice) || basePrice < 0) return alert("Enter a valid company name and opening price.");
  if (!ownerUsername) return alert("Enter the owner username so the company is tied to a user.");
  if (shares < 1) return alert("Provide at least 1 available share.");

  try {
    const userQuery = query(collection(db, "users"), where("username", "==", ownerUsername));
    const userSnap = await getDocs(userQuery);
    if (userSnap.empty) return alert("Owner username not found.");

    const ownerDoc = userSnap.docs[0];

    await addDoc(collection(db, "stockCompanies"), {
      name,
      description: description || `${name} is now listed on the stock market.`,
      basePrice,
      availableShares: shares,
      ownerId: ownerDoc.id,
      ownerName: ownerDoc.data().username || ownerUsername,
      marketTrend: 0,
      volatility: 2,
      dividendRate,
      createdAt: new Date().toISOString()
    });

    await logAdminAction(auth.currentUser.uid, `Added stock company: ${name} for ${ownerDoc.data().username || ownerUsername}`);
    alert(`✅ Added ${name} to the stock market.`);

    if (el.newCompanyName) el.newCompanyName.value = "";
    if (el.newCompanyDescription) el.newCompanyDescription.value = "";
    if (el.newCompanyPrice) el.newCompanyPrice.value = "";
    if (el.newCompanyShares) el.newCompanyShares.value = "100";
    if (el.newCompanyOwner) el.newCompanyOwner.value = "";
    if (el.newCompanyDividend) el.newCompanyDividend.value = "0";
  } catch (err) {
    console.error("❌ Failed to add stock company:", err);
    alert("Failed to add stock company.");
  }
}

// ==================== SUBSCRIPTION SHOP MANAGEMENT ====================

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

  listenForSubscriptionItems();
}

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

async function handleSubscriptionActions(e) {
  const action = e.target.dataset.action;
  const itemId = e.target.dataset.itemId;

  if (action === "delete-subscription") await deleteSubscriptionItem(itemId);
  else if (action === "edit-subscription") showEditSubscriptionModal(itemId);
}

async function deleteSubscriptionItem(itemId) {
  const itemName = subscriptionItems.find(i => i.id === itemId)?.name || "Item";
  
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

function showEditSubscriptionModal(itemId) {
  const item = subscriptionItems.find(i => i.id === itemId);
  if (!item) return;

  const modal = document.createElement("div");
  modal.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    background: rgba(0,0,0,0.8); z-index: 2000;
    display: flex; align-items: center; justify-content: center;
    backdrop-filter: blur(5px);
  `;

  modal.innerHTML = `
    <div style="
      background: rgba(0,0,0,0.9); border: 2px solid #2ecc71; border-radius: 15px;
      padding: 25px; width: 90%; max-width: 550px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5); max-height: 90vh; overflow-y: auto;
    ">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <h3 style="margin: 0; color: #2ecc71; font-size: 1.2rem;">Edit Subscription: ${item.name}</h3>
        <button id="close-edit-sub-modal" style="background: transparent; border: none; color: #888; font-size: 1.5rem; cursor: pointer; padding: 5px;">×</button>
      </div>
      <div style="display: flex; flex-direction: column; gap: 15px;">
        <div>
          <label style="display: block; color: #aaa; font-size: 0.7rem; font-weight: 800; text-transform: uppercase; margin-bottom: 5px;">Name</label>
          <input id="edit-sub-name" type="text" value="${item.name}" style="width: 100%; height: 45px; background: #111; border: 1px solid #2ecc71; color: #fff; padding: 0 15px; border-radius: 8px; box-sizing: border-box; font-size: 0.9rem;">
        </div>
        <div>
          <label style="display: block; color: #aaa; font-size: 0.7rem; font-weight: 800; text-transform: uppercase; margin-bottom: 5px;">Description</label>
          <textarea id="edit-sub-desc" style="width: 100%; height: 60px; background: #111; border: 1px solid #2ecc71; color: #fff; padding: 10px; border-radius: 8px; box-sizing: border-box; font-size: 0.9rem; font-family: inherit;">${item.description || ''}</textarea>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
          <div>
            <label style="display: block; color: #aaa; font-size: 0.7rem; font-weight: 800; text-transform: uppercase; margin-bottom: 5px;">Cost ($)</label>
            <input id="edit-sub-cost" type="number" value="${item.cost || 0}" min="0" step="0.01" style="width: 100%; height: 45px; background: #111; border: 1px solid #f1c40f; color: #f1c40f; padding: 0 15px; border-radius: 8px; box-sizing: border-box; font-size: 0.9rem; font-weight: bold;">
          </div>
          <div>
            <label style="display: block; color: #aaa; font-size: 0.7rem; font-weight: 800; text-transform: uppercase; margin-bottom: 5px;">Renewal Interval</label>
            <input id="edit-sub-interval" type="number" value="${item.renewalInterval || 7}" min="1" style="width: 100%; height: 45px; background: #111; border: 1px solid #3498db; color: #3498db; padding: 0 15px; border-radius: 8px; box-sizing: border-box; font-size: 0.9rem; font-weight: bold;">
          </div>
        </div>
        <div>
          <label style="display: block; color: #aaa; font-size: 0.7rem; font-weight: 800; text-transform: uppercase; margin-bottom: 5px;">Renewal Type</label>
          <select id="edit-sub-type" style="width: 100%; height: 45px; background: #111; border: 1px solid #3498db; color: #3498db; padding: 0 15px; border-radius: 8px; box-sizing: border-box; font-size: 0.9rem; font-weight: bold;">
            <option value="days" ${item.renewalType === 'days' ? 'selected' : ''}>Days</option>
            <option value="months" ${item.renewalType === 'months' ? 'selected' : ''}>Months</option>
          </select>
        </div>
        <div>
          <label style="display: block; color: #aaa; font-size: 0.7rem; font-weight: 800; text-transform: uppercase; margin-bottom: 5px;">Image URL (Optional)</label>
          <input id="edit-sub-image" type="url" value="${item.image || ''}" placeholder="https://imgur.com/image.png" style="width: 100%; height: 45px; background: #111; border: 1px solid #888; color: #888; padding: 0 15px; border-radius: 8px; box-sizing: border-box; font-size: 0.8rem;">
        </div>
        <div style="display: flex; gap: 10px; margin-top: 10px;">
          <button id="save-edit-subscription" data-item-id="${itemId}" style="flex: 1; height: 50px; background: #2ecc71; color: #fff; border: none; border-radius: 8px; font-weight: 900; cursor: pointer; text-transform: uppercase; letter-spacing: 1px;">Save Changes</button>
          <button id="cancel-edit-subscription" style="flex: 1; height: 50px; background: #6c757d; color: #fff; border: none; border-radius: 8px; font-weight: 900; cursor: pointer; text-transform: uppercase; letter-spacing: 1px;">Cancel</button>
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
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
}

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
    await updateDoc(itemRef, { name, description, cost, renewalInterval, renewalType, image: image || null });
    
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

async function addSubscriptionItem() {
  const el = getDOMElements();
  const name = el.newSubscriptionName?.value?.trim();
  const description = el.newSubscriptionDesc?.value?.trim();
  const cost = parseFloat(el.newSubscriptionCost?.value);
  const renewalInterval = parseInt(el.newSubscriptionInterval?.value) || 7;
  const renewalType = el.newSubscriptionType?.value || "days";
  const image = el.newSubscriptionImage?.value?.trim();
  
  if (!name || isNaN(cost) || cost <= 0) return alert("❌ Enter valid name and cost.");
  if (renewalInterval < 1) return alert("❌ Renewal interval must be at least 1.");

  try {
    await addDoc(collection(db, "subscriptionShop"), { 
      name, description, cost, renewalInterval, renewalType, image,
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