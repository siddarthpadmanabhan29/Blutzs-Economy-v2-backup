import { db } from "../firebaseConfig.js";
import { collection, doc, getDoc, getDocs, updateDoc, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { logHistory } from "../historyManager.js";
import { sendSlackMessage } from "../slackNotifier.js";
import { getDOMElements, handleUserLookup } from "./adminUtils.js";
import { buildAdminDebtRecord } from "../debtManager.js";

let fineLookupListener = null;
let appealsListener = null;
const ENABLE_DEBT_SLACK_NOTIFICATIONS = true;

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
  const debtType = el.adminDebtType?.value || "fine";

  if (!username || isNaN(amount) || amount <= 0 || !reason || (debtType === "fine" && !dueDate)) {
    return alert("⚠️ Please fill in all required debt details (Username, Amount, Reason, and Due Date for fines).");
  }

  const confirmLabel = debtType === "admin" ? "admin debt" : "judicial fine";
  if (!confirm(`Issue a ${confirmLabel} of $${amount.toLocaleString()} to ${username}? It will stay visible in the debt ledger and can be paid in chunks.`)) return;

  try {
    const q = query(collection(db, "users"), where("username", "==", username));
    const snap = await getDocs(q);
    if (snap.empty) return alert("❌ User not found.");

    const userDoc = snap.docs[0];
    const userRef = doc(db, "users", userDoc.id);
    const userData = userDoc.data();
    const issuedAt = new Date().toISOString();
    const normalizedDueDate = debtType === "admin"
      ? new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)).toISOString()
      : new Date(dueDate).toISOString();

    if (debtType === "admin") {
      const adminDebt = buildAdminDebtRecord({
        amount,
        reason,
        issuedAt,
        dueDate: normalizedDueDate,
        createdBy: "admin"
      });

      await updateDoc(userRef, {
        [`adminDebts.${adminDebt.id}`]: adminDebt
      });

      await logHistory(userDoc.id, `🏛️ ADMIN DEBT ISSUED: $${amount.toLocaleString()} for "${reason}"`, "admin");
      if (ENABLE_DEBT_SLACK_NOTIFICATIONS) {
        sendSlackMessage(
          `🏛️ *ADMIN DEBT ISSUED*\n` +
          `👤 *User:* ${userData.username || username}\n` +
          `💰 *Amount:* $${amount.toLocaleString()}\n` +
          `📅 *Due Date:* ${new Date(normalizedDueDate).toLocaleDateString()}\n` +
          `📝 *Reason:* ${reason}`
        );
      }
    } else {
      const hasLayerAInsurance = userData.insurance?.activePackages?.includes("blutzs_a");
      const insuranceCoverageRate = hasLayerAInsurance ? 0.5 : 0;
      const insuranceCoveredAmount = hasLayerAInsurance ? Math.max(0, Math.min(Math.max(0, amount - 1), Math.ceil(amount * insuranceCoverageRate))) : 0;
      const remainingDue = Math.max(0, amount - insuranceCoveredAmount);

      await updateDoc(userRef, {
        activeFine: {
          amount: amount,
          remainingDue,
          insuranceCoveredAmount,
          insuranceCoverageRate,
          reason: reason,
          dueDate: normalizedDueDate,
          issuedAt,
          lastInterestDate: issuedAt,
          appealPending: false,
          appealStatus: "none",
          appealReason: null,
          appealSubmittedAt: null,
          type: "fine"
        }
      });

      await logHistory(userDoc.id, `🚨 JUDICIAL FINE ISSUED: $${amount.toLocaleString()} for "${reason}"`, "admin");
      if (ENABLE_DEBT_SLACK_NOTIFICATIONS) {
        sendSlackMessage(
          `⚖️ *JUDICIAL FINE ISSUED*\n` +
          `👤 *User:* ${userData.username || username}\n` +
          `💰 *Original Amount:* $${amount.toLocaleString()}\n` +
          `🛡️ *Insurance Covered:* $${insuranceCoveredAmount.toLocaleString()}\n` +
          `💵 *Due Now:* $${remainingDue.toLocaleString()}\n` +
          `📅 *Due Date:* ${new Date(normalizedDueDate).toLocaleDateString()}\n` +
          `📝 *Reason:* ${reason}`
        );
      }
    }

    alert(`✅ ${debtType === "admin" ? "Debt" : "Fine"} issued to ${username}.`);
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
  const userData = userSnap.data();
  const username = userData.username;
  const fine = userData.activeFine;

  if (decision === 'grant') {
    await updateDoc(userRef, {
      activeFine: null
    });
    if (ENABLE_DEBT_SLACK_NOTIFICATIONS) {
      sendSlackMessage(
        `✅ *JUDICIAL FINE APPEAL GRANTED*\n` +
        `👤 *User:* ${username}\n` +
        `💰 *Fine Amount:* $${Number(fine?.amount || 0).toLocaleString()}\n` +
        `📝 *Reason:* ${fine?.reason || "Judicial fine"}\n` +
        `📣 *Appeal Reason:* ${fine?.appealReason || "No reason provided"}\n` +
        `🏁 *Outcome:* Fine waived`
      );
    }
    alert("Fine waived.");
  } else {
    await updateDoc(userRef, {
      "activeFine.appealPending": false,
      "activeFine.appealStatus": "denied"
    });
    if (ENABLE_DEBT_SLACK_NOTIFICATIONS) {
      sendSlackMessage(
        `❌ *JUDICIAL FINE APPEAL DENIED*\n` +
        `👤 *User:* ${username}\n` +
        `💰 *Fine Amount:* $${Number(fine?.amount || 0).toLocaleString()}\n` +
        `📝 *Reason:* ${fine?.reason || "Judicial fine"}\n` +
        `📣 *Appeal Reason:* ${fine?.appealReason || "No reason provided"}\n` +
        `🏁 *Outcome:* Appeal denied, fine remains active`
      );
    }
    alert("Appeal denied.");
  }
};
