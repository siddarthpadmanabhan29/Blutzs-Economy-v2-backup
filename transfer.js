// ---------- transfer.js ----------
console.log("transfer.js loaded");

import { db, auth } from "./firebaseConfig.js";
import { 
  collection, query, where, getDocs, doc, getDoc, updateDoc, arrayUnion 
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

  const toUsername = transferToInput.value.trim();
  const amount = parseFloat(transferAmountInput.value);

  if (!toUsername || isNaN(amount) || amount <= 0) {
    return showMessage("Enter a valid username and amount.", "error");
  }

  const senderRef = doc(db, "users", user.uid);
  const senderSnap = await getDoc(senderRef);
  if (!senderSnap.exists()) return showMessage("Your user data not found.", "error");

  const senderData = senderSnap.data();

  if (senderData.username === toUsername) {
    return showMessage("You can’t send money to yourself!", "error");
  }

  if (senderData.balance < amount) {
    return showMessage("Insufficient funds!", "error");
  }

  // Find recipient
  const usersRef = collection(db, "users");
  const q = query(usersRef, where("username", "==", toUsername));
  const recipientSnap = await getDocs(q);

  if (recipientSnap.empty) {
    return showMessage("Recipient does not exist.", "error"); // Updated error
  }

  const recipientDoc = recipientSnap.docs[0];
  const recipientRef = doc(db, "users", recipientDoc.id);
  const recipientData = recipientDoc.data();

  const newSenderBalance = senderData.balance - amount;
  const newRecipientBalance = (recipientData.balance || 0) + amount;

  try {
    // Update both users atomically and log history
    await Promise.all([
      updateDoc(senderRef, {
        balance: newSenderBalance,
        history: arrayUnion({
          message: `Sent $${amount.toLocaleString()} to ${toUsername}`,
          type: "transfer-out",
          timestamp: new Date().toISOString()
        })
      }),
      updateDoc(recipientRef, {
        balance: newRecipientBalance,
        history: arrayUnion({
          message: `Received $${amount.toLocaleString()} from ${senderData.username}`,
          type: "transfer-in",
          timestamp: new Date().toISOString()
        })
      })
    ]);

    // Update UI
    updateBalanceDisplay(newSenderBalance, "user-balance", "loss");
    showMessage(`Successfully sent $${amount.toLocaleString()} to ${toUsername}!`, "success");

    // Reset inputs
    transferToInput.value = "";
    transferAmountInput.value = "";

    console.log(`Transfer complete: ${senderData.username} → ${toUsername} ($${amount})`);
  } catch (err) {
    console.error("Transfer failed:", err);
    showMessage("Transfer failed. Try again later.", "error");
  }
}

// ---------- Message Display ----------
function showMessage(msg, type) {
  transferMessage.textContent = msg;
  transferMessage.style.color = type === "error" ? "red" : "green";
  setTimeout(() => (transferMessage.textContent = ""), 4000);
}

// ---------- Event Listener ----------
if (transferBtn) {
  transferBtn.addEventListener("click", handleTransfer);
}

// ---------- Export ----------
export { handleTransfer };
