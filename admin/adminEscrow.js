import { db } from "../firebaseConfig.js";
import { collection, doc, getDoc, onSnapshot, query, deleteDoc, runTransaction } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { getDOMElements } from "./adminUtils.js";

let adminEscrowListener = null;

export function listenToAllEscrow() {
  const el = getDOMElements();
  if (!el.adminEscrowList) return;
  if (adminEscrowListener) adminEscrowListener();

  const q = query(collection(db, "pending_transfers"));

  adminEscrowListener = onSnapshot(q, (snapshot) => {
    el.adminEscrowList.innerHTML = "";
    if (snapshot.empty) {
      el.adminEscrowList.innerHTML = "<p style='color: gray; font-style: italic;'>No active escrow transfers.</p>";
      return;
    }

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const div = document.createElement("div");
      div.style = "background: rgba(231, 76, 60, 0.05); border: 1px solid #e74c3c; padding: 12px; margin-bottom: 10px; border-radius: 8px;";
      
      div.innerHTML = `
        <div style="font-size: 0.85rem; margin-bottom: 8px;">
          <strong>From:</strong> ${data.fromName} → <strong>To:</strong> ${data.toName || "Unknown"}<br>
          <strong>Amount:</strong> <span style="color: #e74c3c; font-weight: bold;">$${data.amount.toLocaleString()}</span>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="admin-void-btn" data-id="${docSnap.id}" style="flex: 1; background: #e74c3c; color: white; border: none; padding: 8px; border-radius: 5px; cursor: pointer; font-size: 0.75rem; font-weight: bold;">VOID (REFUND)</button>
          <button class="admin-release-btn" data-id="${docSnap.id}" style="flex: 1; background: #2ecc71; color: white; border: none; padding: 8px; border-radius: 5px; cursor: pointer; font-size: 0.75rem; font-weight: bold;">FORCE RELEASE</button>
        </div>
      `;
      el.adminEscrowList.appendChild(div);
    });

    // Reattach event listeners
    attachEscrowListeners();
  });
}

function attachEscrowListeners() {
  document.addEventListener("click", (e) => {
    if (e.target.classList.contains("admin-void-btn")) {
      handleAdminEscrowAction(e.target.dataset.id, 'void');
    }
    if (e.target.classList.contains("admin-release-btn")) {
      handleAdminEscrowAction(e.target.dataset.id, 'release');
    }
  });
}

async function handleAdminEscrowAction(escrowId, action) {
  const escrowRef = doc(db, "pending_transfers", escrowId);
  
  try {
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(escrowRef);
      if (!snap.exists()) throw "Transfer not found.";
      const data = snap.data();
      
      const targetUid = (action === 'void') ? data.from : data.to;
      const userRef = doc(db, "users", targetUid);
      const userSnap = await transaction.get(userRef);
      
      transaction.update(userRef, { balance: (userSnap.data().balance || 0) + data.amount });
      transaction.delete(escrowRef);
    });
    alert(action === 'void' ? "Refund successful." : "Funds released early.");
  } catch (e) {
    console.error(e);
    alert("Action failed: " + e);
  }
}

export { listenToAllEscrow as default };
