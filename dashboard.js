// ---------- dashboard.js ----------
console.log("dashboard.js loaded");

import { auth, db } from "./firebaseConfig.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { doc, onSnapshot, updateDoc, collection, query, orderBy, limit, getDoc, increment } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { logHistory } from "./historyManager.js";
import { renderSavings } from "./retirement.js"; 
import { applyInterest, takeOutLoan, repayLoan, getCreditStatus } from "./loan.js"; 

// --- NEW CONTRACT IMPORTS ---
import { listenForContractOffers, listenForAdminRoster, renderUserContract } from "./contracts.js";

// --- SHOP & COSMETICS IMPORTS FOR QUOTA SAVING ---
import { renderShop } from "./shop.js";
import { renderBpsShop } from "./bpsShop.js";
import { loadCosmetics } from "./cosmetics.js"; 

// --- MEMBERSHIP IMPORTS ---
import { PLANS, checkMembershipBilling, getTierBadge, getNextBillingDate, purchaseMembership, cancelMembership } from "./membership_plans.js";

// --- BPS CONVERTER IMPORT ---
import { renderBpsConverter } from "./bpsConverter.js";

// --- ECONOMIC STATS IMPORT ---
import { renderStatsTeaser } from "./estats.js";

// Shared utility for Option A math synchronization
import { getLiveMarketRate } from "./economyUtils.js";

// Economy logger to archive daily snapshots for real charts
import { logDailyEconomySnapshot } from "./economyLogger.js";

// --- LOTTERY IMPORTS ---
import { initLotteryUI } from "./lottery.js";
import { listenForAdminLottery } from "./admin.js";

// --- FINE SYSTEM IMPORT ---
import { initFineSystem } from "./fines.js";

// --- INSURANCE SYSTEM IMPORT ---
import { initInsurance } from "./insurance.js";

// --- NEW BPS SECURITY IMPORTS ---
import { openPinModal } from "./securityModal.js";
import { changeBpsPin, checkRewardsBilling } from "./bpsManager.js";

/* =========================================================
    QUOTA PROTECTION: LISTENER MANAGER
========================================================= */
let unsubUser = null;
let unsubHistory = null;
let listenersInitialized = false; 

/* =========================================================
    CONNECTION STATUS UI ELEMENTS
========================================================= */
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");

/* =========================================================
    INSTANT THEME APPLY
========================================================= */
const savedTheme = localStorage.getItem("theme");
if (savedTheme === "dark") document.body.classList.add("dark-mode");
if (savedTheme === "light") document.body.classList.add("light-mode");

// ---------- UI Elements ----------
const dashboard = document.getElementById("dashboard");
const dashboardContent = document.getElementById("dashboard-content"); 
const adminPanel = document.getElementById("tab-admin"); 
const userName = document.getElementById("user-name");
const userBalance = document.getElementById("user-balance");
const logoutBtn = document.getElementById("logout-btn");
const openAdminBtn = document.getElementById("open-admin");
const themeToggleBtn = document.getElementById("theme-toggle-btn");

const profileUsername = document.getElementById("profile-username");
const profileUid = document.getElementById("profile-uid");
const profileRenewal = document.getElementById("profile-renewal");
const profileExpiration = document.getElementById("profile-expiration");
const renewalStatus = document.getElementById("renewal-status");
const renewBtn = document.getElementById("renew-btn");

const employmentStatusEl = document.getElementById("employment-status");

const displayCreditScore = document.getElementById("display-credit-score");
const loanAmountSelect = document.getElementById("loan-amount-select");
const takeLoanBtn = document.getElementById("take-loan-btn");
const repayLoanBtn = document.getElementById("repay-loan-btn");
const activeLoanSection = document.getElementById("active-loan-info");
const debtAmountEl = document.getElementById("debt-amount");
const dailyInterestEl = document.getElementById("daily-interest");
const timerEl = document.getElementById("interest-timer");

const unifiedHistoryList = document.getElementById("unified-history-list");
const dateFilterInput = document.getElementById("history-date-filter");
const endDateFilterInput = document.getElementById("history-end-date-filter");
const searchFilterInput = document.getElementById("history-search-filter");
const clearFiltersBtn = document.getElementById("clear-history-filters");
const historyCountBadge = document.getElementById("history-count-badge");

// NEW UI ELEMENTS FOR MOBILE & TABS
const mobileBtn = document.getElementById('mobile-menu-btn');
const sidebar = document.querySelector('.sidebar');
const sidebarOverlay = document.getElementById('sidebar-overlay');

// --- BPS SECURITY ELEMENTS ---
const securityLockIcon = document.getElementById("security-lock-icon");
const walletSecurityStatus = document.getElementById("wallet-security-status");

let currentDashboardData = null;
let interestTimerInterval = null; 
let cachedHistory = []; 

/* =========================================================
    SYSTEM UPDATE: TAB NAVIGATION & MOBILE/DESKTOP TOGGLE
========================================================= */
function initTabSystem() {
    const navItems = document.querySelectorAll('.nav-item');
    const tabs = document.querySelectorAll('.tab-content');

    const toggleSidebar = (e) => {
        if (e) e.stopPropagation();
        const activeSidebar = document.querySelector('.sidebar');
        
        if (activeSidebar) {
            if (window.innerWidth <= 900) {
                activeSidebar.classList.toggle('mobile-open');
            } else {
                activeSidebar.classList.toggle('sidebar-hidden');
                document.body.classList.toggle('sidebar-collapsed-active');
            }
        }
    };

    const activeMobileBtn = document.getElementById('mobile-menu-btn');
    const activeOverlay = document.getElementById('sidebar-overlay');

    activeMobileBtn?.removeEventListener('click', toggleSidebar);
    activeOverlay?.removeEventListener('click', toggleSidebar);

    activeMobileBtn?.addEventListener('click', toggleSidebar);
    activeOverlay?.addEventListener('click', toggleSidebar);

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetTab = item.getAttribute('data-tab');
            if (!targetTab) return;

            navItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');

            tabs.forEach(tab => tab.classList.remove('active'));
            const targetEl = document.getElementById(targetTab);
            if (targetEl) targetEl.classList.add('active');

            localStorage.setItem('activeDashboardTab', targetTab);

            const activeSidebar = document.querySelector('.sidebar');
            if (window.innerWidth <= 900 && activeSidebar) {
                activeSidebar.classList.remove('mobile-open');
            }
        });
    });

    const savedTab = localStorage.getItem('activeDashboardTab') || 'tab-overview';
    const tabToClick = document.querySelector(`[data-tab="${savedTab}"]`);
    if (tabToClick) tabToClick.click();
}

/* =========================================================
    HELPER: GET EST DATE (YYYY-MM-DD)
========================================================= */
function getESTDate(offsetDays = 0) {
    const now = new Date();
    const estOffset = now.getTime() + (now.getTimezoneOffset() * 60000) - (5 * 3600000);
    const estDate = new Date(estOffset);
    estDate.setDate(estDate.getDate() + offsetDays);
    return estDate.toISOString().split('T')[0];
}

function applyTheme(theme) {
  if (theme === "light") {
    document.body.classList.add("light-mode");
    document.body.classList.remove("dark-mode");
    if (themeToggleBtn) themeToggleBtn.textContent = "🌙";
  } else {
    document.body.classList.add("dark-mode");
   document.body.classList.remove("light-mode");
    if (themeToggleBtn) themeToggleBtn.textContent = "☀️";
  }
  localStorage.setItem("theme", theme);
}

/**
 * REFACTORED AUTH STATE LOGIC
 */
onAuthStateChanged(auth, async (user) => {
  if (unsubUser) { unsubUser(); unsubUser = null; }
  if (unsubHistory) { unsubHistory(); unsubHistory = null; }

  if (!user) {
    if(dashboard) dashboard.classList.add("hidden");
    currentDashboardData = null;
    listenersInitialized = false; 
    
    if (statusDot) {
        statusDot.style.backgroundColor = "#bbb";
        statusDot.classList.remove("status-online");
        statusDot.style.boxShadow = "none";
    }
    if (statusText) {
        statusText.textContent = "OFFLINE";
        statusText.style.color = "#888";
    }
    return;
  }

  if(dashboard) dashboard.classList.remove("hidden");

  logDailyEconomySnapshot();

  initTabSystem(); 

  if (!listenersInitialized) {
      listenForContractOffers(user.uid);
      listenForAdminRoster(); 
      initLotteryUI(); 
      initFineSystem(); 
      listenersInitialized = true;
  }

  const userRef = doc(db, "users", user.uid);
  let themeAppliedOnce = false; 
  let billingCheckedOnce = false;

  unsubUser = onSnapshot(userRef, async snap => { 
    if (statusDot) {
        statusDot.style.backgroundColor = "#2ecc71"; 
        statusDot.classList.add("status-online");   
        statusDot.style.boxShadow = "0 0 8px rgba(46, 204, 113, 0.6)";
    }
    if (statusText) {
        statusText.textContent = "LIVE";
        statusText.style.color = "#2ecc71";
    }

    if (!snap.exists()) return;
    currentDashboardData = snap.data();

    if (!billingCheckedOnce) {
        await checkMembershipBilling(user.uid, currentDashboardData);
        await checkRewardsBilling(user.uid, currentDashboardData);
        billingCheckedOnce = true;
    }

    await applyInterest(user.uid, currentDashboardData);

    if (!themeAppliedOnce) {
        const theme = currentDashboardData.cosmeticsOwned?.darkMode
            ? (currentDashboardData.theme || localStorage.getItem("theme") || "dark")
            : "light"; 
        applyTheme(theme);
        themeAppliedOnce = true; 
    }

    const { rate: liveRate } = await getLiveMarketRate();
    updateDashboardUI(user, liveRate);

    if (typeof renderShop === "function") renderShop(currentDashboardData);
    if (typeof renderBpsShop === "function") renderBpsShop(currentDashboardData);
    if (typeof loadCosmetics === "function") loadCosmetics(currentDashboardData);
    if (typeof renderSavings === "function") renderSavings(currentDashboardData); 
    if (typeof renderBpsConverter === "function") renderBpsConverter(currentDashboardData);
    if (typeof renderStatsTeaser === "function") renderStatsTeaser(currentDashboardData);
    if (typeof renderUserContract === "function") renderUserContract(user.uid, currentDashboardData);
    if (typeof initInsurance === "function") initInsurance(currentDashboardData);

  }, (error) => {
    if (statusDot) {
        statusDot.style.backgroundColor = "#e74c3c"; 
        statusDot.classList.remove("status-online");
        statusDot.style.boxShadow = "none";
    }
    if (statusText) {
        statusText.textContent = "ERR";
        statusText.style.color = "#e74c3c";
    }
    console.error("Firestore error:", error);
  });

  const historyRef = collection(db, "users", user.uid, "history_logs");
  const q = query(historyRef, orderBy("timestamp", "desc"), limit(200)); 

  unsubHistory = onSnapshot(q, (snapshot) => {
    cachedHistory = [];
    snapshot.forEach(doc => cachedHistory.push(doc.data()));
    if (dateFilterInput && !dateFilterInput.value) {
        dateFilterInput.value = getESTDate(-1);
        endDateFilterInput.value = getESTDate(0);
    }
    renderUnifiedHistory();
  });
});

/* =========================================================
    UNIFIED HISTORY RENDERING
========================================================= */
function renderUnifiedHistory() {
    if (!unifiedHistoryList) return;
    
    const searchTerm = searchFilterInput.value.toLowerCase();
    const startVal = dateFilterInput.value; 
    const endVal = endDateFilterInput.value; 
    
    unifiedHistoryList.innerHTML = "";

    const filterStartTime = startVal ? new Date(startVal + "T00:00:00").getTime() : 0;
    const filterEndTime = endVal ? new Date(endVal + "T23:59:59").getTime() : Infinity;

    const filtered = cachedHistory.filter(entry => {
      const entryDate = new Date(entry.timestamp);
      const entryMsg = entry.message.toLowerCase();
      const matchesSearch = entryMsg.includes(searchTerm);
      const logTime = entryDate.getTime();
      return matchesSearch && logTime >= filterStartTime && logTime <= filterEndTime;
    });

    if (historyCountBadge) {
        historyCountBadge.textContent = `${filtered.length} found`;
    }

    if (filtered.length === 0) {
        unifiedHistoryList.innerHTML = `<div style="color: gray; padding: 20px; text-align: center; font-style: italic;">No logs found.</div>`;
        return;
    }

    filtered.forEach(entry => {
        let icon = getHistoryIcon(entry.type);
        const timeStr = getRelativeTime(new Date(entry.timestamp));
        
        let accentColor = "#444"; 
        if (entry.type === "transfer-in" || entry.message.includes("Paid") || entry.message.includes("Received") || entry.message.includes("Approved")) {
            accentColor = "#2ecc71"; 
        } else if (entry.type === "transfer-out" || entry.message.includes("Rejected") || entry.message.includes("Denied") || entry.message.includes("Sent") || entry.message.includes("CUT") || entry.message.includes("Repaid")) {
            accentColor = "#e74c3c"; 
        } else if (entry.type === "membership") {
            accentColor = "#f1c40f";
    }

         unifiedHistoryList.innerHTML += `
    <div class="history-entry-row" style="display: flex; align-items: center; padding: 16px 12px; border-bottom: 1px solid var(--border-color); gap: 20px; width: 100%; box-sizing: border-box; overflow: hidden;">
        <div class="history-icon-wrapper" style="flex-shrink: 0; width: 48px; height: 48px; background: var(--input-bg); border: 2.5px solid ${accentColor}; display: flex; align-items: center; justify-content: center; border-radius: 50%; font-size: 1.2rem; box-shadow: 0 4px 8px rgba(0,0,0,0.15);">
            ${icon}
        </div>
        
        <div style="flex-grow: 1; min-width: 0; overflow: hidden;">
            <div class="history-message" style="color: var(--text-color); font-weight: 600; font-size: 1.05rem; margin-bottom: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${entry.message}
            </div>
            <div class="history-time" style="font-size: 0.85rem; color: var(--text-muted);">${timeStr}</div>
        </div>

        <div class="history-tag-wrapper" style="flex-shrink: 0; margin-left: auto;">
            <span class="history-type-pill" style="font-size: 0.65rem; color: var(--text-muted); background: var(--input-bg); padding: 4px 12px; border-radius: 6px; text-transform: uppercase; font-weight: 800; letter-spacing: 1px; border: 1px solid var(--border-color); white-space: nowrap;">
                ${entry.type}
            </span>
        </div>
    </div>`;
    });
}

function getHistoryIcon(type) {
    switch(type) {
      case "transfer-in":   return "💸";
      case "transfer-out": return "📤";
      case "purchase":     return "🛒";
      case "usage":        return "🧪";
      case "admin":        return "🛡️";
      case "contract":     return "📝";
     case "membership":   return "💎"; 
      default:             return "📄";
    }
}

function getRelativeTime(date) {
  const now = new Date();
  const diff = Math.floor((now - date) / 1000);
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return date.toLocaleDateString(); 
}

function updateDashboardUI(user, dynamicRate) {
  if (!currentDashboardData) return;
  const data = currentDashboardData;

  const balance = Number(data.balance) || 0;
  
  let bpsBalance = 0;
  if (data.bpsBalance !== undefined && data.bpsBalance !== null) {
      if (typeof data.bpsBalance === 'object') {
          bpsBalance = Number(data.bpsBalance.value || data.bpsBalance.amount || 0);
      } else {
          bpsBalance = Number(data.bpsBalance);
      }
  }

  const savings = Number(data.retirementSavings) || 0;
  const vIndex = Number(data.volatilityIndex) || 34000000;

  if(userName) userName.textContent = data.username || user.email.split("@")[0];
  if(userBalance) userBalance.textContent = `$${balance.toLocaleString()}`; 

  const volDisplay = document.getElementById("volatility-display");
  if (volDisplay) {
    if (vIndex > 45000000) {
        volDisplay.style.color = "#e74c3c"; 
        volDisplay.textContent = "HEAVY RESISTANCE"; 
    } else if (vIndex < 25000000) {
        volDisplay.style.color = "#2ecc71"; 
        volDisplay.textContent = "OPEN MARKET"; 
    } else {
        volDisplay.style.color = "#3498db"; 
        volDisplay.textContent = "STABLE MARKET"; 
    }
  }

  const rateDisplay = document.getElementById("dynamic-bps-rate");
  if (rateDisplay) rateDisplay.textContent = `$${dynamicRate.toLocaleString()}`;

  if(profileUsername) profileUsername.textContent = data.username || user.email.split("@")[0];
  if(profileUid) profileUid.textContent = user.uid.slice(0, 8);

  if (data.equippedBackground) {
    document.body.style.setProperty('background-color', data.equippedBackground, 'important');
  } else {
    document.body.style.backgroundColor = ""; 
  }

  // --- BPS WALLET STATUS LOGIC (Sidebar Badge & Actions) ---
  if (walletSecurityStatus) {
      if (data.isLoyaltyRegistered) {
          if (securityLockIcon) securityLockIcon.innerText = "🔒";
          walletSecurityStatus.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items: flex-start; gap:4px;">
              <div style="display:flex; align-items:center; gap:6px; color:#2ecc71; font-weight:700; font-size:0.85rem; letter-spacing: 0.5px;">
                  <span style="font-size: 0.9rem;">🔒</span> WALLET SECURED
              </div>
              <button id="change-pin-sidebar-btn" style="
                  background: rgba(52, 152, 219, 0.1); 
                  border: 1px solid rgba(52, 152, 219, 0.3); 
                  color: #3498db; 
                  cursor: pointer; 
                  font-size: 0.65rem; 
                  font-weight: 800;
                  text-transform: uppercase;
                  padding: 3px 8px; 
                  border-radius: 4px;
                  transition: 0.2s;
              ">
                  Change PIN
              </button>
            </div>`;
          walletSecurityStatus.style.background = "rgba(46, 204, 113, 0.1)";
          walletSecurityStatus.style.border = "1px solid rgba(46, 204, 113, 0.2)";

          const changeBtn = document.getElementById("change-pin-sidebar-btn");
          if (changeBtn) {
              changeBtn.onclick = async () => {
                // STEP 1: Verify Current PIN
                openPinModal('verify', async (oldPin) => {
                    if (!oldPin) return;

                    // STEP 2: Ask for New PIN
                    setTimeout(() => {
                        openPinModal('register', (newPin) => {
                            if (!newPin) return;

                            // STEP 3: Confirm New PIN
                            setTimeout(() => {
                                openPinModal('register', async (confirmPin) => {
                                    if (!confirmPin) return;

                                    const res = await changeBpsPin(oldPin, newPin, confirmPin);
                                    alert(res.message);
                                }, "Re-enter for verification");
                            }, 400); 
                        }, "Enter New PIN");
                    }, 400);
                }, "Verify Current PIN");
              };
          }
      } else {
          if (securityLockIcon) securityLockIcon.innerText = "🔓";
          walletSecurityStatus.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:5px;">
                <span>🔓 Wallet Unsecured</span>
                <button id="register-wallet-sidebar-btn" style="background:#8e44ad; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:0.7rem; font-weight:bold; text-transform:uppercase;">
                    Register Wallet
                </button>
            </div>`;
          walletSecurityStatus.style.background = "rgba(0,0,0,0.2)";
          walletSecurityStatus.style.border = "1px solid rgba(255,255,255,0.05)";

          const regBtn = document.getElementById("register-wallet-sidebar-btn");
          if (regBtn) {
              regBtn.onclick = () => {
                  openPinModal('register', () => alert("Wallet Secured!"));
              };
          }
      }
  }

  const tier = data.membershipLevel || 'standard';
  const profileBadge = document.getElementById("profile-membership-badge");
  const cancelBtn = document.getElementById("cancel-plan-btn");
  const billingInfoEl = document.getElementById("membership-billing-info");

  if (profileBadge) profileBadge.innerHTML = getTierBadge(tier);
  if (cancelBtn) cancelBtn.classList.toggle("hidden", tier === 'standard');

  const onTrial = !!data.trialExpiration;
  document.querySelectorAll(".join-plan-btn").forEach(btn => {
      const btnPlan = btn.dataset.plan;
      if (onTrial) {
          btn.disabled = true;
          btn.textContent = "Trial Active 🔒";
          btn.style.opacity = "0.6";
      } else if (tier === btnPlan) {
          btn.disabled = true;
          btn.textContent = "Current ✅";
          btn.style.backgroundColor = "#27ae60";
      } else {
          btn.disabled = false;
          btn.textContent = `Join ${PLANS[btnPlan].label}`;
          btn.style.backgroundColor = ""; 
          btn.style.opacity = "1";
      }
  });

  if (billingInfoEl) {
      if (tier !== 'standard' || onTrial) {
          const nextDate = getNextBillingDate(data);
          billingInfoEl.innerHTML = `Next Cycle: <strong>${nextDate}</strong>`;
          billingInfoEl.classList.remove("hidden");
      } else {
          billingInfoEl.classList.add("hidden");
      }
  }

  const score = data.creditScore || 600;
  const status = getCreditStatus(score);
  if (displayCreditScore) {
      displayCreditScore.innerHTML = `${score} <span style="color: ${status.color}; font-weight: bold; margin-left: 5px;">(${status.label})</span>`;
  }

  const activeDebt = data.activeLoan || 0;
  if (activeDebt > 0) {
      activeLoanSection?.classList.remove("hidden");
      if (debtAmountEl) debtAmountEl.textContent = `$${activeDebt.toLocaleString()}`;
      
      if (dailyInterestEl) {
          const liveInterest = activeDebt * 0.05;
          dailyInterestEl.textContent = `$${liveInterest.toLocaleString()}`;
      }

      if (data.lastInterestApplied) {
          if (interestTimerInterval) clearInterval(interestTimerInterval);
          interestTimerInterval = setInterval(() => {
              const now = new Date();
              const timeLeft = new Date(data.lastInterestApplied).getTime() + (24*60*60*1000) - now.getTime();
              if (timeLeft <= 0) {
                  if (timerEl) timerEl.textContent = "Processing...";
                  clearInterval(interestTimerInterval);
              } else {
                  const hours = Math.floor((timeLeft / 3600000) % 24);
                  const mins = Math.floor((timeLeft / 60000) % 60);
                  const secs = Math.floor((timeLeft / 1000) % 60);
                  if (timerEl) timerEl.textContent = `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
              }
          }, 1000);
      }
  } else {
      activeLoanSection?.classList.add("hidden");
      if (interestTimerInterval) clearInterval(interestTimerInterval);
  }

  if (data.isAdmin) {
      openAdminBtn?.classList.remove("hidden");
      listenForAdminLottery(); 
  } else {
      openAdminBtn?.classList.add("hidden");
  }

  if(document.getElementById("user-bps")) {
      document.getElementById("user-bps").textContent = bpsBalance.toLocaleString();
  }

  const expirationDate = data.expirationDate ? new Date(data.expirationDate) : null;
  if(profileRenewal) profileRenewal.textContent = data.renewalDate ? new Date(data.renewalDate).toLocaleDateString() : "N/A";
  if(profileExpiration) profileExpiration.textContent = expirationDate ? expirationDate.toLocaleDateString() : "N/A";

  if (renewalStatus) {
    if (data.renewalPending) {
        renewalStatus.textContent = "Pending Approval";
        renewalStatus.style.color = "orange";
    } else if (expirationDate && expirationDate < new Date()) {
        renewalStatus.textContent = "Expired";
        renewalStatus.style.color = "red";
    } else {
        renewalStatus.textContent = "Active";
        renewalStatus.style.color = "green";
    }
  }

  const employmentStatus = data.employmentStatus || "Unemployed";
  if (employmentStatusEl) {
    employmentStatusEl.textContent = employmentStatus;
    employmentStatusEl.style.color = employmentStatus === "Employed" ? "green" : "red";
  }
}

/* =========================================================
    MEMBERSHIP HANDLERS
========================================================= */
window.joinPlan = async (planKey) => {
    if (!auth.currentUser || !currentDashboardData) return;
    const plan = PLANS[planKey];
    const userRef = doc(db, "users", auth.currentUser.uid);
    const oldTier = currentDashboardData.membershipLevel || 'standard';

    if (currentDashboardData.trialExpiration) return alert("End trial first.");
    if (!confirm(`Join ${plan.label}?`)) return;
    if (currentDashboardData.balance < plan.price) return alert("Insufficient funds!");

    try {
        await updateDoc(userRef, {
            membershipLevel: planKey,
            balance: increment(-plan.price),
            membershipLastPaid: new Date().toISOString(),
            shopOrderCount: 0
        });
        await logHistory(auth.currentUser.uid, `Subscribed to ${plan.label}`, "membership");
        if (typeof purchaseMembership === "function") await purchaseMembership(auth.currentUser.uid, planKey, currentDashboardData, oldTier);
        alert(`Plan active!`);
    } catch (err) { alert("Error joining plan."); }
};

const cancelPlanBtn = document.getElementById("cancel-plan-btn");
cancelPlanBtn?.addEventListener("click", async () => {
    if (!auth.currentUser || !currentDashboardData) return;
    const tierToCancel = currentDashboardData.membershipLevel || 'standard';
    if (!confirm("Cancel membership?")) return;
    try {
        await updateDoc(doc(db, "users", auth.currentUser.uid), { membershipLevel: "standard", shopOrderCount: 0 });
        await logHistory(auth.currentUser.uid, "Cancelled Subscription", "membership");
        if (typeof cancelMembership === "function") await cancelMembership(auth.currentUser.uid, currentDashboardData, tierToCancel);
        alert("Cancelled.");
    } catch (err) { alert("Error cancelling."); }
});

/* =========================================================
    EVENT LISTENERS
========================================================= */
dateFilterInput?.addEventListener("change", renderUnifiedHistory);
endDateFilterInput?.addEventListener("change", renderUnifiedHistory);
searchFilterInput?.addEventListener("input", renderUnifiedHistory);

clearFiltersBtn?.addEventListener("click", () => {
    dateFilterInput.value = getESTDate(-1);
    endDateFilterInput.value = getESTDate(0);
    searchFilterInput.value = "";
    renderUnifiedHistory();
});

themeToggleBtn?.addEventListener("click", async () => {
  if(!auth.currentUser) return;
  if(!currentDashboardData?.cosmeticsOwned?.darkMode) return alert("Buy Dark Mode first.");
  const isLight = document.body.classList.contains("light-mode");
  const newTheme = isLight ? "dark" : "light";
  applyTheme(newTheme);
  await updateDoc(doc(db, "users", auth.currentUser.uid), { theme: newTheme });
});

takeLoanBtn?.addEventListener("click", () => takeOutLoan(parseInt(loanAmountSelect.value)));
repayLoanBtn?.addEventListener("click", () => repayLoan());

logoutBtn?.addEventListener("click", async () => { 
    if (unsubUser) unsubUser(); 
    if (unsubHistory) unsubHistory(); 
    await signOut(auth); 
});

renewBtn?.addEventListener("click", async () => {
  if (!auth.currentUser) return;
  try {
    await updateDoc(doc(db, "users", auth.currentUser.uid), { renewalPending: true, renewalRequestDate: new Date().toISOString() });
    alert("Renewal requested.");
  } catch (err) { alert("Error: " + err.message); }
});

document.addEventListener('click', async (e) => {
    if (!auth.currentUser) return;

    if (e.target.classList.contains('join-plan-btn')) {
      const planKey = e.target.dataset.plan;
      await window.joinPlan(planKey);
    }
});