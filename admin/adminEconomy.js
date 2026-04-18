import { db, auth } from "../firebaseConfig.js";
import { doc, updateDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { getLiveMarketRate } from "../economyUtils.js";
import { logHistory } from "../historyManager.js";
import { sendSlackMessage } from "../slackNotifier.js";
import { getDOMElements } from "./adminUtils.js";

let economyListener = null;
let pendingIncentives = [];

// Setup volatility input styling
export function initEconomyUI() {
  const el = getDOMElements();
  if (el.newVolatilityInput) {
    el.newVolatilityInput.style.cssText = `
      display: block;
      width: 100%;
      min-width: 180px;
      max-width: 220px;
      height: 38px;
      padding: 8px 12px;
      font-size: 0.7rem;
      margin-bottom: 12px;
      box-sizing: border-box;
      background-color: #111;
      color: #f1c40f;
      border: 1px solid #444;
      border-radius: 6px;
      font-weight: normal;
    `;
    el.updateVolatilityBtn?.addEventListener("click", updateGlobalEconomy);
  }
  
  // Incentive builder
  el.addIncentiveBtn?.addEventListener("click", addPendingIncentive);
}

// Listen to economy stats
export function listenToEconomyStats() {
  const el = getDOMElements();
  if (!el.adminCurrentVolatility || !auth.currentUser) return;
  if (economyListener) economyListener();

  const adminRef = doc(db, "users", auth.currentUser.uid);
  economyListener = onSnapshot(adminRef, async (snap) => {
    if (snap.exists()) {
      const vIndex = snap.data().volatilityIndex || 34000000;
      el.adminCurrentVolatility.textContent = `$${(vIndex / 1000000).toFixed(1)}M`;

      if (el.newVolatilityInput) {
        el.newVolatilityInput.placeholder = `Current: ${vIndex}`;
      }
    }
  });

  // Preview logic
  if (el.newVolatilityInput) {
    el.newVolatilityInput.addEventListener("input", async () => {
      const newIndex = parseInt(el.newVolatilityInput.value);
      if (newIndex >= 1000000) {
        try {
          const { globalSupply } = await getLiveMarketRate();
          const predictedPrice = Math.floor((globalSupply / newIndex) * 1350);
          el.adminCurrentVolatility.innerHTML = `
            Index: $${(newIndex / 1000000).toFixed(1)}M | 
            <span style="color: #2ecc71;">Pred. BPS: $${predictedPrice.toLocaleString()}</span>
          `;
        } catch (err) {
          console.error("Preview failed:", err);
        }
      }
    });
  }
}

async function updateGlobalEconomy() {
  const el = getDOMElements();
  const newValue = parseInt(el.newVolatilityInput.value);
  if (isNaN(newValue) || newValue < 1000000) {
    return alert("⚠️ Please enter a valid full number (e.g., 34000000 for $34M Resistance).");
  }

  if (!confirm(`Shift Market Resistance to $${(newValue / 1000000).toFixed(1)}M? (Higher value = more price resistance)`)) return;

  try {
    const adminRef = doc(db, "users", auth.currentUser.uid);
    await updateDoc(adminRef, { volatilityIndex: newValue });
    await logHistory(auth.currentUser.uid, `Market Resistance Shifted to $${(newValue / 1000000).toFixed(1)}M`, "admin");

    const timestamp = new Date().toLocaleString();
    sendSlackMessage(`🏛️ *Central Bank Update:* Market resistance shifted to *$${(newValue / 1000000).toFixed(1)}M*.\n*Time:* ${timestamp}`);

    alert("🚀 Resistance Synchronized.");
    el.newVolatilityInput.value = "";
  } catch (err) {
    console.error(err);
    alert("Failed to update resistance.");
  }
}

function addPendingIncentive() {
  const el = getDOMElements();
  const label = el.newIncentiveLabel.value.trim();
  const amount = parseFloat(el.newIncentiveAmount.value);

  if (!label || isNaN(amount) || amount <= 0) return alert("Enter valid label and amount.");

  const id = "inc_" + Date.now();
  pendingIncentives.push({ id, label, amount, status: 'available' });
  renderPendingIncentives();

  el.newIncentiveLabel.value = "";
  el.newIncentiveAmount.value = "";
}

function renderPendingIncentives() {
  const el = getDOMElements();
  if (!el.incentiveBuilderList) return;
  el.incentiveBuilderList.innerHTML = pendingIncentives.map((inc, index) => `
    <div style="display:flex; justify-content:space-between; background:rgba(255,255,255,0.05); padding:8px; border-radius:4px; font-size:0.75rem;">
      <span>${inc.label} ($${inc.amount.toLocaleString()})</span>
      <button onclick="window.removePendingIncentive(${index})" style="color:#e74c3c; background:none; border:none; cursor:pointer; font-weight:bold;">X</button>
    </div>
  `).join('');
}

window.removePendingIncentive = (index) => {
  pendingIncentives.splice(index, 1);
  renderPendingIncentives();
};

export { pendingIncentives };