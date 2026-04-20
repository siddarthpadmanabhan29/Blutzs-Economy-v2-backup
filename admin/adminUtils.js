import { db, auth } from "../firebaseConfig.js";
import { collection, doc, getDocs, getDoc, query, where, onSnapshot, updateDoc, increment } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// Global listener cleanup state
export const listeners = {
  balance: null,
  bps: null,
  emp: null,
  cosmetics: null,
  contract: null,
  membership: null,
  fine: null,
  timeout: null
};

// Debounced lookup
export function debounceLookup(callback) {
  if (listeners.timeout) clearTimeout(listeners.timeout);
  listeners.timeout = setTimeout(callback, 300);
}

// Universal user lookup (used everywhere)
export async function handleUserLookup(inputEl, infoEl, btnEl, type) {
  const usernameInput = inputEl.value.trim().toLowerCase();

  // Cleanup previous listener
  if (listeners.timeout) clearTimeout(listeners.timeout);
  if (type === "money" && listeners.balance) { listeners.balance(); listeners.balance = null; }
  if (type === "bps" && listeners.bps) { listeners.bps(); listeners.bps = null; }
  if (type === "emp" && listeners.emp) { listeners.emp(); listeners.emp = null; }
  if (type === "cosmetic" && listeners.cosmetics) { listeners.cosmetics(); listeners.cosmetics = null; }
  if (type === "contract" && listeners.contract) { listeners.contract(); listeners.contract = null; }
  if (type === "membership" && listeners.membership) { listeners.membership(); listeners.membership = null; }
  if (type === "fine" && listeners.fine) { listeners.fine(); listeners.fine = null; }

  if (!usernameInput) {
    infoEl.textContent = "N/A";
    infoEl.style.color = "gray";
    if(btnEl) btnEl.disabled = true;
    return;
  }

  debounceLookup(async () => {
    try {
      const q = query(collection(db, "users"), where("username", "==", usernameInput));
      const snap = await getDocs(q);

      if (snap.empty) {
        infoEl.textContent = "Invalid user";
        infoEl.style.color = "red";
        if(btnEl) btnEl.disabled = true;
      } else {
        const userDoc = snap.docs[0];
        const userRef = doc(db, "users", userDoc.id);
        if(btnEl) btnEl.disabled = false;

        const unsubscribe = onSnapshot(userRef, (docSnap) => {
          if (!docSnap.exists()) return;
          const data = docSnap.data();
          const displayName = data.username || usernameInput;

          // Type-specific display logic
          if (type === "money") {
            infoEl.textContent = `${displayName} — $${(data.balance || 0).toLocaleString()}`;
            infoEl.style.color = "green";
          } else if (type === "bps") {
            infoEl.textContent = `${displayName} — ${(data.bpsBalance || 0)} BPS`;
            infoEl.style.color = "#8e44ad";
          } else if (type === "emp") {
            let statusText = `${displayName} → ${data.employmentStatus || "Unemployed"}`;
            if (data.tradePending) statusText += " (PENDING: trade)";
            if (data.releasePending) statusText += " (PENDING: release)";
            infoEl.textContent = statusText;
            infoEl.style.color = (data.tradePending || data.releasePending) ? "orange" : "green";
          } else if (type === "cosmetic") {
            infoEl.textContent = `${displayName}`;
            infoEl.style.color = "green";
            // Render cosmetics for this user when found
            (async () => {
              try {
                const { renderCosmeticsAdmin } = await import("./adminCosmetics.js");
                await renderCosmeticsAdmin(userDoc.id, data);
              } catch (err) {
                console.error("Cosmetics render error:", err);
              }
            })();
          } else if (type === "contract") {
            infoEl.textContent = `Drafting for: ${displayName}`;
            infoEl.style.color = "green";
          } else if (type === "membership") {
            const tier = data.membershipLevel || "standard";
            const isTrial = data.trialExpiration ? " (ACTIVE TRIAL)" : "";
            infoEl.textContent = `Target: ${displayName} | Plan: ${tier.toUpperCase()}${isTrial}`;
            infoEl.style.color = "#2ecc71";
          } else if (type === "fine") {
            const fineData = data.activeFine ? `$${data.activeFine.amount.toLocaleString()}` : "None";
            infoEl.textContent = `Target: ${displayName} | Fine: ${fineData}`;
            infoEl.style.color = data.activeFine ? "#e74c3c" : "#2ecc71";
          }
        });

        // Store listener for cleanup
        if (type === "money") listeners.balance = unsubscribe;
        else if (type === "bps") listeners.bps = unsubscribe;
        else if (type === "emp") listeners.emp = unsubscribe;
        else if (type === "cosmetic") listeners.cosmetics = unsubscribe;
        else if (type === "contract") listeners.contract = unsubscribe;
        else if (type === "membership") listeners.membership = unsubscribe;
        else if (type === "fine") listeners.fine = unsubscribe;
      }
    } catch (err) {
      console.error("User lookup failed:", err);
      infoEl.textContent = "Error loading";
      infoEl.style.color = "red";
    }
  });
}

// DOM Element queries helper
export function getDOMElements() {
  return {
    // Core panels
    adminPanel: document.getElementById("admin-panel"),
    backToDashboardBtn: document.getElementById("back-to-dashboard"),
    
    // Shop
    addItemBtn: document.getElementById("add-item-btn"),
    newItemName: document.getElementById("new-item-name"),
    newItemPrice: document.getElementById("new-item-price"),
    newItemStock: document.getElementById("new-item-stock"),
    newItemImage: document.getElementById("new-item-image"),
    adminShopInventory: document.getElementById("admin-shop-inventory"),
    
    // Money/BPS transfers
    adminGiveUsername: document.getElementById("admin-give-username"),
    adminGiveAmount: document.getElementById("admin-give-amount"),
    adminGiveBtn: document.getElementById("admin-give-btn"),
    adminUserInfo: document.getElementById("admin-user-info"),
    adminGiveBpsUsername: document.getElementById("admin-give-bps-username"),
    adminGiveBpsAmount: document.getElementById("admin-give-bps-amount"),
    adminGiveBpsBtn: document.getElementById("admin-give-bps-btn"),
    adminBpsUserInfo: document.getElementById("admin-bps-user-info"),
    
    // Renewals & Roster
    renewalRequestsContainer: document.getElementById("renewal-requests"),
    adminRosterContainer: document.getElementById("admin-active-contracts-list"),
    adminEscrowList: document.getElementById("admin-escrow-list"),
    
    // Membership
    adminTrialUsername: document.getElementById("admin-trial-username"),
    adminTrialUserInfo: document.getElementById("admin-trial-user-info"),
    adminTrialPlan: document.getElementById("admin-trial-plan"),
    adminTrialDuration: document.getElementById("admin-trial-duration"),
    adminTrialUnit: document.getElementById("admin-trial-unit"),
    adminGrantTrialBtn: document.getElementById("admin-grant-trial-btn"),
    adminRevokeTrialBtn: document.getElementById("admin-revoke-trial-btn"),
    
    // Economy
    adminCurrentVolatility: document.getElementById("admin-current-volatility"),
    newVolatilityInput: document.getElementById("new-volatility-input"),
    updateVolatilityBtn: document.getElementById("update-volatility-btn"),
    
    // Incentives
    incentiveBuilderList: document.getElementById("incentive-builder-list"),
    newIncentiveLabel: document.getElementById("new-incentive-label"),
    newIncentiveAmount: document.getElementById("new-incentive-amount"),
    addIncentiveBtn: document.getElementById("add-incentive-btn"),
    
    // Lottery
    adminLotteryPoolDisplay: document.getElementById("admin-lottery-pool"),
    adminLotteryBurnDisplay: document.getElementById("admin-lottery-burn"),
    adminLottoOverride: document.getElementById("admin-lotto-override"),
    triggerLottoBtn: document.getElementById("admin-trigger-lotto-btn"),
    adminLottoDate: document.getElementById("admin-lotto-date"),
    setLottoTimeBtn: document.getElementById("admin-set-lotto-time"),
    adminLiveTicketsList: document.getElementById("admin-live-tickets-list"),
    
    // Fines
    adminFineUsername: document.getElementById("admin-fine-username"),
    adminFineAmount: document.getElementById("admin-fine-amount"),
    adminFineReason: document.getElementById("admin-fine-reason"),
    adminFineDue: document.getElementById("admin-fine-due"),
    adminFineInfo: document.getElementById("admin-fine-info"),
    issueFineBtn: document.getElementById("admin-issue-fine-btn"),
    adminAppealsList: document.getElementById("admin-appeals-list"),
    
    // Cosmetics
    adminCosmeticsUsername: document.getElementById("admin-cosmetics-username"),
    adminCosmeticsUserInfo: document.getElementById("admin-cosmetics-user-info"),
    adminCosmeticsList: document.getElementById("admin-cosmetics-list"),
    
    // Employment
    empUsernameInput: document.getElementById("admin-employment-username"),
    empUserInfo: document.getElementById("admin-employment-user-info"),
    empSetBtn: document.getElementById("admin-set-employment-btn"),
    empStatusSelect: document.getElementById("admin-employment-status-select"),
    
    // Contracts
    adminContractUsername: document.getElementById("admin-contract-username"),
    adminContractUserInfo: document.getElementById("admin-contract-user-info"),
    adminContractBtn: document.getElementById("admin-offer-contract-btn"),
    contractTeam: document.getElementById("contract-team"),
    contractSeasons: document.getElementById("contract-seasons"),
    contractSigningBonus: document.getElementById("contract-signing-bonus"),
    contractGuaranteed: document.getElementById("contract-guaranteed"),
    contractNonGuaranteed: document.getElementById("contract-non-guaranteed"),
    contractIncentives: document.getElementById("contract-incentives"),
    contractBaseCycle: document.getElementById("contract-base-cycle")
  };
}

// Initialize all UI listeners
export function initAdminUI() {
  const el = getDOMElements();
  
  // Setup input listeners for user lookups
  el.adminGiveUsername?.addEventListener("input", () => handleUserLookup(el.adminGiveUsername, el.adminUserInfo, el.adminGiveBtn, "money"));
  el.adminGiveBpsUsername?.addEventListener("input", () => handleUserLookup(el.adminGiveBpsUsername, el.adminBpsUserInfo, el.adminGiveBpsBtn, "bps"));
  el.adminTrialUsername?.addEventListener("input", () => handleUserLookup(el.adminTrialUsername, el.adminTrialUserInfo, el.adminGrantTrialBtn, "membership"));
  el.adminFineUsername?.addEventListener("input", () => handleUserLookup(el.adminFineUsername, el.adminFineInfo, el.issueFineBtn, "fine"));
  el.adminCosmeticsUsername?.addEventListener("input", () => handleUserLookup(el.adminCosmeticsUsername, el.adminCosmeticsUserInfo, null, "cosmetic"));
  el.empUsernameInput?.addEventListener("input", () => handleUserLookup(el.empUsernameInput, el.empUserInfo, el.empSetBtn, "emp"));
  el.adminContractUsername?.addEventListener("input", () => handleUserLookup(el.adminContractUsername, el.adminContractUserInfo, el.adminContractBtn, "contract"));
  
  // Setup button click listeners
  el.adminGiveBtn?.addEventListener("click", () => executeGive(el.adminGiveUsername, el.adminGiveAmount, el.adminUserInfo, "balance", "money"));
  el.adminGiveBpsBtn?.addEventListener("click", () => executeGive(el.adminGiveBpsUsername, el.adminGiveBpsAmount, el.adminBpsUserInfo, "bpsBalance", "BPS tokens"));
}

// Execute generic give operation
export async function executeGive(inputEl, amountEl, infoEl, field, typeLabel) {
  try {
    const usernameInput = inputEl.value.trim().toLowerCase();
    const amount = parseFloat(amountEl.value);
    if (!usernameInput || isNaN(amount) || amount <= 0) return alert("Invalid inputs.");

    const q = query(collection(db, "users"), where("username", "==", usernameInput));
    const snap = await getDocs(q);
    if (snap.empty) return alert("User not found.");

    const userDoc = snap.docs[0];
    const { logHistory } = await import("../historyManager.js");
    
    await updateDoc(doc(db, "users", userDoc.id), { [field]: increment(amount) });
    await logHistory(userDoc.id, `Admin gave ${amount} ${typeLabel}`, "admin");

    alert(`✅ Success!`);
    inputEl.value = "";
    amountEl.value = "";
    infoEl.textContent = "N/A";
    infoEl.style.color = "gray";
  } catch (err) {
    console.error(err);
    alert("Operation failed");
  }
}

export async function logAdminAction(uid, message, type = "admin") {
    try {
        const { logHistory } = await import("../historyManager.js");
        await logHistory(uid, message, type);
    } catch (err) {
        console.error("Failed to log admin action:", err);
    }
}