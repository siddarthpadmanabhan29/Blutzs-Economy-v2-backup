// ---------- admin.js (UPGRADED: Escrow Oversight & Central Bank) ----------
console.log("admin.js loaded");

import { db, auth, secondaryAuth } from "./firebaseConfig.js";
import { 
  collection, doc, getDoc, getDocs, addDoc, updateDoc, query, where, onSnapshot, deleteDoc, runTransaction, increment 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { showScreen, createOrUpdateUserDoc } from "./auth.js"; 
import { logHistory } from "./historyManager.js";
import { PLANS } from "./membership_plans.js";
import { sendSlackMessage } from "./slackNotifier.js";
// NEW: Import the central source of truth for economy math
import { getLiveMarketRate } from "./economyUtils.js";

// ---------- Elements ----------
const adminPanel = document.getElementById("admin-panel");
const backToDashboardBtn = document.getElementById("back-to-dashboard");

const addItemBtn = document.getElementById("add-item-btn");
const newItemName = document.getElementById("new-item-name");
const newItemPrice = document.getElementById("new-item-price");
const newItemImage = document.getElementById("new-item-image"); 

const adminGiveUsername = document.getElementById("admin-give-username");
const adminGiveAmount = document.getElementById("admin-give-amount");
const adminGiveBtn = document.getElementById("admin-give-btn");
const adminUserInfo = document.getElementById("admin-user-info");

const adminGiveBpsUsername = document.getElementById("admin-give-bps-username");
const adminGiveBpsAmount = document.getElementById("admin-give-bps-amount");
const adminGiveBpsBtn = document.getElementById("admin-give-bps-btn");
const adminBpsUserInfo = document.getElementById("admin-bps-user-info");

const renewalRequestsContainer = document.getElementById("renewal-requests");
const adminRosterContainer = document.getElementById("admin-active-contracts-list");
const adminEscrowList = document.getElementById("admin-escrow-list"); 

// --- MEMBERSHIP ADMIN ELEMENTS ---
const adminTrialUsername = document.getElementById("admin-trial-username");
const adminTrialUserInfo = document.getElementById("admin-trial-user-info");
const adminTrialPlan = document.getElementById("admin-trial-plan");
const adminTrialDuration = document.getElementById("admin-trial-duration");
const adminTrialUnit = document.getElementById("admin-trial-unit");
const adminGrantTrialBtn = document.getElementById("admin-grant-trial-btn");
const adminRevokeTrialBtn = document.getElementById("admin-revoke-trial-btn"); 

// --- CENTRAL BANK ELEMENTS ---
const adminCurrentVolatility = document.getElementById("admin-current-volatility");
const newVolatilityInput = document.getElementById("new-volatility-input");
const updateVolatilityBtn = document.getElementById("update-volatility-btn");

// UI FIX: Ensure the input box is wide and tall enough to see the full numeric values clearly
if (newVolatilityInput) {
    newVolatilityInput.style.display = "block"; 
    newVolatilityInput.style.width = "100%";    
    newVolatilityInput.style.minWidth = "180px";   // Reduced width
    newVolatilityInput.style.maxWidth = "220px";   // Fixed typo and set a smaller max
    newVolatilityInput.style.height = "38px";      // Shorter height (standard input size)
    newVolatilityInput.style.padding = "8px 12px"; // Less internal "puffiness"
    newVolatilityInput.style.fontSize = "0.7rem";    // Standard text size
    newVolatilityInput.style.marginBottom = "12px"; 
    newVolatilityInput.style.boxSizing = "border-box"; 
    newVolatilityInput.style.backgroundColor = "#111"; 
    newVolatilityInput.style.color = "#f1c40f"; 
    newVolatilityInput.style.border = "1px solid #444"; // Thinner border for a cleaner look
    newVolatilityInput.style.borderRadius = "6px";  // Slightly smaller corners
    newVolatilityInput.style.fontWeight = "normal"; // Less bulky text
}

// --- QUOTA PROTECTION STATE ---
let balanceListener = null; 
let bpsListener = null;
let empListener = null;
let cosmeticsUserListener = null;
let contractLookupListener = null;
let membershipLookupListener = null; 
let adminEscrowListener = null; 
let adminCosmeticsCache = null; 
let activeAdminListener = null;
let economyListener = null;

let lookupTimeout = null;

// ---------- Admin Access Check ----------
export async function checkAdminAccess() {
  const user = auth.currentUser;
  if (!user) return false;
  const userRef = doc(db, "users", user.uid);
  const userSnap = await getDoc(userRef);
  return userSnap.exists() && userSnap.data().isAdmin === true;
}

/* =========================================================
    CENTRAL BANK CONTROLS: RESISTANCE ENGINE (SYNCED)
========================================================= */
export function listenToEconomyStats() {
    if (!adminCurrentVolatility || !auth.currentUser) return;
    if (economyListener) economyListener();

    // Listen to the Admin's own doc for the master Resistance Index
    const adminRef = doc(db, "users", auth.currentUser.uid);
    economyListener = onSnapshot(adminRef, (snap) => {
        if (snap.exists()) {
            const vIndex = snap.data().volatilityIndex || 34000000;
            adminCurrentVolatility.textContent = `$${(vIndex / 1000000).toFixed(1)}M`;
            
            // DATA ENGINEERING SYNC: Update the input placeholder to show current state
            if (newVolatilityInput) {
                newVolatilityInput.placeholder = `Current: ${vIndex}`;
            }
        }
    });

    // NEW: MARKET SUGGESTION PREVIEW Logic
    if (newVolatilityInput) {
        newVolatilityInput.addEventListener("input", async () => {
            const newIndex = parseInt(newVolatilityInput.value);
            // Validation range based on simulation boundaries ($14M to $54M)
            if (newIndex >= 1000000) {
                try {
                    const { globalSupply } = await getLiveMarketRate();
                    // Use the 1350 constant from economyUtils logic
                    const predictedPrice = Math.floor((globalSupply / newIndex) * 1350);
                    
                    // Display the predicted BPS price in the admin info area
                    adminCurrentVolatility.innerHTML = `
                        Index: $${(newIndex / 1000000).toFixed(1)}M | 
                        <span style="color: #2ecc71;">Pred. BPS: $${predictedPrice.toLocaleString()}</span>
                    `;
                } catch (err) { console.error("Preview failed:", err); }
            }
        });
    }
}

async function updateGlobalEconomy() {
    const newValue = parseInt(newVolatilityInput.value);
    if (isNaN(newValue) || newValue < 1000000) {
        return alert("⚠️ Please enter a valid full number (e.g., 34000000 for $34M Resistance).");
    }

    // Logic description: In Resistance Model, High Index = Lower BPS Price
    if (!confirm(`Shift Market Resistance to $${(newValue/1000000).toFixed(1)}M? (Higher value = more price resistance)`)) return;

    try {
        const adminRef = doc(db, "users", auth.currentUser.uid);
        await updateDoc(adminRef, { volatilityIndex: newValue });
        
        await logHistory(auth.currentUser.uid, `Market Resistance Shifted to $${(newValue/1000000).toFixed(1)}M`, "admin");
        
        const timestamp = new Date().toLocaleString();
        sendSlackMessage(`🏛️ *Central Bank Update:* Market resistance shifted to *$${(newValue/1000000).toFixed(1)}M*.\n*Time:* ${timestamp}`);

        alert("🚀 Resistance Synchronized.");
        newVolatilityInput.value = "";
    } catch (err) {
        console.error(err);
        alert("Failed to update resistance.");
    }
}

if (updateVolatilityBtn) updateVolatilityBtn.addEventListener("click", updateGlobalEconomy);

// ---------- Add Shop Item ----------
async function addShopItem() {
  const name = newItemName.value.trim();
  const cost = parseFloat(newItemPrice.value);
  const image = newItemImage.value.trim(); 
  if (!name || isNaN(cost) || cost <= 0) return alert("Enter valid item name and cost.");
  await addDoc(collection(db, "shop"), { name, cost, image });
  alert(`Added item: ${name} ($${cost})`);
  newItemName.value = ""; newItemPrice.value = ""; newItemImage.value = "";
}

// ---------- Optimized User Lookup Helper ----------
function debounceLookup(callback) {
    if (lookupTimeout) clearTimeout(lookupTimeout);
    lookupTimeout = setTimeout(callback, 300); 
}

async function handleUserLookup(inputEl, infoEl, btnEl, type) {
  const usernameInput = inputEl.value.trim().toLowerCase();

  if (lookupTimeout) clearTimeout(lookupTimeout);
  if (type === "money" && balanceListener) { balanceListener(); balanceListener = null; }
  if (type === "bps" && bpsListener) { bpsListener(); bpsListener = null; }
  if (type === "emp" && empListener) { empListener(); empListener = null; }
  if (type === "cosmetic" && cosmeticsUserListener) { cosmeticsUserListener(); cosmeticsUserListener = null; }
  if (type === "contract" && contractLookupListener) { contractLookupListener(); contractLookupListener = null; }
  if (type === "membership" && membershipLookupListener) { membershipLookupListener(); membershipLookupListener = null; }

  if (!usernameInput) {
    infoEl.textContent = "N/A";
    infoEl.style.color = "gray";
    if(btnEl) btnEl.disabled = true;
    return;
  }

  debounceLookup(async () => {
    const usersRef = collection(db, "users");
    const q = query(usersRef, where("username", "==", usernameInput)); 
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
          renderCosmeticsAdmin(userDoc.id, data);
        } else if (type === "contract") {
            infoEl.textContent = `Drafting for: ${displayName}`;
            infoEl.style.color = "green";
        } else if (type === "membership") {
            const tier = data.membershipLevel || "standard";
            const isTrial = data.trialExpiration ? " (ACTIVE TRIAL)" : "";
            infoEl.textContent = `Target: ${displayName} | Plan: ${tier.toUpperCase()}${isTrial}`;
            infoEl.style.color = "#2ecc71";
        }
      });

      if (type === "money") balanceListener = unsubscribe;
      else if (type === "bps") bpsListener = unsubscribe;
      else if (type === "emp") empListener = unsubscribe;
      else if (type === "cosmetic") cosmeticsUserListener = unsubscribe;
      else if (type === "contract") contractLookupListener = unsubscribe;
      else if (type === "membership") membershipLookupListener = unsubscribe;
    }
  });
}

adminGiveUsername?.addEventListener("input", () => handleUserLookup(adminGiveUsername, adminUserInfo, adminGiveBtn, "money"));
adminGiveBpsUsername?.addEventListener("input", () => handleUserLookup(adminGiveBpsUsername, adminBpsUserInfo, adminGiveBpsBtn, "bps"));
adminTrialUsername?.addEventListener("input", () => handleUserLookup(adminTrialUsername, adminTrialUserInfo, adminGrantTrialBtn, "membership"));

// ---------- Execute Give Functions ----------
async function executeGive(inputEl, amountEl, infoEl, field, typeLabel) {
  try {
    const usernameInput = inputEl.value.trim().toLowerCase(); 
    const amount = parseFloat(amountEl.value);
    if (!usernameInput || isNaN(amount) || amount <= 0) return alert("Invalid inputs.");

    const q = query(collection(db, "users"), where("username", "==", usernameInput));
    const snap = await getDocs(q);
    if (snap.empty) return alert("User not found.");

    const userDoc = snap.docs[0];
    const userRef = doc(db, "users", userDoc.id);
    const userData = userDoc.data();

    await updateDoc(userRef, { [field]: (userData[field] || 0) + amount });
    await logHistory(userDoc.id, `Admin gave ${amount} ${typeLabel}`, "admin");

    alert(`✅ Success!`);
    inputEl.value = ""; amountEl.value = ""; infoEl.textContent = "N/A";
    infoEl.style.color = "gray";
  } catch (err) { console.error(err); }
}

async function giveMoney() { await executeGive(adminGiveUsername, adminGiveAmount, adminUserInfo, "balance", "money"); }
async function giveBps() { await executeGive(adminGiveBpsUsername, adminGiveBpsAmount, adminBpsUserInfo, "bpsBalance", "BPS"); }

// ---------- Membership & Trial Execution ----------
async function grantTrialMembership() {
    const targetUsername = adminTrialUsername.value.trim().toLowerCase();
    const planKey = adminTrialPlan.value;
    const duration = parseInt(adminTrialDuration.value);
    const unit = adminTrialUnit.value;

    if (!targetUsername || isNaN(duration) || duration <= 0) {
        return alert("Please provide a valid username and duration.");
    }

    try {
        const q = query(collection(db, "users"), where("username", "==", targetUsername));
        const snap = await getDocs(q);
        if (snap.empty) return alert("User not found!");

        const targetUserDoc = snap.docs[0];
        const targetUid = targetUserDoc.id;

        let expirationDate = new Date();
        if (unit === "days") {
            expirationDate.setDate(expirationDate.getDate() + duration);
        } else if (unit === "months") {
            expirationDate.setMonth(expirationDate.getMonth() + duration);
        }

        await updateDoc(doc(db, "users", targetUid), {
            membershipLevel: planKey,
            trialExpiration: expirationDate.toISOString(),
            membershipLastPaid: new Date().toISOString()
        });

        await logHistory(targetUid, `Admin granted ${duration} ${unit} of ${planKey} (Trial)`, "admin");

        const timestamp = new Date().toLocaleString();
        sendSlackMessage(
            `🎁 *Admin Grant:* Free Trial issued to *${targetUsername}*.\n` +
            `🔹 *Plan:* ${planKey.toUpperCase()}\n` +
            `⏳ *Duration:* ${duration} ${unit}\n` +
            `🕒 *Time:* ${timestamp}`
        );

        alert(`Successfully granted ${planKey} to ${targetUsername} until ${expirationDate.toLocaleDateString()}.`);
        
        adminTrialUsername.value = "";
        adminTrialDuration.value = "";
        adminTrialUserInfo.textContent = "N/A";
    } catch (err) {
        console.error("Trial Grant Error:", err);
        alert("Failed to grant membership.");
    }
}

async function revokeMembership() {
    const targetUsername = adminTrialUsername.value.trim().toLowerCase();
    if (!targetUsername) return alert("Please enter a username to revoke.");

    if (!confirm(`Are you sure you want to revoke ALL membership perks and trials for ${targetUsername}?`)) return;

    try {
        const q = query(collection(db, "users"), where("username", "==", targetUsername));
        const snap = await getDocs(q);
        if (snap.empty) return alert("User not found.");

        const userDoc = snap.docs[0];
        const userRef = doc(db, "users", userDoc.id);

        await updateDoc(userRef, {
            membershipLevel: "standard",
            trialExpiration: null,
            membershipLastPaid: null,
            shopOrderCount: 0
        });

        await logHistory(userDoc.id, "Admin revoked your membership/trial status.", "admin");

        const timestamp = new Date().toLocaleString();
        sendSlackMessage(`🚫 *Admin Revoke:* ${targetUsername}'s membership/trial has been manually revoked by Admin.\n*Time:* ${timestamp}`);

        alert(`Successfully revoked membership for ${targetUsername}.`);
        
        adminTrialUsername.value = "";
        adminTrialUserInfo.textContent = "N/A";
    } catch (err) {
        console.error("Revoke Error:", err);
        alert("Failed to revoke membership.");
    }
}

if (adminGrantTrialBtn) adminGrantTrialBtn.addEventListener("click", grantTrialMembership);
if (adminRevokeTrialBtn) adminRevokeTrialBtn.addEventListener("click", revokeMembership);

// ---------- Renewal Requests ----------
export async function loadRenewalRequests() {
  if (!renewalRequestsContainer) return;
  renewalRequestsContainer.innerHTML = "<p style='color: gray; font-style: italic;'>Checking for requests...</p>";
  try {
    const q = query(collection(db, "users"), where("renewalPending", "==", true));
    const snap = await getDocs(q);
    if (snap.empty) {
      renewalRequestsContainer.innerHTML = "<p style='color: gray; font-style: italic;'>No pending renewal requests.</p>";
      return;
    }
    renewalRequestsContainer.innerHTML = "";
    snap.forEach((docSnap) => {
      const userData = docSnap.data();
      const reqDate = userData.renewalRequestDate ? new Date(userData.renewalRequestDate).toLocaleDateString() : "Unknown";
      const div = document.createElement("div");
      div.className = "renew-request";
      div.style.padding = "15px 0";
      div.style.borderBottom = "1px solid #eee";
      div.innerHTML = `
        <div style="margin-bottom: 5px;">
        <strong style="font-size: 1.2em;">${userData.username}</strong><br>
        <span style="font-size: 0.9em; color: #888;">Requested: ${reqDate}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 15px; margin-top: 10px;">
          <label style="color: #888; font-size: 0.9em;">Expires:</label>
          <input type="date" id="date-${docSnap.id}" style="background: #222; color: #fff; border: 1px solid #444; padding: 8px 12px; border-radius: 5px; flex-grow: 1;">
          <button data-id="${docSnap.id}" class="approve-renew" style="background: #58d68d; color: white; border: none; padding: 10px 20px; border-radius: 8px; font-weight: bold; cursor: pointer;">Approve</button>
          <button data-id="${docSnap.id}" class="deny-renew" style="background: #e74c3c; color: #fff; border: none; padding: 10px 20px; border-radius: 8px; font-weight: bold; cursor: pointer;">Deny</button>
        </div>`;
      renewalRequestsContainer.appendChild(div);
    });
    attachRenewalListeners();
  } catch (err) {
    console.error("Renewal load failed:", err);
    renewalRequestsContainer.innerHTML = "<p style='color: red;'>Error loading requests.</p>";
  }
}

function attachRenewalListeners() {
  document.querySelectorAll(".approve-renew").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const userId = btn.dataset.id;
      const dateInput = document.getElementById(`date-${userId}`);
      if (!dateInput.value) return alert("⚠️ Select an expiration date!");
      const expirationDate = new Date(dateInput.value);
      expirationDate.setHours(23, 59, 59); 
      try {
        const userSnap = await getDoc(doc(db, "users", userId));
        const username = userSnap.exists() ? userSnap.data().username : "Unknown User";

        await updateDoc(doc(db, "users", userId), { renewalDate: new Date().toISOString(), expirationDate: expirationDate.toISOString(), renewalPending: false });
        await logHistory(userId, `ID Renewal Approved`, "admin");
        
        const timestamp = new Date().toLocaleString();
        sendSlackMessage(`🪪 *ID Renewal:* Admin approved identity renewal for *${username}*.\n*New Expiration:* ${expirationDate.toLocaleDateString()}\n*Time:* ${timestamp}`);

        alert(`✅ Approved!`);
        loadRenewalRequests();
      } catch (err) { alert("Error: " + err.message); }
    });
  });
  document.querySelectorAll(".deny-renew").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const userId = btn.dataset.id;
      if (!confirm("Deny this request?")) return;
      try {
        await updateDoc(doc(db, "users", userId), { renewalPending: false });
        await logHistory(userId, `ID Renewal Denied`, "admin");
        alert(`❌ Request Denied.`);
        loadRenewalRequests();
      } catch (err) { alert("Error: " + err.message); }
    });
  });
}

// --- COSMETICS ADMIN ---
const adminCosmeticsUsername = document.getElementById("admin-cosmetics-username");
const adminCosmeticsUserInfo = document.getElementById("admin-cosmetics-user-info");
const adminCosmeticsList = document.getElementById("admin-cosmetics-list");

adminCosmeticsUsername?.addEventListener("input", () => handleUserLookup(adminCosmeticsUsername, adminCosmeticsUserInfo, null, "cosmetic"));

async function renderCosmeticsAdmin(userId, userData) {
  if (!adminCosmeticsList) return;
  if (!adminCosmeticsCache) { adminCosmeticsCache = await getDocs(collection(db, "cosmeticsShop")); }
  adminCosmeticsList.innerHTML = "";
  adminCosmeticsCache.forEach((docSnap) => {
    const item = docSnap.data();
    const owned = userData.cosmeticsOwned?.[docSnap.id] === true;
    const div = document.createElement("div");
    div.style.display = "flex"; div.style.justifyContent = "space-between"; div.style.marginBottom = "5px";
    div.innerHTML = `<span>${item.name}</span><button style="cursor:pointer;">${owned ? "Revoke" : "Grant"}</button>`;
    div.querySelector("button").onclick = async () => {
      const cosmeticsOwned = { ...(userData.cosmeticsOwned || {}) };
      if (owned) delete cosmeticsOwned[docSnap.id]; else cosmeticsOwned[docSnap.id] = true;
      await updateDoc(doc(db, "users", userId), { cosmeticsOwned });
      await logHistory(userId, `Admin updated cosmetic: ${item.name}`, "admin");
    };
    adminCosmeticsList.appendChild(div);
  });
}

// --- EMPLOYMENT & NEW CONTRACTS ---
const empUsernameInput = document.getElementById("admin-employment-username");
const empUserInfo = document.getElementById("admin-employment-user-info");
const empSetBtn = document.getElementById("admin-set-employment-btn");
const empStatusSelect = document.getElementById("admin-employment-status-select");

empUsernameInput?.addEventListener("input", () => handleUserLookup(empUsernameInput, empUserInfo, empSetBtn, "emp"));

async function updateEmploymentStatus() {
    const username = empUsernameInput.value.trim().toLowerCase();
    const newStatus = empStatusSelect.value;
    if (!username) return alert("Enter a username.");
    try {
        const q = query(collection(db, "users"), where("username", "==", username));
        const snap = await getDocs(q);
        if (snap.empty) return alert("User not found.");
        const userDoc = snap.docs[0];
        await updateDoc(doc(db, "users", userDoc.id), { employmentStatus: newStatus });
        await logHistory(userDoc.id, `Admin set status to ${newStatus}`, "admin");
        alert(`✅ Status updated!`);
    } catch (err) { alert("Failed to update status."); }
}
if (empSetBtn) empSetBtn.addEventListener("click", updateEmploymentStatus);

// --- START CONTRACT LOGIC ---
const adminContractUsername = document.getElementById("admin-contract-username");
const adminContractUserInfo = document.getElementById("admin-contract-user-info");
const adminContractBtn = document.getElementById("admin-offer-contract-btn");

const contractTeam = document.getElementById("contract-team");
const contractSeasons = document.getElementById("contract-seasons");
const contractSigningBonus = document.getElementById("contract-signing-bonus");
const contractGuaranteed = document.getElementById("contract-guaranteed");
const contractNonGuaranteed = document.getElementById("contract-non-guaranteed");
const contractIncentives = document.getElementById("contract-incentives");
const contractBaseCycle = document.getElementById("contract-base-cycle");

[contractGuaranteed, contractNonGuaranteed].forEach(el => {
    el?.addEventListener("input", () => {
        const g = parseFloat(contractGuaranteed.value) || 0;
        const ng = parseFloat(contractNonGuaranteed.value) || 0;
        if (contractBaseCycle) contractBaseCycle.value = `$${(g + ng).toLocaleString()} per season`;
    });
});

async function sendContractOffer() {
    const username = adminContractUsername.value.trim().toLowerCase();
    const team = contractTeam.value.trim();
    const seasons = parseInt(contractSeasons.value);
    const bonus = parseFloat(contractSigningBonus.value) || 0;
    const g = parseFloat(contractGuaranteed.value) || 0;
    const ng = parseFloat(contractNonGuaranteed.value) || 0;

    if (!username || !team || isNaN(seasons) || seasons <= 0) return alert("⚠️ Check inputs (Username, Team, Seasons).");
    if (g <= 0 && ng <= 0 && bonus <= 0) return alert("⚠️ Offer cannot be $0.");

    const totalVal = bonus + ((g + ng) * seasons);
    if (!confirm(`Send offer to ${username} for ${team}? Total: $${totalVal.toLocaleString()}`)) return;

    try {
        const q = query(collection(db, "users"), where("username", "==", username));
        const snap = await getDocs(q);
        if (snap.empty) return alert("❌ Player not found.");
        const playerDoc = snap.docs[0];

        await addDoc(collection(db, "contracts"), {
            playerUID: playerDoc.id,
            team: team,
            status: "offered",
            signingBonus: bonus,
            terms: {
                seasons: seasons,
                initialSeasons: seasons, 
                guaranteedPay: g,
                nonGuaranteedPay: ng,
                incentives: contractIncentives.value.trim() || "Standard Conduct"
            },
            timestamp: new Date().toISOString()
        });
        await logHistory(playerDoc.id, `New offer from ${team}`, "contract");
        alert(`🏀 Offer sent!`);
        [contractTeam, contractSeasons, contractSigningBonus, contractGuaranteed, contractNonGuaranteed, contractIncentives, contractBaseCycle].forEach(el => { if(el) el.value = ""; });
    } catch (err) { alert("Failed to send offer."); }
}

adminContractUsername?.addEventListener("input", () => handleUserLookup(adminContractUsername, adminContractUserInfo, adminContractBtn, "contract"));
if (adminContractBtn) adminContractBtn.addEventListener("click", sendContractOffer);

/* =========================================================
    ESCROW OVERSIGHT (ADMIN CONTROL - QUOTA SAVER)
========================================================= */
export function listenToAllEscrow() {
  if (!adminEscrowList) return;
  if (adminEscrowListener) adminEscrowListener();

  const q = query(collection(db, "pending_transfers"));

  adminEscrowListener = onSnapshot(q, (snapshot) => {
    adminEscrowList.innerHTML = "";
    if (snapshot.empty) {
      adminEscrowList.innerHTML = "<p style='color: gray; font-style: italic;'>No active escrow transfers.</p>";
      return;
    }

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const div = document.createElement("div");
      div.style = "background: rgba(231, 76, 60, 0.05); border: 1px solid #e74c3c; padding: 12px; margin-bottom: 10px; border-radius: 8px;";
      
      div.innerHTML = `
        <div style="font-size: 0.85rem; margin-bottom: 8px;">
            <strong>From:</strong> ${data.fromName} → <strong>To:</strong> ${data.toName || "Unknown"}<br>
            <strong>Amount:</strong> <span style="color: #e74c3c; font-weight: bold;">$${data.amount.toLocaleString()}</span>
        </div>
        <div style="display: flex; gap: 8px;">
            <button class="admin-void-btn" data-id="${docSnap.id}" style="flex: 1; background: #e74c3c; color: white; border: none; padding: 8px; border-radius: 5px; cursor: pointer; font-size: 0.75rem; font-weight: bold;">VOID (REFUND)</button>
            <button class="admin-release-btn" data-id="${docSnap.id}" style="flex: 1; background: #2ecc71; color: white; border: none; padding: 8px; border-radius: 5px; cursor: pointer; font-size: 0.75rem; font-weight: bold;">FORCE RELEASE</button>
        </div>
      `;
      adminEscrowList.appendChild(div);
    });
  });
}

async function handleAdminEscrowAction(escrowId, action) {
  const escrowRef = doc(db, "pending_transfers", escrowId);
  
  try {
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(escrowRef);
      if (!snap.exists()) throw "Transfer not found.";
      const data = snap.data();
      
      const targetUid = (action === 'void') ? data.from : data.to;
      const userRef = doc(db, "users", targetUid);
      const userSnap = await transaction.get(userRef);
      
      transaction.update(userRef, { balance: (userSnap.data().balance || 0) + data.amount });
      transaction.delete(escrowRef);
    });
    alert(action === 'void' ? "Refund successful." : "Funds released early.");
  } catch (e) { alert("Action failed: " + e); }
}

document.addEventListener("click", (e) => {
  if (e.target.classList.contains("admin-void-btn")) handleAdminEscrowAction(e.target.dataset.id, 'void');
  if (e.target.classList.contains("admin-release-btn")) handleAdminEscrowAction(e.target.dataset.id, 'release');
});

/* =========================================================
    ADMIN ROSTER: OPTIMIZED SPLIT PAYMENT CONTROLS
========================================================= */
export function listenForAdminRoster() {
    if (!adminRosterContainer) return;
    if (activeAdminListener) activeAdminListener();
    
    const q = query(collection(db, "contracts"), where("status", "==", "active"));

    activeAdminListener = onSnapshot(q, (snap) => {
        adminRosterContainer.innerHTML = "";
        if (snap.empty) {
            adminRosterContainer.innerHTML = `<p style="color: gray; text-align: center;">No active players.</p>`;
            return;
        }

        snap.forEach((contractDoc) => {
            const data = contractDoc.data();
            const docId = contractDoc.id;
            const terms = data.terms || {};

            const targetG = (terms.guaranteedPay || 0) / 6;
            const targetB = (terms.nonGuaranteedPay || 0) / 6;
            
            const div = document.createElement("div");
            div.className = "contract-card admin-roster-card";
            div.style.cssText = "padding: 20px; border-radius: 12px; margin-bottom: 20px; background: var(--card-bg, #1a1a1a); border: 1px solid var(--border-color, #333); color: var(--text-color, #fff);";

            div.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                    <strong style="color: #3498db; font-size: 1.3rem;">${data.playerName || 'Player'}</strong>
                    <span style="background: rgba(52, 152, 219, 0.2); color: #3498db; padding: 4px 8px; border-radius: 6px; font-size: 0.65rem; font-weight: 800;">${terms.seasons?.toFixed(2)} SEASONS LEFT</span>
                </div>
                <div style="font-size: 0.75rem; color: #888; margin-bottom: 5px;">Team: ${data.team} | Total Season: $${((terms.guaranteedPay || 0) + (terms.nonGuaranteedPay || 0)).toLocaleString()}</div>
                
                <div style="font-size: 0.65rem; color: #888; margin-bottom: 15px; background: rgba(255,255,255,0.02); padding: 5px; border-radius: 4px; border: 1px solid #222; display: flex; justify-content: space-around;">
                    <span>Installment Targets:</span>
                    <span><b>$${targetG.toLocaleString()}</b> (G)</span>
                    <span><b>$${targetB.toLocaleString()}</b> (B)</span>
                </div>

                <div id="admin-alert-area-${data.playerUID}"></div>
                
                <div style="background: rgba(0,0,0,0.2); padding: 15px; border-radius: 8px; margin: 15px 0; border: 1px solid #333;">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px;">
                        <div>
                            <label style="font-size: 0.6rem; color: #2ecc71; display: block; margin-bottom: 4px; font-weight: 900;">PAY GUARANTEED ($)</label>
                            <input type="number" id="pay-g-${docId}" placeholder="0" style="width: 100%; background: #111; border: 1px solid #444; color: white; padding: 8px; border-radius: 6px;">
                        </div>
                        <div>
                            <label style="font-size: 0.6rem; color: #f1c40f; display: block; margin-bottom: 4px; font-weight: 900;">PAY BONUS ($)</label>
                            <input type="number" id="pay-b-${docId}" placeholder="0" style="width: 100%; background: #111; border: 1px solid #444; color: white; padding: 8px; border-radius: 6px;">
                        </div>
                    </div>
                    <button onclick="adminActionContract('${docId}', 'payInstallment')" style="width: 100%; background: #2ecc71; color: white; border: none; padding: 10px; border-radius: 8px; font-weight: bold; cursor: pointer;">PROCESS SPLIT PAYMENT</button>
                </div>
                
                <div style="display: flex; gap: 8px;">
                    <button onclick="adminActionContract('${docId}', 'cut')" style="flex:1; background:#e74c3c; color:white; border:none; padding:10px; border-radius:6px; font-weight:bold; font-size:0.7rem; cursor:pointer;">CUT</button>
                    <button onclick="tradePlayer('${docId}')" style="flex:1; background:#f39c12; color:white; border:none; border-radius:6px; padding:10px; font-weight:bold; font-size:0.7rem; cursor:pointer;">TRADE</button>
                    <button onclick="offerExtension('${docId}')" style="flex:1; background:#444; color:white; border:none; padding:10px; border-radius:6px; font-weight:bold; font-size:0.7rem; cursor:pointer;">EXTEND</button>
                </div>
            `;
            adminRosterContainer.appendChild(div);

            // DATA ENGINEERING FIX: Optimized lookup using one-time fetch to preserve quota
            getDoc(doc(db, "users", data.playerUID)).then(uSnap => {
                if (!uSnap.exists()) return;
                const uData = uSnap.data();
                const alertContainer = document.getElementById(`admin-alert-area-${data.playerUID}`);
                if (alertContainer && (uData.tradePending || uData.releasePending)) {
                    const isTrade = uData.tradePending;
                    alertContainer.innerHTML = `
                        <div style="border: 2px solid #e74c3c; background: rgba(231, 76, 60, 0.05); padding: 12px; border-radius: 8px; margin: 15px 0;">
                            <div style="color: #e74c3c; font-weight: 900; font-size: 0.75rem; margin-bottom: 10px; text-transform: uppercase;">
                                🚨 PLAYER REQUEST: ${isTrade ? 'TRADE' : 'RELEASE'}
                            </div>
                            <div style="display: flex; gap: 8px;">
                                ${isTrade ? `
                                    <button onclick="handleAdminDecision('${docId}', '${data.playerUID}', 'looking')" 
                                            style="flex:1; background: #f39c12; color:white; border:none; border-radius:6px; padding:10px; font-weight:bold; font-size:0.7rem; cursor:pointer;">
                                        LOOKING
                                    </button>` : ''}
                                <button onclick="handleAdminDecision('${docId}', '${data.playerUID}', 'approve')" 
                                        style="flex:1; background: #2ecc71; color:white; border:none; border-radius:6px; padding:10px; font-weight:bold; font-size:0.7rem; cursor:pointer;">
                                    APPROVE
                                </button>
                                <button onclick="handleAdminDecision('${docId}', '${data.playerUID}', 'reject')" 
                                        style="flex:1; background: #e74c3c; color:white; border:none; border-radius:6px; padding:10px; font-weight:bold; font-size:0.7rem; cursor:pointer;">
                                    REJECT
                                </button>
                            </div>
                        </div>
                    `;
                }
            });
        });
    });
}

// ---------- Global Initializers & Navigation ----------
if (addItemBtn) addItemBtn.addEventListener("click", addShopItem);
if (adminGiveBtn) adminGiveBtn.addEventListener("click", giveMoney);
if (adminGiveBpsBtn) adminGiveBpsBtn.addEventListener("click", giveBps);

const openAdminBtn = document.getElementById("open-admin");
if (openAdminBtn) openAdminBtn.addEventListener("click", () => { 
    loadRenewalRequests(); 
    listenForAdminRoster(); 
    listenToAllEscrow();
    listenToEconomyStats(); // NEW: Economy Listener
});

if (adminPanel && !adminPanel.classList.contains("hidden")) { 
    loadRenewalRequests(); 
    listenForAdminRoster();
    listenToAllEscrow(); 
    listenToEconomyStats(); // NEW: Economy Listener
}