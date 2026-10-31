import { auth, db } from "../firebaseConfig.js";
import { collection, doc, getDoc, getDocs, updateDoc, query, where, onSnapshot, runTransaction } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { logHistory } from "../historyManager.js";
import { sendSlackMessage } from "../slackNotifier.js";
import { getDOMElements, handleUserLookup } from "./adminUtils.js";
import { buildAdminDebtRecord } from "../debtManager.js";

let fineLookupListener = null;
let appealsListener = null;
const ENABLE_DEBT_SLACK_NOTIFICATIONS = true;

export function initFinesUI() {
  const el = getDOMElements();
  
  if (el.adminDebtType) {
    const picker = document.getElementById("admin-debt-type-picker");
    const trigger = document.getElementById("admin-debt-type-trigger");
    const menu = document.getElementById("admin-debt-type-menu");
    const selectedLabel = document.getElementById("admin-debt-type-selected");
    const options = menu?.querySelectorAll(".admin-debt-type-option");

    const updateDebtTypeFields = () => {
      const selectedAction = el.adminDebtType.value;
      const issuanceFields = document.getElementById("admin-debt-issuance-fields");
      const waiverFields = document.getElementById("admin-debt-waiver-fields");
      const appealsFields = document.getElementById("admin-judicial-appeals-fields");
      if (issuanceFields) issuanceFields.hidden = selectedAction === "waiver" || selectedAction === "appeals";
      if (waiverFields) waiverFields.hidden = selectedAction !== "waiver";
      if (appealsFields) appealsFields.hidden = selectedAction !== "appeals";
    };

    el.adminDebtType.addEventListener("change", updateDebtTypeFields);
    if (picker && trigger && menu && selectedLabel && options) {
      const closeMenu = () => {
        menu.hidden = true;
        trigger.setAttribute("aria-expanded", "false");
      };

      trigger.addEventListener("click", () => {
        const isOpen = !menu.hidden;
        menu.hidden = isOpen;
        trigger.setAttribute("aria-expanded", String(!isOpen));
      });

      options.forEach((option) => {
        option.addEventListener("click", () => {
          el.adminDebtType.value = option.dataset.value;
          selectedLabel.textContent = option.textContent;
          options.forEach((item) => item.setAttribute("aria-checked", String(item === option)));
          closeMenu();
          el.adminDebtType.dispatchEvent(new Event("change", { bubbles: true }));
          trigger.focus();
        });
      });

      document.addEventListener("click", (event) => {
        if (!picker.contains(event.target)) closeMenu();
      });

      picker.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !menu.hidden) {
          closeMenu();
          trigger.focus();
        }
      });
    }

    updateDebtTypeFields();
  }

  if (el.issueFineBtn) {
    el.issueFineBtn.addEventListener("click", issueJudicialFine);
  }
  
  if (el.adminFineUsername) {
    el.adminFineUsername.addEventListener("input", () => 
      handleUserLookup(el.adminFineUsername, el.adminFineInfo, el.issueFineBtn, "fine")
    );
  }
}

export function initAdminDebtWaivers() {
  const { adminDebtWaiverUsername, adminLoadDebtsBtn, adminDebtWaiverList } = getDOMElements();
  if (!adminDebtWaiverUsername || !adminLoadDebtsBtn || !adminDebtWaiverList) return;

  adminLoadDebtsBtn.addEventListener("click", async () => {
    const username = adminDebtWaiverUsername.value.trim().toLowerCase();
    if (!username) {
      alert("Enter a username to load admin debts.");
      return;
    }

    adminDebtWaiverList.textContent = "Loading admin debts...";
    try {
      const userQuery = query(collection(db, "users"), where("username", "==", username));
      const userSnapshot = await getDocs(userQuery);
      if (userSnapshot.empty) {
        adminDebtWaiverList.textContent = "User not found.";
        return;
      }

      const userDoc = userSnapshot.docs[0];
      renderAdminDebtWaivers(userDoc.id, userDoc.data(), adminDebtWaiverList);
    } catch (error) {
      console.error("Failed to load admin debts for waiver:", error);
      adminDebtWaiverList.textContent = "Could not load this user's admin debts. Try again.";
    }
  });
}

function renderAdminDebtWaivers(userId, userData, listEl) {
  listEl.replaceChildren();
  const userLabel = document.createElement("strong");
  userLabel.style.color = "#f39c12";
  userLabel.textContent = `Admin debts for ${userData.username || userId}`;
  listEl.appendChild(userLabel);

  const activeDebts = Object.entries(userData.adminDebts || {})
    .map(([id, debt]) => ({ ...debt, id, remaining: Number(debt.remaining ?? debt.amount ?? 0) }))
    .filter((debt) => debt.remaining > 0);

  if (!activeDebts.length) {
    const emptyMessage = document.createElement("p");
    emptyMessage.style.cssText = "color:gray; font-style:italic; margin:0;";
    emptyMessage.textContent = "This user has no active admin-issued debts to waive.";
    listEl.appendChild(emptyMessage);
    return;
  }

  activeDebts.forEach((debt) => {
    const row = document.createElement("div");
    row.style.cssText = "display:flex; justify-content:space-between; align-items:center; gap:12px; background:rgba(243,156,18,0.06); border:1px solid rgba(243,156,18,0.35); padding:12px; border-radius:8px;";

    const details = document.createElement("div");
    details.style.cssText = "min-width:0; font-size:0.85rem;";
    const title = document.createElement("strong");
    title.textContent = `$${debt.remaining.toLocaleString()} remaining`;
    const reason = document.createElement("div");
    reason.style.cssText = "color:#aaa; margin-top:4px; overflow-wrap:anywhere;";
    reason.textContent = debt.reason || "Admin-issued debt";
    details.append(title, reason);

    const waiveButton = document.createElement("button");
    waiveButton.type = "button";
    waiveButton.textContent = "Waive Debt";
    waiveButton.style.cssText = "flex-shrink:0; background:#f39c12; color:#111; border:0; padding:9px 12px; border-radius:6px; cursor:pointer; font-weight:800;";
    waiveButton.addEventListener("click", () => waiveAdminDebt(userId, debt.id, debt.remaining, debt.reason, listEl));

    row.append(details, waiveButton);
    listEl.appendChild(row);
  });
}

async function waiveAdminDebt(userId, debtId, amount, reason, listEl) {
  if (!confirm(`Waive the $${amount.toLocaleString()} admin debt "${reason || "Admin-issued debt"}"? This does not affect judicial fines.`)) return;

  const userRef = doc(db, "users", userId);
  try {
    const result = await runTransaction(db, async (transaction) => {
      const userSnapshot = await transaction.get(userRef);
      if (!userSnapshot.exists()) throw new Error("User no longer exists.");

      const debt = userSnapshot.data().adminDebts?.[debtId];
      const remaining = Number(debt?.remaining ?? debt?.amount ?? 0);
      if (!debt || !Number.isFinite(remaining) || remaining <= 0) {
        throw new Error("This admin debt is no longer active.");
      }

      const waivedAt = new Date().toISOString();
      transaction.update(userRef, {
        [`adminDebts.${debtId}.remaining`]: 0,
        [`adminDebts.${debtId}.status`]: "waived",
        [`adminDebts.${debtId}.waivedAt`]: waivedAt,
        [`adminDebts.${debtId}.waivedBy`]: auth.currentUser?.uid || "admin"
      });

      const updatedUserData = userSnapshot.data();
      updatedUserData.adminDebts = {
        ...(updatedUserData.adminDebts || {}),
        [debtId]: {
          ...debt,
          remaining: 0,
          status: "waived",
          waivedAt,
          waivedBy: auth.currentUser?.uid || "admin"
        }
      };
      return { amount: remaining, reason: debt.reason || "Admin-issued debt", userData: updatedUserData };
    });

    await logHistory(userId, `🏛️ ADMIN DEBT WAIVED: $${result.amount.toLocaleString()} for "${result.reason}"`, "admin");
    if (ENABLE_DEBT_SLACK_NOTIFICATIONS) {
      await sendSlackMessage(
        `🏛️ *ADMIN DEBT WAIVED*\n` +
        `👤 *User:* ${result.userData.username || userId}\n` +
        `🛡️ *Waived by admin:* ${auth.currentUser?.uid || "Unknown"}\n` +
        `💰 *Amount:* $${result.amount.toLocaleString()}\n` +
        `📝 *Reason:* ${result.reason}`
      );
    }
    renderAdminDebtWaivers(userId, result.userData, listEl);
    alert(`Admin debt waived ($${result.amount.toLocaleString()}). Judicial fines were not changed.`);
  } catch (error) {
    console.error("Failed to waive admin debt:", error);
    alert(`Could not waive this admin debt: ${error.message}`);
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
