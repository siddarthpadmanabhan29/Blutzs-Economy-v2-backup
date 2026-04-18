import { db } from "../firebaseConfig.js";
import { collection, doc, getDoc, getDocs, updateDoc, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { logHistory } from "../historyManager.js";
import { sendSlackMessage } from "../slackNotifier.js";
import { getDOMElements, handleUserLookup } from "./adminUtils.js";

let fineLookupListener = null;
let appealsListener = null;

export function initFinesUI() {
  const el = getDOMElements();
  
  if (el.issueFineBtn) {
    el.issueFineBtn.addEventListener("click", issueJudicialFine);
  }
  
  if (el.adminFineUsername) {
    el.adminFineUsername.addEventListener("input", () => 
      handleUserLookup(el.adminFineUsername, el.adminFineInfo, el.issueFineBtn, "fine")
    );
  }
}

async function issueJudicialFine() {
  const el = getDOMElements();
  const username = el.adminFineUsername.value.trim().toLowerCase();
  const amount = parseFloat(el.adminFineAmount.value);
  const reason = el.adminFineReason.value.trim();
  const dueDate = el.adminFineDue.value;

  if (!username || isNaN(amount) || amount <= 0 || !reason || !dueDate) {
    return alert("⚠️ Please fill in all fine details (Username, Amount, Reason, Due Date).");
  }

  if (!confirm(`Issue a judicial fine of $${amount.toLocaleString()} to ${username}? This will LOCK their account.`)) return;

  try {
    const q = query(collection(db, "users"), where("username", "==", username));
    const snap = await getDocs(q);
    if (snap.empty) return alert("❌ User not found.");

    const userDoc = snap.docs[0];
    const userRef = doc(db, "users", userDoc.id);

    await updateDoc(userRef, {
      activeFine: {
        amount: amount,
        reason: reason,
        dueDate: new Date(dueDate).toISOString(),
        lastInterestDate: new Date().toISOString(),
        appealPending: false
      }
    });

    await logHistory(userDoc.id, `🚨 JUDICIAL FINE ISSUED: $${amount.toLocaleString()} for "${reason}"`, "admin");

    const timestamp = new Date().toLocaleString();
    sendSlackMessage(
      `⚖️ *CBA FINE:* CBA has fined *${username}*.\n` + 
      `💰 *Amount:* $${amount.toLocaleString()}\n` +
      `📝 *Reason:* ${reason}\n` +
      `📅 *Due Date:* ${new Date(dueDate).toLocaleDateString()}\n` +
      `⚠️ *Status:* Account LOCKED until payment.`
    );

    alert(`✅ Fine issued to ${username}. Account locked.`);
    el.adminFineUsername.value = "";
    el.adminFineAmount.value = "";
    el.adminFineReason.value = "";
    el.adminFineDue.value = "";
    el.adminFineInfo.textContent = "N/A";
  } catch (err) {
    console.error("Fine issue failed:", err);
    alert("Failed to issue fine.");
  }
}

export function listenForAppeals() {
  const el = getDOMElements();
  if (!el.adminAppealsList) return;
  if (appealsListener) appealsListener();

  // Query all users who have an activeFine with appealPending: true
  const q = query(collection(db, "users"), where("activeFine.appealPending", "==", true));

  appealsListener = onSnapshot(q, (snapshot) => {
    el.adminAppealsList.innerHTML = "";
    if (snapshot.empty) {
      el.adminAppealsList.innerHTML = `<p style="color: gray; font-style: italic; text-align: center;">No active appeals.</p>`;
      return;
    }

    snapshot.forEach((userDoc) => {
      const userData = userDoc.data();
      const fine = userData.activeFine;
      const div = document.createElement("div");
      div.style = "background: rgba(52, 152, 219, 0.05); border: 1px solid #3498db; padding: 12px; margin-bottom: 10px; border-radius: 8px;";
      div.innerHTML = `
        <div style="font-size: 0.85rem; margin-bottom: 8px;">
          <strong>User:</strong> ${userData.username}<br>
          <strong>Fine:</strong> $${fine.amount.toLocaleString()} (${fine.reason})<br>
          <strong>Appeal Reason:</strong> <span style="color: #3498db;">"${fine.appealReason || 'No reason provided'}"</span>
        </div>
        <div style="display: flex; gap: 8px;">
          <button onclick="window.handleAppeal('${userDoc.id}', 'grant')" style="flex: 1; background: #2ecc71; color: white; border: none; padding: 8px; border-radius: 5px; cursor: pointer; font-weight: bold;">GRANT (WAIVE FINE)</button>
          <button onclick="window.handleAppeal('${userDoc.id}', 'deny')" style="flex: 1; background: #e74c3c; color: white; border: none; padding: 8px; border-radius: 5px; cursor: pointer; font-weight: bold;">DENY APPEAL</button>
        </div>
      `;
      el.adminAppealsList.appendChild(div);
    });
  });
}

window.handleAppeal = async (userId, decision) => {
  const userRef = doc(db, "users", userId);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) return;
  const username = userSnap.data().username;

  if (decision === 'grant') {
    await updateDoc(userRef, { activeFine: null });
    sendSlackMessage(`👨‍⚖️ *APPEAL GRANTED:* Admin has waived the fine for *${username}*. Account unlocked.`);
    alert("Fine waived.");
  } else {
    await updateDoc(userRef, { "activeFine.appealPending": false });
    sendSlackMessage(`👨‍⚖️ *APPEAL DENIED:* Admin has rejected the appeal from *${username}*. The fine remains.`);
    alert("Appeal denied.");
  }
};
