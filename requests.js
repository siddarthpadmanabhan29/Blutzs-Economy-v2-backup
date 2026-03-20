// ---------- requests.js (Unified Hub Version) ----------
console.log("requests.js loaded");

import { db, auth } from "./firebaseConfig.js";
import { 
    collection, query, where, onSnapshot, doc, getDoc, runTransaction, serverTimestamp, deleteDoc 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { logHistory } from "./historyManager.js";
import { updateBalanceDisplay } from "./main.js";
import { sendSlackMessage } from "./slackNotifier.js";

// --- UI Elements ---
const requestsList = document.getElementById("incoming-requests-list");
const requestCountBadge = document.getElementById("request-count-badge");

// ---------- Slack Mention Mapping ----------
const SLACK_MENTIONS = {
    "5gvX9n4QYthJre5bvXgSLR3vyB32": "<@U0AAPTL191Q>", // BigArj99
    "FzN6WhykCNTQ0XVYQNeShpkHVos1": "<@U0ABJ6Y9NSU>", // TennisMaster 29
    "JjWCEwZ03nhDj8bb5XwU0ca80qI3": "<@U0AALFBHSCD>"  // Anu728
};

const getMention = (uid, defaultName) => SLACK_MENTIONS[uid] || defaultName;

/**
 * Exported initialization function to be called from transfer.js
 */
export function initRequests(uid) {
    if (!requestsList) return;
    listenForRequests(uid);
}

/**
 * INITIALIZE: Listen for incoming requests
 */
function listenForRequests(uid) {
    const q = query(
        collection(db, "requests"), 
        where("targetUid", "==", uid), 
        where("status", "==", "unpaid")
    );

    onSnapshot(q, (snapshot) => {
        requestsList.innerHTML = "";
        const count = snapshot.size;

        // Update UI Badge for the Hub Hub Tab
        if (requestCountBadge) {
            requestCountBadge.textContent = count;
            count > 0 ? requestCountBadge.classList.remove("hidden") : requestCountBadge.classList.add("hidden");
        }

        if (snapshot.empty) {
            requestsList.innerHTML = `<p style="color:gray; font-style:italic; padding:20px; text-align:center; font-size:0.85rem;">No pending invoices.</p>`;
            return;
        }

        snapshot.forEach((docSnap) => {
            renderRequestItem(docSnap.id, docSnap.data());
        });
    });
}

/**
 * RENDER: Individual Request UI
 */
function renderRequestItem(requestId, data) {
    const item = document.createElement("div");
    item.className = "request-item";
    // Using a red border-left to signal an outgoing liability (invoice)
    item.style = "border: 1px solid #444; padding: 12px; border-radius: 10px; margin-bottom: 10px; background: rgba(231, 76, 60, 0.03); border-left: 4px solid #e74c3c;";
    
    item.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
            <div>
                <div style="font-weight: bold; color: #e74c3c;">$${data.amount.toLocaleString()}</div>
                <div style="font-size: 0.8rem; color: #eee;">Requested by: ${data.requesterName}</div>
            </div>
            <div class="request-actions" style="display: flex; gap: 5px;">
                <button class="pay-req-btn" 
                    data-id="${requestId}" 
                    data-amount="${data.amount}" 
                    data-from="${data.requesterUid}" 
                    data-name="${data.requesterName}" 
                    style="background:#2ecc71; color:white; border:none; padding:6px 12px; border-radius:6px; font-weight:bold; cursor:pointer;">
                    Pay
                </button>
                <button class="decline-req-btn" 
                    data-id="${requestId}" 
                    data-from="${data.requesterUid}" 
                    data-name="${data.requesterName}"
                    data-amount="${data.amount}"
                    style="background:#444; color:#bbb; border:none; padding:6px 10px; border-radius:6px; cursor:pointer;">
                    Decline
                </button>
            </div>
        </div>
    `;

    requestsList.appendChild(item);
}

/**
 * LOGIC: Process Payment
 */
async function payRequest(requestId, amount, requesterUid, requesterName) {
    const user = auth.currentUser;
    if (!user) return;

    if (!confirm(`Pay $${amount.toLocaleString()} to ${requesterName}?`)) return;

    const payerRef = doc(db, "users", user.uid);
    const requesterRef = doc(db, "users", requesterUid);
    const requestDocRef = doc(db, "requests", requestId);

    try {
        // Fetch current user's profile for Slack name accuracy
        const payerSnapFetch = await getDoc(payerRef);
        const payerName = payerSnapFetch.exists() ? payerSnapFetch.data().username : "Someone";

        await runTransaction(db, async (transaction) => {
            const payerSnap = await transaction.get(payerRef);
            const requesterSnap = await transaction.get(requesterRef);

            if (!payerSnap.exists()) throw "Payer data missing.";
            const payerData = payerSnap.data();

            if (payerData.balance < amount) throw "Insufficient funds to pay this request.";

            // Deduct from payer, Add to requester
            transaction.update(payerRef, { balance: payerData.balance - amount });
            transaction.update(requesterRef, { balance: (requesterSnap.data().balance || 0) + amount });

            // Delete the invoice document
            transaction.delete(requestDocRef);
        });

        // --- Slack Notification ---
        const payerMention = getMention(user.uid, payerName);
        const requesterMention = getMention(requesterUid, requesterName);
        sendSlackMessage(`✅ *Request Paid:* ${payerMention} paid the *$${amount.toLocaleString()}* requested by ${requesterMention}.`);

        // Log History
        await Promise.all([
            logHistory(user.uid, `Paid Invoice: $${amount.toLocaleString()} to ${requesterName}`, "transfer-out"),
            logHistory(requesterUid, `Invoice Paid: $${amount.toLocaleString()} from ${payerName}`, "transfer-in")
        ]);

        if (typeof updateBalanceDisplay === "function") updateBalanceDisplay();
        alert("Payment successful!");
    } catch (err) {
        console.error("Payment failed:", err);
        alert(err);
    }
}

/**
 * LOGIC: Decline Request
 */
async function declineRequest(requestId, requesterUid, requesterName, amount) {
    const user = auth.currentUser;
    if (!user) return;

    if (!confirm("Are you sure you want to decline this request?")) return;

    try {
        // Fetch current user's profile for Slack name accuracy
        const payerRef = doc(db, "users", user.uid);
        const payerSnapFetch = await getDoc(payerRef);
        const payerName = payerSnapFetch.exists() ? payerSnapFetch.data().username : "Someone";

        await deleteDoc(doc(db, "requests", requestId));

        // --- Slack Notification ---
        const payerMention = getMention(user.uid, payerName);
        const requesterMention = getMention(requesterUid, requesterName);
        sendSlackMessage(`❌ *Request Denied:* ${payerMention} declined the request for *$${amount.toLocaleString()}* from ${requesterMention}.`);

    } catch (err) {
        console.error("Failed to decline:", err);
    }
}

// --- Global Event Delegation ---
document.addEventListener("click", (e) => {
    if (e.target.classList.contains("pay-req-btn")) {
        const { id, amount, from, name } = e.target.dataset;
        payRequest(id, parseFloat(amount), from, name);
    }
    if (e.target.classList.contains("decline-req-btn")) {
        const { id, from, name, amount } = e.target.dataset;
        declineRequest(id, from, name, parseFloat(amount));
    }
});