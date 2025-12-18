// ---------- transfer.js (FINAL VERSION with Subcollection History) ----------
console.log("transfer.js loaded");

import { db, auth } from "./firebaseConfig.js";
import { 
  collection, query, where, getDocs, doc, runTransaction 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { updateBalanceDisplay } from "./main.js";
import { logHistory } from "./historyManager.js"; // <--- New Import

// ---------- Elements ----------
const transferToInput = document.getElementById("transfer-to");
const transferAmountInput = document.getElementById("transfer-amount");
const transferBtn = document.getElementById("transfer-btn");
const transferMessage = document.getElementById("transfer-message");

// ---------- Handle Transfer ----------
async function handleTransfer() {
  const user = auth.currentUser;
  if (!user) return alert("You must be logged in.");

  // 1. Basic Input Validation
  const toUsername = transferToInput.value.trim();
  const amount = parseFloat(transferAmountInput.value);

  if (!toUsername || isNaN(amount) || amount <= 0) {
    return showMessage("Enter a valid username and amount.", "error");
  }

  // Disable button to prevent double-clicks
  transferBtn.disabled = true;
  transferBtn.textContent = "Sending...";

  try {
    // 2. Find the Recipient's User ID (UID) based on their username
    const usersRef = collection(db, "users");
    const q = query(usersRef, where("username", "==", toUsername));
    const recipientSnap = await getDocs(q);

    if (recipientSnap.empty) {
      throw new Error("Recipient user not found.");
    }

    const recipientDoc = recipientSnap.docs[0];
    const recipientUid = recipientDoc.id;
    const recipientUsername = recipientDoc.data().username; // Get correct casing
    
    // Prevent self-transfer
    if (recipientUid === user.uid) {
        throw new Error("You cannot transfer money to yourself.");
    }

    const senderRef = doc(db, "users", user.uid);
    const recipientRef = doc(db, "users", recipientUid);

    // 3. START ATOMIC TRANSACTION (Money Movement Only)
    await runTransaction(db, async (transaction) => {
      const senderDoc = await transaction.get(senderRef);
      const recipientDoc = await transaction.get(recipientRef);

      if (!senderDoc.exists() || !recipientDoc.exists()) {
        throw new Error("User data unavailable.");
      }

      const senderData = senderDoc.data();
      const recipientData = recipientDoc.data();

      // Check Expiration Logic (Optional)
      /* const now = new Date();
      const expirationDate = senderData.expirationDate ? new Date(senderData.expirationDate) : null;
      if (expirationDate && expirationDate < now) {
         throw new Error("Your ID is expired. Cannot transfer funds.");
      } 
      */

      const senderBalance = Number(senderData.balance || 0);
      const recipientBalance = Number(recipientData.balance || 0);

      // 4. CRITICAL: Check sufficient funds inside the transaction
      if (senderBalance < amount) {
        throw new Error("Insufficient funds.");
      }

      const newSenderBalance = senderBalance - amount;
      const newRecipientBalance = recipientBalance + amount;

      // 5. Update Sender Balance (No history here)
      transaction.update(senderRef, {
        balance: newSenderBalance
      });

      // 6. Update Recipient Balance (No history here)
      transaction.update(recipientRef, {
        balance: newRecipientBalance
      });

      // Update UI
      updateBalanceDisplay(newSenderBalance, "user-balance", "loss");
    });

    // 7. TRANSACTION SUCCESSFUL -> NOW LOG HISTORY
    // We log two separate entries in the new subcollections
    await Promise.all([
        logHistory(user.uid, `Sent $${amount.toLocaleString()} to ${recipientUsername}`, "transfer-out"),
        logHistory(recipientUid, `Received $${amount.toLocaleString()} from ${user.email.split('@')[0]}`, "transfer-in")
    ]);

    // Success Message
    showMessage(`Successfully sent $${amount.toLocaleString()} to ${recipientUsername}!`, "success");
    transferToInput.value = "";
    transferAmountInput.value = "";

  } catch (err) {
    console.error("Transfer failed:", err);
    showMessage(err.message, "error");
  } finally {
    // Re-enable button
    transferBtn.disabled = false;
    transferBtn.textContent = "Send";
  }
}

// ---------- Message Display ----------
function showMessage(msg, type) {
  if (!transferMessage) return;
  transferMessage.textContent = msg;
  transferMessage.style.color = type === "error" ? "red" : "green";
  
  // Clear message after 4 seconds
  setTimeout(() => (transferMessage.textContent = ""), 4000);
}

// ---------- Event Listener ----------
if (transferBtn) {
  transferBtn.addEventListener("click", handleTransfer);
}

export { handleTransfer };