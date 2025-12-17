// ---------- transfer.js (SECURE ATOMIC TRANSACTION) ----------
console.log("transfer.js loaded");

import { db, auth } from "./firebaseConfig.js";
import { 
  collection, query, where, getDocs, doc, runTransaction, arrayUnion 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { updateBalanceDisplay } from "./main.js";

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
    
    // Prevent self-transfer
    if (recipientUid === user.uid) {
        throw new Error("You cannot transfer money to yourself.");
    }

    const senderRef = doc(db, "users", user.uid);
    const recipientRef = doc(db, "users", recipientUid);

    // 3. START ATOMIC TRANSACTION
    // This block runs as a single unit. It locks both accounts briefly.
    await runTransaction(db, async (transaction) => {
      const senderDoc = await transaction.get(senderRef);
      const recipientDoc = await transaction.get(recipientRef);

      if (!senderDoc.exists() || !recipientDoc.exists()) {
        throw new Error("User data unavailable.");
      }

      const senderData = senderDoc.data();
      const recipientData = recipientDoc.data();

      // Check Expiration Logic (Optional: Block transfers if ID expired?)
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

      // 5. Update Sender
      transaction.update(senderRef, {
        balance: newSenderBalance,
        history: arrayUnion({
          message: `Sent $${amount.toLocaleString()} to ${toUsername}`,
          type: "transfer-out",
          timestamp: new Date().toISOString()
        })
      });

      // 6. Update Recipient
      transaction.update(recipientRef, {
        balance: newRecipientBalance,
        history: arrayUnion({
          message: `Received $${amount.toLocaleString()} from ${senderData.username}`,
          type: "transfer-in",
          timestamp: new Date().toISOString()
        })
      });

      // Update UI (Optimistic update, though listener in dashboard.js will also catch it)
      updateBalanceDisplay(newSenderBalance, "user-balance", "loss");
    });

    // Success!
    showMessage(`Successfully sent $${amount.toLocaleString()} to ${toUsername}!`, "success");
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