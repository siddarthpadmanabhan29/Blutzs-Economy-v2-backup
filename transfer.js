// ---------- transfer.js (UNIFIED HUB VERSION - OPTIMIZED) ----------
console.log("transfer.js loaded");

import { db, auth } from "./firebaseConfig.js";
import { 
    collection, query, where, getDocs, doc, getDoc, runTransaction, addDoc, serverTimestamp, increment 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { updateBalanceDisplay } from "./main.js";
import { logHistory } from "./historyManager.js";
import { sendSlackMessage } from "./slackNotifier.js";

// --- Import Hub Sub-Modules ---
import { initRequests } from "./requests.js";
import { initEscrow } from "./escrow.js";

// ---------- Slack Mention Mapping ----------
const SLACK_MENTIONS = {
    "5gvX9n4QYthJre5bvXgSLR3vyB32": "<@U0AAPTL191Q>", // BigArj99
    "FzN6WhykCNTQ0XVYQNeShpkHVos1": "<@U0ABJ6Y9NSU>", // TennisMaster 29
    "JjWCEwZ03nhDj8bb5XwU0ca80qI3": "<@U0AALFBHSCD>"  // Anu728
};

const getMention = (uid, defaultName) => SLACK_MENTIONS[uid] || defaultName;

// ---------- Elements ----------
const transferToInput = document.getElementById("transfer-to");
const transferAmountInput = document.getElementById("transfer-amount");
const transferBtn = document.getElementById("transfer-btn");
const requestBtn = document.getElementById("request-btn"); 
const protectionCheckbox = document.getElementById("use-protection"); 
const transferMessage = document.getElementById("transfer-message");

/* =========================================================
    HUB UI LOGIC: TAB SWITCHING
========================================================= */
const hubTabs = document.querySelectorAll(".hub-tab");
hubTabs.forEach(tab => {
    tab.addEventListener("click", () => {
        hubTabs.forEach(t => t.classList.remove("active"));
        tab.classList.add("active");

        document.getElementById("send-div").classList.add("hidden");
        document.getElementById("invoices-div").classList.add("hidden");
        document.getElementById("escrow-div").classList.add("hidden");

        const target = tab.dataset.target;
        document.getElementById(target).classList.remove("hidden");
    });
});

/* =========================================================
    UI LOGIC: REACTIVE TOGGLE
========================================================= */
protectionCheckbox?.addEventListener("change", (e) => {
    const details = document.getElementById("protection-details");
    const shield = document.getElementById("shield-icon");
    const container = document.querySelector(".protection-toggle-container");

    if (e.target.checked) {
        details?.classList.remove("hidden");
        if (shield) shield.style.filter = "grayscale(0%)";
        if (container) {
            container.style.borderColor = "rgba(241, 196, 15, 0.4)";
            container.style.background = "rgba(241, 196, 15, 0.05)";
        }
    } else {
        details?.classList.add("hidden");
        if (shield) shield.style.filter = "grayscale(100%)";
        if (container) {
            container.style.borderColor = "rgba(0,0,0,0.05)";
            container.style.background = "rgba(0,0,0,0.03)";
        }
    }
});

/* =========================================================
    CORE LOGIC: HANDLE TRANSFER
========================================================= */
async function handleTransfer() {
  const user = auth.currentUser;
  if (!user) return alert("You must be logged in.");

  const toUsername = transferToInput.value.trim();
  const amount = parseFloat(transferAmountInput.value);
  const isProtected = protectionCheckbox ? protectionCheckbox.checked : false;
  const BPS_FEE = 5;

  if (!toUsername || isNaN(amount) || amount <= 0) {
    return showMessage("Enter a valid username and amount.", "error");
  }

  transferBtn.disabled = true;
  transferBtn.textContent = "Processing...";

  try {
    const usersRef = collection(db, "users");
    const q = query(usersRef, where("username", "==", toUsername));
    const recipientSnap = await getDocs(q);

    if (recipientSnap.empty) throw new Error("Recipient user not found.");

    const recipientDoc = recipientSnap.docs[0];
    const recipientUid = recipientDoc.id;
    const recipientUsername = recipientDoc.data().username; 

    if (recipientUid === user.uid) throw new Error("You cannot send money to yourself.");

    // Explicitly fetch sender data to ensure we have the username for Slack/History
    const senderRef = doc(db, "users", user.uid);
    const senderSnap = await getDoc(senderRef);
    if (!senderSnap.exists()) throw new Error("Sender data missing.");
    const senderName = senderSnap.data().username;

    const recipientRef = doc(db, "users", recipientUid);

    await runTransaction(db, async (transaction) => {
      const freshSenderSnap = await transaction.get(senderRef);
      
      // Transaction Validation
      if (freshSenderSnap.data().balance < amount) throw new Error("Insufficient Cash.");
      if (isProtected && (freshSenderSnap.data().bpsBalance || 0) < BPS_FEE) {
        throw new Error(`Insufficient BPS. Protection costs ${BPS_FEE} BPS.`);
      }

      if (isProtected) {
        const pendingRef = doc(collection(db, "pending_transfers"));
        transaction.set(pendingRef, {
          from: user.uid,
          fromName: senderName, 
          to: recipientUid,
          toName: recipientUsername,    
          amount: amount,
          status: "pending",
          timestamp: serverTimestamp(),
          releaseDate: Date.now() + (2 * 60 * 60 * 1000) // EXACTLY 2 HOURS
        });

        transaction.update(senderRef, {
          balance: increment(-amount),
          bpsBalance: increment(-BPS_FEE)
        });
      } else {
        transaction.update(senderRef, { balance: increment(-amount) });
        transaction.update(recipientRef, { balance: increment(amount) });
      }
    });

    // --- SLACK NOTIFICATION FOR SENDING ---
    const senderMention = getMention(user.uid, senderName);
    const recipientMention = getMention(recipientUid, recipientUsername);
    
    let slackMsg = "";
    if (isProtected) {
        slackMsg = `🔒 *Escrow Initiated:* ${senderMention} sent *$${amount.toLocaleString()}* to ${recipientMention}. (Funds locked for 2h)`;
    } else {
        slackMsg = `💸 *Money Sent:* ${senderMention} sent *$${amount.toLocaleString()}* directly to ${recipientMention}.`;
    }
    sendSlackMessage(slackMsg);

    const protectionNote = isProtected ? " (Protected - 5 BPS Fee Applied)" : "";
    
    // Log history separately to ensure transfer succeeds even if logs fail
    logHistory(user.uid, `Sent $${amount.toLocaleString()} to ${recipientUsername}${protectionNote}`, "transfer-out");
    logHistory(recipientUid, `Received $${amount.toLocaleString()} from ${senderName}`, "transfer-in");

    showMessage(isProtected ? "Protected transfer sent to Escrow!" : "Transfer successful!", "success");
    clearInputs();

  } catch (err) {
    console.error(err);
    showMessage(err.message, "error");
  } finally {
    transferBtn.disabled = false;
    transferBtn.textContent = "Send";
  }
}

/* =========================================================
    CORE LOGIC: REQUEST MONEY
========================================================= */
async function handleRequest() {
  const user = auth.currentUser;
  if (!user) return;

  const targetUsernameInput = transferToInput.value.trim();
  const amount = parseFloat(transferAmountInput.value);

  if (!targetUsernameInput || isNaN(amount) || amount <= 0) {
    return showMessage("Enter recipient and amount to request.", "error");
  }

  requestBtn.disabled = true;

  try {
    const usersRef = collection(db, "users");
    const qTarget = query(usersRef, where("username", "==", targetUsernameInput));
    const targetSnap = await getDocs(qTarget);

    if (targetSnap.empty) throw new Error("User not found.");
    const targetDoc = targetSnap.docs[0];
    const targetUid = targetDoc.id;
    const targetName = targetDoc.data().username; 

    if (targetUid === user.uid) throw new Error("You cannot request money from yourself.");

    // Fetch sender name from doc to ensure Slack mention accuracy
    const senderSnap = await getDoc(doc(db, "users", user.uid));
    const realUsername = senderSnap.data().username;

    await addDoc(collection(db, "requests"), {
      requesterUid: user.uid,
      requesterName: realUsername, 
      targetUid: targetUid,
      targetName: targetName,       
      amount: amount,
      status: "unpaid",
      timestamp: serverTimestamp()
    });

    // --- SLACK NOTIFICATION FOR REQUEST ---
    const requesterMention = getMention(user.uid, realUsername);
    const targetMention = getMention(targetUid, targetName);
    sendSlackMessage(`📩 *Payment Request:* ${requesterMention} is requesting *$${amount.toLocaleString()}* from ${targetMention}.`);

    showMessage(`Request for $${amount.toLocaleString()} sent to ${targetName}`, "success");
    clearInputs();
  } catch (err) {
    console.error(err);
    showMessage(err.message, "error");
  } finally {
    requestBtn.disabled = false;
  }
}

/* =========================================================
    HELPERS & INITIALIZATION
========================================================= */
function showMessage(msg, type) {
  if (!transferMessage) return;
  transferMessage.textContent = msg;
  transferMessage.style.color = type === "error" ? "#e74c3c" : "#2ecc71";
  setTimeout(() => (transferMessage.textContent = ""), 4000);
}

function clearInputs() {
  transferToInput.value = "";
  transferAmountInput.value = "";
  if (protectionCheckbox) {
      protectionCheckbox.checked = false;
      // Trigger change event to reset the UI styles
      protectionCheckbox.dispatchEvent(new Event('change'));
  }
}

auth.onAuthStateChanged((user) => {
    if (user) {
        initRequests(user.uid);
        initEscrow(user.uid);
    }
});

transferBtn?.addEventListener("click", handleTransfer);
requestBtn?.addEventListener("click", handleRequest);

export { handleTransfer, handleRequest };