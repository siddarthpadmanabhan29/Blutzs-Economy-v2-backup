// ---------- escrow.js (Unified Hub Version) ----------
import { db, auth } from "./firebaseConfig.js";
import { 
    collection, query, where, onSnapshot, doc, runTransaction, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { logHistory } from "./historyManager.js";
import { updateBalanceDisplay } from "./main.js";

const escrowList = document.getElementById("escrow-list");
const escrowBadge = document.getElementById("escrow-count-badge"); // For the Hub Tab Badge

/**
 * Exported initialization function to be called from transfer.js
 */
export function initEscrow(uid) {
    if (!escrowList) return;
    listenForEscrow(uid);
}

function listenForEscrow(uid) {
    const q = query(
        collection(db, "pending_transfers"), 
        where("to", "==", uid), 
        where("status", "==", "pending")
    );

    onSnapshot(q, (snapshot) => {
        // Update UI Badge for the Hub
        if (escrowBadge) {
            const count = snapshot.size;
            escrowBadge.textContent = count;
            count > 0 ? escrowBadge.classList.remove("hidden") : escrowBadge.classList.add("hidden");
        }

        escrowList.innerHTML = "";
        if (snapshot.empty) {
            escrowList.innerHTML = `<p style="color:gray; font-size:0.85rem; text-align:center; padding: 20px;">No protected funds currently in escrow.</p>`;
            return;
        }

        snapshot.forEach(docSnap => {
            renderEscrowItem(docSnap.id, docSnap.data());
        });
    });
}

function renderEscrowItem(id, data) {
    const now = Date.now();
    const isReady = now >= data.releaseDate;
    const timeLeft = data.releaseDate - now;

    const item = document.createElement("div");
    item.className = "escrow-item";
    item.style = "padding: 12px; border: 1px solid #444; border-radius: 10px; margin-bottom: 10px; background: rgba(241, 196, 15, 0.03); border-left: 4px solid #f1c40f;";
    
    item.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="font-size: 0.9rem;">
                <div style="font-weight: bold; color: #f1c40f;">$${data.amount.toLocaleString()}</div>
                <div style="font-size: 0.8rem; color: #eee;">From: ${data.fromName}</div>
                <div style="font-size: 0.7rem; color: #aaa; margin-top: 4px;">
                    ${isReady ? "✅ Ready to claim" : `🔒 Unlocks in ${Math.ceil(timeLeft / (1000 * 60 * 60))} hours`}
                </div>
            </div>
            <button class="claim-btn btn-primary" data-id="${id}" 
                ${!isReady ? 'disabled style="opacity:0.4; cursor:not-allowed; background:#444;"' : 'style="background:#f1c40f; color:black; border:none; padding:8px 12px; border-radius:6px; font-weight:bold;"'}>
                Claim
            </button>
        </div>
    `;
    escrowList.appendChild(item);
}

async function claimFunds(escrowId) {
    const user = auth.currentUser;
    if (!user) return;

    const escrowRef = doc(db, "pending_transfers", escrowId);
    const userRef = doc(db, "users", user.uid);

    try {
        await runTransaction(db, async (transaction) => {
            const escrowSnap = await transaction.get(escrowRef);
            if (!escrowSnap.exists()) throw "Transfer no longer exists.";
            
            const data = escrowSnap.data();
            if (Date.now() < data.releaseDate) throw "Funds are still locked!";

            const userSnap = await transaction.get(userRef);
            const newBalance = (userSnap.data().balance || 0) + data.amount;

            transaction.update(userRef, { balance: newBalance });
            transaction.delete(escrowRef); 
        });

        // Optional: Update global balance display if main.js function is available
        if (typeof updateBalanceDisplay === "function") updateBalanceDisplay();

        alert("Funds successfully added to your balance!");
    } catch (err) {
        alert("Claim failed: " + err);
    }
}

// Event Delegation for Claim Buttons
document.addEventListener("click", (e) => {
    if (e.target.classList.contains("claim-btn")) {
        claimFunds(e.target.dataset.id);
    }
});