// ---------- dashboard.js ----------
console.log("dashboard.js loaded");

import { auth, db } from "./firebaseConfig.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { doc, onSnapshot, updateDoc, collection, query, orderBy, limit, getDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { logHistory } from "./historyManager.js";
import { currentUserData, renderSavings } from "./retirement.js";
import { applyInterest, takeOutLoan, repayLoan, getCreditStatus } from "./loan.js"; 

/* =========================================================
    INSTANT THEME APPLY (prevents light flash on refresh)
========================================================= */
const savedTheme = localStorage.getItem("theme");
if (savedTheme === "dark") document.body.classList.add("dark-mode");
if (savedTheme === "light") document.body.classList.add("light-mode");

// ---------- UI Elements ----------
const dashboard = document.getElementById("dashboard");
const dashboardContent = document.getElementById("dashboard-content"); 
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

// Loan UI Elements
const displayCreditScore = document.getElementById("display-credit-score");
const loanAmountSelect = document.getElementById("loan-amount-select");
const takeLoanBtn = document.getElementById("take-loan-btn");
const repayLoanBtn = document.getElementById("repay-loan-btn");
const activeLoanSection = document.getElementById("active-loan-info");
const debtAmountEl = document.getElementById("debt-amount");
const dailyInterestEl = document.getElementById("daily-interest");
const timerEl = document.getElementById("interest-timer");

// --- UNIFIED HISTORY UI ELEMENTS ---
const unifiedHistoryList = document.getElementById("unified-history-list");
const dateFilterInput = document.getElementById("history-date-filter");
const endDateFilterInput = document.getElementById("history-end-date-filter");
const searchFilterInput = document.getElementById("history-search-filter");
const clearFiltersBtn = document.getElementById("clear-history-filters");
const historyCountBadge = document.getElementById("history-count-badge");

let currentDashboardData = null;
let interestTimerInterval = null; 
let cachedHistory = []; // Local cache for filtering without re-fetching

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
  let themeAppliedOnce = false; 

  onSnapshot(userRef, async snap => { 
    if (!snap.exists()) return;
    currentDashboardData = snap.data();

    await applyInterest(user.uid, currentDashboardData);

    if (!themeAppliedOnce) {
        const theme = currentDashboardData.cosmeticsOwned?.darkMode
            ? (currentDashboardData.theme || localStorage.getItem("theme") || "dark")
            : "light"; 
        applyTheme(theme);
        themeAppliedOnce = true; 
    }

    updateDashboardUI(user);
  });

  // --- UPDATED HISTORY SNAPSHOT (Unified View) ---
  const historyRef = collection(db, "users", user.uid, "history_logs");
  const q = query(historyRef, orderBy("timestamp", "desc"));

  onSnapshot(q, (snapshot) => {
    cachedHistory = [];
    snapshot.forEach(doc => cachedHistory.push(doc.data()));
    
    // Set default range: Yesterday to Today if not already set
    if (dateFilterInput && !dateFilterInput.value) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        dateFilterInput.value = yesterday.toISOString().split('T')[0];
        
        const today = new Date();
        endDateFilterInput.value = today.toISOString().split('T')[0];
    }

    renderUnifiedHistory();
  });
});

/* =========================================================
    UNIFIED HISTORY RENDERING (UPDATED VISUALS)
========================================================= */
function renderUnifiedHistory() {
    if (!unifiedHistoryList) return;
    
    const searchTerm = searchFilterInput.value.toLowerCase();
    const startVal = dateFilterInput.value;
    const endVal = endDateFilterInput.value;
    
    unifiedHistoryList.innerHTML = "";

    // 1. Filter the cached array based on Date Range and Search Term
    const filtered = cachedHistory.filter(entry => {
      const entryDate = new Date(entry.timestamp);
      const entryMsg = entry.message.toLowerCase();
      
      const matchesSearch = entryMsg.includes(searchTerm);
      
      // Clean time comparison (Normalization to local midnight)
      const logTime = new Date(entryDate.getFullYear(), entryDate.getMonth(), entryDate.getDate()).getTime();
      
      // Use "T00:00:00" to force local time interpretation from the picker
      const startTime = startVal ? new Date(startVal + "T00:00:00").getTime() : 0;
      const endTime = endVal ? new Date(endVal + "T23:59:59").getTime() : Infinity;

      const matchesDate = logTime >= startTime && logTime <= endTime;
      
      return matchesSearch && matchesDate;
    });

    // 2. Update the found count badge
    if (historyCountBadge) {
        historyCountBadge.textContent = `${filtered.length} found`;
    }

    // 3. Render the items
    if (filtered.length === 0) {
        unifiedHistoryList.innerHTML = `<div style="color: gray; padding: 20px; text-align: center;">No matching activity found.</div>`;
        return;
    }

        filtered.forEach(entry => {
        let icon = getHistoryIcon(entry.type);
        const timeStr = getRelativeTime(new Date(entry.timestamp));
        
        let amountColor = "inherit";
        if (entry.message.includes("Repaid") || entry.message.includes("Sent")) amountColor = "#e74c3c"; 
        if (entry.message.includes("Took") || entry.message.includes("Received")) amountColor = "#2ecc71"; 

        // NOTICE THE data-type="${entry.type}" ADDED BELOW
        unifiedHistoryList.innerHTML += `
            <div class="history-entry" data-type="${entry.type}">
                <div class="history-icon-circle">${icon}</div>
                <div class="history-details">
                    <div class="history-message" style="color: ${amountColor};">${entry.message}</div>
                    <div class="history-time">${timeStr}</div>
                </div>
                <div class="history-type-tag">${entry.type}</div>
            </div>
        `;
    });
}

function getHistoryIcon(type) {
    switch(type) {
      case "transfer-in":  return "💸";
      case "transfer-out": return "📤";
      case "purchase":     return "🛒";
      case "usage":        return "🧪";
      case "admin":        return "🛡️";
      case "contract":     return "📝";
      default:             return "📄";
    }
}

function getRelativeTime(date) {
  const now = new Date();
  const diff = Math.floor((now - date) / 1000);
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} mins ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  return date.toLocaleDateString(); 
}

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

  const score = data.creditScore || 600;
  const status = getCreditStatus(score);
  
  if (displayCreditScore) {
      displayCreditScore.innerHTML = `
          ${score} <span style="color: ${status.color}; font-weight: bold; margin-left: 5px;">
              (${status.label})
          </span>
      `;
  }
  
  const activeDebt = data.activeLoan || 0;
  if (activeDebt > 0) {
      activeLoanSection?.classList.remove("hidden");
      if (debtAmountEl) debtAmountEl.textContent = `$${activeDebt.toLocaleString()}`;

      if (dailyInterestEl) {
        const dailyAmt = activeDebt * 0.05;
        dailyInterestEl.textContent = `$${dailyAmt.toLocaleString()}`;
      }

      if (data.lastInterestApplied) {
          if (interestTimerInterval) clearInterval(interestTimerInterval);
          interestTimerInterval = setInterval(() => {
              const now = new Date();
              const lastApplied = new Date(data.lastInterestApplied);
              const nextCharge = new Date(lastApplied.getTime() + (24 * 60 * 60 * 1000));
              const timeLeft = nextCharge - now;

              if (timeLeft <= 0) {
                  if (timerEl) timerEl.textContent = "Next charge in: 00:00:00";
                  clearInterval(interestTimerInterval);
              } else {
                  const hours = Math.floor((timeLeft / (1000 * 60 * 60)) % 24);
                  const mins = Math.floor((timeLeft / (1000 * 60)) % 60);
                  const secs = Math.floor((timeLeft / 1000) % 60);
                  if (timerEl) {
                      timerEl.textContent = `Next charge in: ${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
                  }
              }
          }, 1000);
      }
  } else {
      activeLoanSection?.classList.add("hidden");
      if (interestTimerInterval) clearInterval(interestTimerInterval);
  }

  if (data.isEconomyPaused) {
      dashboardContent?.classList.add("paused-economy");
  } else {
      dashboardContent?.classList.remove("paused-economy");
  }

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

/* =========================================================
    EVENT LISTENERS
========================================================= */

// --- History Filtering Listeners ---
dateFilterInput?.addEventListener("change", renderUnifiedHistory);
endDateFilterInput?.addEventListener("change", renderUnifiedHistory);
searchFilterInput?.addEventListener("input", renderUnifiedHistory);

clearFiltersBtn?.addEventListener("click", () => {
    // Reset to "1 Day Ago" defaults
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    dateFilterInput.value = yesterday.toISOString().split('T')[0];
    
    const today = new Date();
    endDateFilterInput.value = today.toISOString().split('T')[0];

    searchFilterInput.value = "";
    renderUnifiedHistory();
});

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

takeLoanBtn?.addEventListener("click", () => {
    const amount = parseInt(loanAmountSelect.value);
    takeOutLoan(amount);
});

repayLoanBtn?.addEventListener("click", () => {
    repayLoan();
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

loanAmountSelect?.addEventListener("change", () => {
    const amount = parseInt(loanAmountSelect.value);
    const msgEl = document.getElementById("loan-message");
    if (amount === 50000) {
        msgEl.textContent = "ℹ️ Requirement: Risky Status (0-499)";
        msgEl.style.color = "#e74c3c";
    } else if (amount === 100000) {
        msgEl.textContent = "ℹ️ Requirement: Fair Status (500-649)";
        msgEl.style.color = "#3498db";
    } else if (amount === 500000) {
        msgEl.textContent = "ℹ️ Requirement: Good Status (650-749)";
        msgEl.style.color = "#2ecc71";
    } else if (amount === 1000000) {
        msgEl.textContent = "✨ Requirement: Elite Status (750-850)";
        msgEl.style.color = "#f1c40f";
    }
});

setInterval(() => {
  if (auth.currentUser && currentDashboardData) {
    updateDashboardUI(auth.currentUser);
  }
}, 5000);