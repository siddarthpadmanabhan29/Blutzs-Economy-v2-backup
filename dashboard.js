// ---------- dashboard.js (UPDATED: Employment + Retirement Savings + Monthly Interest + Input Controls) ----------
console.log("dashboard.js loaded");

import { auth, db } from "./firebaseConfig.js";
import { 
  onAuthStateChanged, 
  signOut 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
  doc, onSnapshot, updateDoc, collection, query, orderBy, limit 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// ---------- UI Elements ----------
const dashboard = document.getElementById("dashboard");
const adminPanel = document.getElementById("admin-panel");
const userName = document.getElementById("user-name");
const userBalance = document.getElementById("user-balance");
const logoutBtn = document.getElementById("logout-btn");
const openAdminBtn = document.getElementById("open-admin");
const backToDashboardBtn = document.getElementById("back-to-dashboard");

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
const retirementSavingsEl = document.getElementById("retirement-savings");
const retirementInterestEl = document.getElementById("retirement-interest");
const retirementDaysEl = document.getElementById("retirement-days");
const retirementDepositInput = document.getElementById("retirement-deposit");
const retirementDepositBtn = document.getElementById("retirement-deposit-btn");
const retirementWithdrawInput = document.getElementById("retirement-withdraw");
const retirementWithdrawBtn = document.getElementById("retirement-withdraw-btn");
const retirementMessageEl = document.getElementById("retirement-message");

let currentDashboardData = null;

// ---------- Auth State Listener ----------
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    dashboard.classList.add("hidden");
    adminPanel.classList.add("hidden");
    currentDashboardData = null;
    return;
  }

  dashboard.classList.remove("hidden");

  // 1. LISTEN TO USER PROFILE
  const userRef = doc(db, "users", user.uid);
  onSnapshot(userRef, snap => {
    if (!snap.exists()) return;
    currentDashboardData = snap.data();

    // Apply interest if not yet applied this month
    applyMonthlyInterest(user.uid);

    updateDashboardUI(user);
  });

  // 2. LISTEN TO HISTORY SUBCOLLECTION
  const historyRef = collection(db, "users", user.uid, "history_logs");
  const q = query(historyRef, orderBy("timestamp", "desc"), limit(30));

  onSnapshot(q, (snapshot) => {
    const historyData = [];
    snapshot.forEach(doc => historyData.push(doc.data()));
    loadHistory(historyData);
  });
});

// ---------- UI Update Function ----------
function updateDashboardUI(user) {
  if (!currentDashboardData) return;
  const data = currentDashboardData;

  const balance = Number(data.balance) || 0;
  userName.textContent = data.username || user.email.split("@")[0];
  userBalance.textContent = `$${balance.toLocaleString()}`;

  // Profile section
  profileUsername.textContent = data.username || user.email.split("@")[0];
  profileUid.textContent = user.uid.slice(0, 8);

  const now = new Date();
  const renewalDate = data.renewalDate ? new Date(data.renewalDate) : null;
  const expirationDate = data.expirationDate ? new Date(data.expirationDate) : null;

  profileRenewal.textContent = renewalDate ? renewalDate.toLocaleDateString() : "N/A";
  profileExpiration.textContent = expirationDate ? expirationDate.toLocaleDateString() : "N/A";

  // Real-time Status Logic
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

  // Employment Status
  const employmentStatus = data.employmentStatus || "Unemployed";
  let color = "red";
  if (employmentStatus === "Employed") color = "green";
  if (employmentStatus === "Retired") color = "blue";
  if (employmentStatusEl) {
    employmentStatusEl.textContent = employmentStatus;
    employmentStatusEl.style.color = color;
    employmentStatusEl.style.fontWeight = "bold";
  }

  // Admin Button
  if (data.isAdmin) openAdminBtn.classList.remove("hidden");
  else openAdminBtn.classList.add("hidden");

  // BPS Logic
  const bps = data.bpsBalance || 0;
  const bpsEl = document.getElementById("user-bps");
  if(bpsEl) bpsEl.textContent = `${bps} BPS`;

  // Active Discount
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

  // ---------- Retirement Savings ----------
  const savings = Number(data.retirementSavings || 0);
  retirementSavingsEl.textContent = savings.toFixed(2);

  const interest = savings * 0.03;
  retirementInterestEl.textContent = interest.toFixed(2);

  // Correct days until next 1st of month
  const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let nextInterestDate = new Date(now.getFullYear(), now.getMonth(), 1);
  if(nowMidnight >= nextInterestDate) {
    nextInterestDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  }
  const diffDays = Math.ceil((nextInterestDate - nowMidnight) / (1000*60*60*24));
  retirementDaysEl.textContent = diffDays;

  // Enable/Disable Deposit/Withdraw + Input Fields based on Employment Status
  if(employmentStatus === "Employed") {
    retirementDepositBtn.disabled = false;
    retirementWithdrawBtn.disabled = true;
    retirementDepositInput.disabled = false;
    retirementWithdrawInput.disabled = true;
  } else if(employmentStatus === "Unemployed") {
    retirementDepositBtn.disabled = true;
    retirementWithdrawBtn.disabled = true;
    retirementDepositInput.disabled = true;
    retirementWithdrawInput.disabled = true;
  } else if(employmentStatus === "Retired") {
    retirementDepositBtn.disabled = true;
    retirementWithdrawBtn.disabled = false;
    retirementDepositInput.disabled = true;
    retirementWithdrawInput.disabled = false;
  }
}

// ---------- Retirement Savings Handlers ----------
async function depositRetirement() {
  if (!auth.currentUser) return;
  const userRef = doc(db, "users", auth.currentUser.uid);
  const amount = parseFloat(retirementDepositInput.value);
  if (isNaN(amount) || amount <= 0) {
    showRetirementMessage("Enter a valid deposit amount.", "error");
    return;
  }

  const currentBalance = Number(currentDashboardData.balance || 0);
  if (amount > currentBalance) {
    showRetirementMessage("Insufficient main balance.", "error");
    return;
  }

  if(currentDashboardData.employmentStatus !== "Employed") {
    showRetirementMessage("Only Employed users can deposit.", "error");
    return;
  }

  try {
    await updateDoc(userRef, {
      balance: currentBalance - amount,
      retirementSavings: (Number(currentDashboardData.retirementSavings) || 0) + amount
    });
    showRetirementMessage(`Deposited $${amount.toFixed(2)} to retirement savings.`, "success");
    retirementDepositInput.value = "";
  } catch(err) {
    console.error(err);
    showRetirementMessage("Deposit failed: " + err.message, "error");
  }
}

async function withdrawRetirement() {
  if (!auth.currentUser) return;
  const userRef = doc(db, "users", auth.currentUser.uid);
  const amount = parseFloat(retirementWithdrawInput.value);
  if (isNaN(amount) || amount <= 0) {
    showRetirementMessage("Enter a valid withdraw amount.", "error");
    return;
  }

  const savings = Number(currentDashboardData.retirementSavings || 0);
  if(amount > savings) {
    showRetirementMessage("Insufficient retirement savings.", "error");
    return;
  }

  if(currentDashboardData.employmentStatus !== "Retired") {
    showRetirementMessage("Only Retired users can withdraw.", "error");
    return;
  }

  try {
    const balance = Number(currentDashboardData.balance || 0);
    await updateDoc(userRef, {
      balance: balance + amount,
      retirementSavings: savings - amount
    });
    showRetirementMessage(`Withdrew $${amount.toFixed(2)} to main balance.`, "success");
    retirementWithdrawInput.value = "";
  } catch(err) {
    console.error(err);
    showRetirementMessage("Withdraw failed: " + err.message, "error");
  }
}

function showRetirementMessage(msg, type) {
  if(!retirementMessageEl) return;
  retirementMessageEl.textContent = msg;
  retirementMessageEl.style.color = type === "error" ? "red" : "green";
  setTimeout(() => retirementMessageEl.textContent = "", 4000);
}

// ---------- Apply Monthly Interest ----------
async function applyMonthlyInterest(uid) {
  if(!uid) return;
  const userRef = doc(db, "users", uid);
  const data = currentDashboardData;
  if(!data) return;

  const now = new Date();
  const lastApplied = data.lastInterestApplied ? new Date(data.lastInterestApplied) : null;

  // Apply if not yet applied this month
  if(!lastApplied || lastApplied.getMonth() !== now.getMonth() || lastApplied.getFullYear() !== now.getFullYear()) {
    const savings = Number(data.retirementSavings || 0);
    if(savings > 0) {
      const interest = savings * 0.03;
      await updateDoc(userRef, {
        retirementSavings: savings + interest,
        lastInterestApplied: now.toISOString()
      });
      console.log(`Applied $${interest.toFixed(2)} interest to retirement savings.`);
    }
  }
}

// ---------- Event Listeners ----------
retirementDepositBtn?.addEventListener("click", depositRetirement);
retirementWithdrawBtn?.addEventListener("click", withdrawRetirement);

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

// ---------- Profile Renewal Request ----------
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

// ---------- Load History ----------
function loadHistory(historyArray) {
  if (!historyTable) return;
  historyTable.innerHTML = "";

  if (!historyArray || historyArray.length === 0) {
    historyTable.innerHTML = `<tr><td style="padding:15px; text-align:center; color:gray;">No history found.</td></tr>`;
    return;
  }

  const validHistory = historyArray.filter(entry => 
    entry.timestamp && !isNaN(new Date(entry.timestamp).getTime())
  );

  validHistory.forEach(entry => {
    const row = document.createElement("tr");
    
    let icon = "📄";
    let bg = "#f8f9fa";
    let border = "#ddd";

    switch(entry.type) {
        case "transfer-in":  icon = "💸"; bg = "#e8f8f5"; border = "#2ecc71"; break;
        case "transfer-out": icon = "📤"; bg = "#fdedec"; border = "#e74c3c"; break;
        case "purchase":     icon = "🛒"; bg = "#fef9e7"; border = "#f1c40f"; break;
        case "usage":        icon = "🧪"; bg = "#f4f6f7"; border = "#95a5a6"; break;
        case "admin":        icon = "🛡️"; bg = "#eaf2f8"; border = "#3498db"; break;
        case "contract":     icon = "📝"; bg = "#fdf2e9"; border = "#e67e22"; break;
    }

    const timeString = getRelativeTime(new Date(entry.timestamp));

    row.innerHTML = `
      <td style="padding: 12px; border-bottom: 1px solid #eee;">
        <div style="display: flex; align-items: center; gap: 15px;">
            <div style="
                font-size: 1.5em; 
                background: ${bg}; 
                border: 2px solid ${border}; 
                width: 40px; height: 40px; 
                border-radius: 50%; 
                display: flex; align-items: center; justify-content: center;
            ">${icon}</div>
            
            <div style="display: flex; flex-direction: column;">
                <span style="font-weight: 600; color: #333;">${entry.message}</span>
                <span style="font-size: 0.8em; color: gray;">${timeString}</span>
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

// ---------- Heartbeat Timer ----------
setInterval(() => {
  if (auth.currentUser && currentDashboardData) {
    updateDashboardUI(auth.currentUser);
  }
}, 5000);
