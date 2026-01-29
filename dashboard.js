// ---------- dashboard.js (UPDATED: Cosmetics + Dark Mode + Full Dashboard + Cosmetics History Logging) ----------
console.log("dashboard.js loaded");

import { auth, db } from "./firebaseConfig.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { doc, onSnapshot, updateDoc, collection, query, orderBy, limit, getDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { logHistory } from "./historyManager.js";
import { currentUserData, renderSavings } from "./retirement.js";

/* =========================================================
   INSTANT THEME APPLY (prevents light flash on refresh)
========================================================= */
const savedTheme = localStorage.getItem("theme");
if (savedTheme === "dark") document.body.classList.add("dark-mode");
if (savedTheme === "light") document.body.classList.add("light-mode");

// ---------- UI Elements ----------
const dashboard = document.getElementById("dashboard");
const adminPanel = document.getElementById("admin-panel");
const userName = document.getElementById("user-name");
const userBalance = document.getElementById("user-balance");
const logoutBtn = document.getElementById("logout-btn");
const openAdminBtn = document.getElementById("open-admin");
const backToDashboardBtn = document.getElementById("back-to-dashboard");
const themeToggleBtn = document.getElementById("theme-toggle-btn");

// Profile section
const profileUsername = document.getElementById("profile-username");
const profileUid = document.getElementById("profile-uid");
const profileRenewal = document.getElementById("profile-renewal");
const profileExpiration = document.getElementById("profile-expiration");
const renewalStatus = document.getElementById("renewal-status");
const renewBtn = document.getElementById("renew-btn");

// Employment status
const employmentStatusEl = document.getElementById("employment-status");

// History table
const historyTable = document.getElementById("history-table");

// Retirement savings elements
// const retirementSavingsEl = document.getElementById("retirement-savings");
// const retirementInterestEl = document.getElementById("retirement-interest");
// const retirementDaysEl = document.getElementById("retirement-days");
// const retirementDepositInput = document.getElementById("retirement-deposit");
// const retirementDepositBtn = document.getElementById("retirement-deposit-btn");
// const retirementWithdrawInput = document.getElementById("retirement-withdraw");
// const retirementWithdrawBtn = document.getElementById("retirement-withdraw-btn");
// const retirementMessageEl = document.getElementById("retirement-message");

let currentDashboardData = null;

/* =========================================================
   THEME FUNCTION
========================================================= */
function applyTheme(theme) {
  if (theme === "light") {
    document.body.classList.add("light-mode");
    document.body.classList.remove("dark-mode");
    if (themeToggleBtn) themeToggleBtn.textContent = "🌙 Dark Mode";
  } else {
    document.body.classList.add("dark-mode");
    document.body.classList.remove("light-mode");
    if (themeToggleBtn) themeToggleBtn.textContent = "☀️ Light Mode";
  }

  localStorage.setItem("theme", theme);
}

/* =========================================================
   AUTH STATE
========================================================= */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    dashboard.classList.add("hidden");
    adminPanel.classList.add("hidden");
    currentDashboardData = null;
    return;
  }

  dashboard.classList.remove("hidden");

  const userRef = doc(db, "users", user.uid);
  let themeAppliedOnce = false; // new flag

  onSnapshot(userRef, snap => {
    if (!snap.exists()) return;
    currentDashboardData = snap.data();

    // Apply Dark Mode ONLY ONCE (when dashboard loads)
    if (!themeAppliedOnce) {
        const theme = currentDashboardData.cosmeticsOwned?.darkMode
            ? (currentDashboardData.theme || localStorage.getItem("theme") || "dark")
            : "light"; // default to light if cosmetic not owned
        applyTheme(theme);
        themeAppliedOnce = true; // don't override again
    }

    //applyMonthlyInterest(user.uid);
    updateDashboardUI(user);
});


  // History
  const historyRef = collection(db, "users", user.uid, "history_logs");
  const q = query(historyRef, orderBy("timestamp", "desc"), limit(30));

  onSnapshot(q, (snapshot) => {
    const historyData = [];
    snapshot.forEach(doc => historyData.push(doc.data()));
    loadHistory(historyData);
  });
});

/* =========================================================
   DASHBOARD UI UPDATE
========================================================= */
function updateDashboardUI(user) {
  if (!currentDashboardData) return;
  const data = currentDashboardData;

  const balance = Number(data.balance) || 0;
  userName.textContent = data.username || user.email.split("@")[0];
  userBalance.textContent = `$${balance.toLocaleString()}`;

  profileUsername.textContent = data.username || user.email.split("@")[0];
  profileUid.textContent = user.uid.slice(0, 8);

  const now = new Date();
  const renewalDate = data.renewalDate ? new Date(data.renewalDate) : null;
  const expirationDate = data.expirationDate ? new Date(data.expirationDate) : null;

  profileRenewal.textContent = renewalDate ? renewalDate.toLocaleDateString() : "N/A";
  profileExpiration.textContent = expirationDate ? expirationDate.toLocaleDateString() : "N/A";

  if (data.renewalPending) {
    renewalStatus.textContent = "Pending Approval";
    renewalStatus.style.color = "orange";
  } else if (expirationDate && expirationDate < now) {
    renewalStatus.textContent = "Expired";
    renewalStatus.style.color = "red";
  } else {
    renewalStatus.textContent = "Active";
    renewalStatus.style.color = "green";
  }

  const employmentStatus = data.employmentStatus || "Unemployed";
  let color = "red";
  if (employmentStatus === "Employed") color = "green";
  if (employmentStatus === "Retired") color = "blue";
  if (employmentStatusEl) {
    employmentStatusEl.textContent = employmentStatus;
    employmentStatusEl.style.color = color;
    employmentStatusEl.style.fontWeight = "bold";
  }

  if (data.isAdmin) openAdminBtn.classList.remove("hidden");
  else openAdminBtn.classList.add("hidden");

  const bps = data.bpsBalance || 0;
  const bpsEl = document.getElementById("user-bps");
  if(bpsEl) bpsEl.textContent = `${bps} BPS`;

  const discount = data.activeDiscount || 0;
  const discountEl = document.getElementById("active-discount-indicator");
  if(discountEl) {
    if(discount > 0) {
      discountEl.textContent = `🔥 ${discount * 100}% Discount Active!`;
      discountEl.classList.remove("hidden");
    } else {
      discountEl.classList.add("hidden");
    }
  }
}

  // // ---------- Retirement ----------
  // const savings = Number(data.retirementSavings || 0);
  // retirementSavingsEl.textContent = savings.toFixed(2);

  // const interest = savings * 0.03;
  // retirementInterestEl.textContent = interest.toFixed(2);

  // const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // let nextInterestDate = new Date(now.getFullYear(), now.getMonth(), 1);
  // if(nowMidnight >= nextInterestDate) {
  //   nextInterestDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  // }
  // const diffDays = Math.ceil((nextInterestDate - nowMidnight) / (1000*60*60*24));
  // retirementDaysEl.textContent = diffDays;

  // Enable/Disable buttons
//   if(employmentStatus === "Employed") {
//     retirementDepositBtn.disabled = false;
//     retirementWithdrawBtn.disabled = true;
//     retirementDepositInput.disabled = false;
//     retirementWithdrawInput.disabled = true;
//   } else if(employmentStatus === "Unemployed") {
//     retirementDepositBtn.disabled = true;
//     retirementWithdrawBtn.disabled = true;
//     retirementDepositInput.disabled = true;
//     retirementWithdrawInput.disabled = true;
//   } else if(employmentStatus === "Retired") {
//     retirementDepositBtn.disabled = true;
//     retirementWithdrawBtn.disabled = false;
//     retirementDepositInput.disabled = true;
//     retirementWithdrawInput.disabled = false;
//   }
// }

// /* =========================================================
//    RETIREMENT ACTIONS
// ========================================================= */
// async function depositRetirement() {
//   if (!auth.currentUser) return;
//   const userRef = doc(db, "users", auth.currentUser.uid);
//   const amount = parseFloat(retirementDepositInput.value);
//   if (isNaN(amount) || amount <= 0) {
//     showRetirementMessage("Enter a valid deposit amount.", "error");
//     return;
//   }

//   const currentBalance = Number(currentDashboardData.balance || 0);
//   if (amount > currentBalance) {
//     showRetirementMessage("Insufficient main balance.", "error");
//     return;
//   }

//   if(currentDashboardData.employmentStatus !== "Employed") {
//     showRetirementMessage("Only Employed users can deposit.", "error");
//     return;
//   }

//   try {
//     const newBalance = currentBalance - amount;
//     const newSavings = (Number(currentDashboardData.retirementSavings) || 0) + amount;

//     await updateDoc(userRef, { balance: newBalance, retirementSavings: newSavings });
//     showRetirementMessage(`Deposited $${amount.toFixed(2)} to retirement savings.`, "success");
//     retirementDepositInput.value = "";
//   } catch(err) {
//     console.error(err);
//     showRetirementMessage("Deposit failed: " + err.message, "error");
//   }
// }

// async function withdrawRetirement() {
//   if (!auth.currentUser) return;
//   const userRef = doc(db, "users", auth.currentUser.uid);
//   const amount = parseFloat(retirementWithdrawInput.value);
//   if (isNaN(amount) || amount <= 0) {
//     showRetirementMessage("Enter a valid withdraw amount.", "error");
//     return;
//   }

//   const savings = Number(currentDashboardData.retirementSavings || 0);
//   if(amount > savings) {
//     showRetirementMessage("Insufficient retirement savings.", "error");
//     return;
//   }

//   if(currentDashboardData.employmentStatus !== "Retired") {
//     showRetirementMessage("Only Retired users can withdraw.", "error");
//     return;
//   }

//   try {
//     const balance = Number(currentDashboardData.balance || 0);
//     const newBalance = balance + amount;
//     const newSavings = savings - amount;

//     await updateDoc(userRef, { balance: newBalance, retirementSavings: newSavings });
//     showRetirementMessage(`Withdrew $${amount.toFixed(2)} to main balance.`, "success");
//     retirementWithdrawInput.value = "";
//   } catch(err) {
//     console.error(err);
//     showRetirementMessage("Withdraw failed: " + err.message, "error");
//   }
// }

// function showRetirementMessage(msg, type) {
//   if(!retirementMessageEl) return;
//   retirementMessageEl.textContent = msg;
//   retirementMessageEl.style.color = type === "error" ? "red" : "green";
//   setTimeout(() => retirementMessageEl.textContent = "", 4000);
// }


/* =========================================================
   COSMETICS PURCHASE FUNCTION (LOGS HISTORY)
========================================================= */
export async function purchaseCosmetic(itemId) {
  if (!auth.currentUser) return;

  const userRef = doc(db, "users", auth.currentUser.uid);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) return;

  const userData = userSnap.data();
  const balance = Number(userData.balance || 0);
  const cosmeticsOwned = userData.cosmeticsOwned || {};

  // Already owned?
  if (cosmeticsOwned[itemId]) {
    alert("You already own this cosmetic!");
    return;
  }

  const itemRef = doc(db, "cosmeticsShop", itemId);
  const itemSnap = await getDoc(itemRef);
  if (!itemSnap.exists()) return alert("Item not found.");

  const itemData = itemSnap.data();
  const price = Number(itemData.price || 0);

  if (balance < price) {
    alert("Insufficient balance.");
    return;
  }

  try {
    // Deduct balance and mark cosmetic as owned
    const newBalance = balance - price;
    const newCosmetics = { ...cosmeticsOwned, [itemId]: true };

    await updateDoc(userRef, {
      balance: newBalance,
      cosmeticsOwned: newCosmetics
    });

    // --- LOG PURCHASE WITH TIMESTAMP ---
    const timestamp = new Date().toISOString();

    if (itemId === "darkMode") {
      // Special history message for Dark Mode
      await logHistory(auth.currentUser.uid, `🎨 Purchased Dark Mode cosmetic for $${price.toFixed(2)}!`, "purchase", timestamp);
    } else {
      await logHistory(auth.currentUser.uid, `Purchased cosmetic: ${itemData.name} for $${price.toFixed(2)}`, "purchase", timestamp);
    }

    alert(`Purchased ${itemData.name} for $${price.toFixed(2)}!`);
  } catch (err) {
    console.error(err);
    alert("Purchase failed: " + err.message);
  }
}



/* =========================================================
   EVENTS
========================================================= */
// retirementDepositBtn?.addEventListener("click", depositRetirement);
// retirementWithdrawBtn?.addEventListener("click", withdrawRetirement);

// THEME TOGGLE: only works if Dark Mode cosmetic is owned
themeToggleBtn?.addEventListener("click", async () => {
  if(!auth.currentUser) return;

  if(!currentDashboardData?.cosmeticsOwned?.darkMode) {
    alert("🎨 Buy Dark Mode from the Cosmetics Shop to unlock this feature.");
    return;
  }

  const isLight = document.body.classList.contains("light-mode");
  const newTheme = isLight ? "dark" : "light";

  applyTheme(newTheme);

  const userRef = doc(db, "users", auth.currentUser.uid);
  await updateDoc(userRef, { theme: newTheme });
});

openAdminBtn?.addEventListener("click", () => {
  dashboard.classList.add("hidden");
  adminPanel.classList.remove("hidden");
});

backToDashboardBtn?.addEventListener("click", () => {
  adminPanel.classList.add("hidden");
  dashboard.classList.remove("hidden");
});

logoutBtn?.addEventListener("click", async () => {
  await signOut(auth);
  dashboard.classList.add("hidden");
  adminPanel.classList.add("hidden");
});

/* =========================================================
   RENEWAL REQUEST
========================================================= */
renewBtn?.addEventListener("click", async () => {
  if (!auth.currentUser) return;
  const userRef = doc(db, "users", auth.currentUser.uid);
  try {
    await updateDoc(userRef, { 
      renewalPending: true, 
      renewalRequestDate: new Date().toISOString() 
    });
    alert("Renewal request sent. Waiting for admin approval.");
  } catch (err) {
    console.error("Renewal request failed:", err);
    alert("Could not send renewal request: " + err.message);
  }
});

/* =========================================================
   HISTORY
========================================================= */
function loadHistory(historyArray) {
  if (!historyTable) return;
  historyTable.innerHTML = "";

  if (!historyArray || historyArray.length === 0) {
    historyTable.innerHTML = `<tr><td class="no-history">No history found.</td></tr>`;
    return;
  }

  const validHistory = historyArray.filter(entry => 
    entry.timestamp && !isNaN(new Date(entry.timestamp).getTime())
  );

  validHistory.forEach(entry => {
    const row = document.createElement("tr");
    
    let icon = "📄";

    switch(entry.type) {
      case "transfer-in":  icon = "💸"; break;
      case "transfer-out": icon = "📤"; break;
      case "purchase":     icon = "🛒"; break;
      case "usage":        icon = "🧪"; break;
      case "admin":        icon = "🛡️"; break;
      case "contract":     icon = "📝"; break;
    }

    const timeString = getRelativeTime(new Date(entry.timestamp));

    row.innerHTML = `
      <td class="history-row">
        <div class="history-entry">
          <div class="history-icon ${entry.type}">${icon}</div>
          <div class="history-text">
            <div class="message">${entry.message}</div>
            <div class="timestamp">${timeString}</div>
          </div>
        </div>
      </td>
    `;

    historyTable.appendChild(row);
  });
}

function getRelativeTime(date) {
  const now = new Date();
  const diff = Math.floor((now - date) / 1000);

  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} mins ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  return date.toLocaleDateString(); 
}

// ---------- Heartbeat ----------
setInterval(() => {
  if (auth.currentUser && currentDashboardData) {
    updateDashboardUI(auth.currentUser);
  }
}, 5000);
