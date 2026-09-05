// ---------- dashboard.js ----------
console.log("dashboard.js loaded");

import { auth, db } from "./firebaseConfig.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { doc, onSnapshot, updateDoc, collection, query, orderBy, limit, getDoc, increment } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { logHistory } from "./historyManager.js";
import { renderSavings } from "./finance/retirement.js"; 
import { applyInterest, takeOutLoan, repayLoan, getCreditStatus } from "./finance/loan.js"; 
import { applyFineInterestIfNeeded, buildDebtPaymentPreview, getDebtLedger, payDebtChunk } from "./debtManager.js";
import { sendSlackMessage } from "./slackNotifier.js";

// --- NEW CONTRACT IMPORTS ---
import { listenForContractOffers, listenForAdminRoster, renderUserContract } from "./contracts.js";

// --- SHOP & COSMETICS IMPORTS FOR QUOTA SAVING ---
import { renderShop } from "./shop/shop.js";
import { renderBpsShop } from "./shop/bpsShop.js";
import { loadCosmetics } from "./shop/cosmetics.js"; 
// ADDED: Subscription Shop Import
import { loadSubscriptionShop } from "./shop/subscriptionShop.js";

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

// --- GAMES IMPORTS ---
import { initGamesUI, saveGamesSettings, getGamesConfig } from "./games.js";

// --- FINE SYSTEM IMPORT ---
import { initFineSystem } from "./fines.js";

// --- INSURANCE SYSTEM IMPORT ---
import { initInsurance, checkMondayAllowance } from "./finance/insurance.js";

// --- NEW BPS SECURITY IMPORTS ---
import { openPinModal } from "./securityModal.js";
import { changeBpsPin, checkRewardsBilling } from "./bpsManager.js";
import { getBpsDecayInfo } from "./expirationUtils.js";

/* =========================================================
    QUOTA PROTECTION: LISTENER MANAGER
========================================================= */
let unsubUser = null;
let unsubHistory = null;
let listenersInitialized = false; 
let insuranceInitialized = false;
let _lastWeeklyBpsCheckKey = null;
let subscriptionShopLoaded = false;

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
const userBpsDecay = document.getElementById("user-bps-decay");
const bpsRiskOriginalEl = document.getElementById("bps-risk-original");
const bpsRiskSubtractedEl = document.getElementById("bps-risk-subtracted");
const bpsRiskNewEl = document.getElementById("bps-risk-new");
const bpsRiskExpiresEl = document.getElementById("bps-risk-expires");
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
const loanSelectTrigger = document.getElementById("loan-select-trigger");
const loanSelectTriggerLabel = document.getElementById("loan-select-trigger-label");
const loanSelectPanel = document.getElementById("loan-select-panel");
const takeLoanBtn = document.getElementById("take-loan-btn");
const repayLoanBtn = document.getElementById("repay-loan-btn");
const activeLoanSection = document.getElementById("active-loan-info");
const debtAmountEl = document.getElementById("debt-amount");
const dailyInterestEl = document.getElementById("daily-interest");
const dailyInterestLabelEl = document.getElementById("daily-interest-label");
const timerEl = document.getElementById("interest-timer");
const loanProtectionStatusEl = document.getElementById("loan-protection-status");
const debtSectionEl = document.getElementById("debt-section");
const debtFinesTotalEl = document.getElementById("debt-fines-total");
const debtAdminTotalEl = document.getElementById("debt-admin-total");
const debtGrandTotalEl = document.getElementById("debt-grand-total");
const debtListEl = document.getElementById("debt-list");
const debtOverdueBadgeEl = document.getElementById("debt-overdue-badge");
const debtInsuranceNoteEl = document.getElementById("debt-insurance-note");
const debtPaymentAmountEl = document.getElementById("debt-payment-amount");
const payDebtBtn = document.getElementById("pay-debt-btn");
const payFullDebtBtn = document.getElementById("pay-full-debt-btn");

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
let debtCountdownInterval = null;

// Read-only accessors so other modules (e.g. aiChat.js) can reuse the already-live
// snapshot data instead of issuing their own extra Firestore reads.
export function getCurrentDashboardData() {
  return currentDashboardData;
}
export function getCachedHistory() {
  return cachedHistory;
}

/* =========================================================
    ANTI-FLICKER: PREVIOUS DATA CACHE
    Tracks last-rendered values so we only call expensive
    render functions when relevant fields actually change.
========================================================= */
let _prevSavingsKey = null;       // tracks retirementSavings changes
let _prevStatsKey = null;         // tracks volatilityIndex / economy stat changes
let _prevShopKey = null;          // tracks membership / cosmetics changes for shop
let _prevBpsShopKey = null;       // tracks bpsBalance changes for bps shop
let _prevCosmeticsKey = null;     // tracks cosmeticsOwned changes
let _prevBpsConverterKey = null;  // tracks bpsBalance + volatilityIndex
let _prevContractKey = null;      // tracks contract-relevant fields
let _prevDebtKey = null;          // tracks debt ledger changes
let _cachedLiveRate = null;       // cached market rate to avoid redundant fetches
let _lastRateFetchTime = 0;       // timestamp of last rate fetch
const RATE_FETCH_INTERVAL_MS = 60000; // re-fetch market rate at most once per minute

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

            if (targetTab === 'tab-admin') {
                import('./admin.refactored.js').then(m => m.initializeAdminPanel());
            }

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

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function formatCountdown(targetDate, now = new Date()) {
    if (!targetDate) return "No due date";

    const diffMs = targetDate.getTime() - now.getTime();
    const isOverdue = diffMs < 0;
    const absMs = Math.abs(diffMs);
    const totalMinutes = Math.max(0, Math.floor(absMs / 60000));
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    const parts = [];

    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (days === 0 && hours === 0) parts.push(`${minutes}m`);

    const label = parts.join(" ") || "0m";
    return isOverdue ? `Overdue by ${label}` : `Due in ${label}`;
}

function maybeSyncBpsDecayState(userRef, data) {
    const balance = Number(data?.bpsBalance || 0);
    const now = new Date();
    const expiryDate = data?.bpsExpiryAt ? new Date(data.bpsExpiryAt) : null;
    const hasValidExpiry = expiryDate && !Number.isNaN(expiryDate.getTime());

    if (balance <= 0) {
        if (data?.bpsExpiryAt || data?.bpsDecayStartedAt) {
            currentDashboardData = {
                ...currentDashboardData,
                bpsExpiryAt: null,
                bpsDecayStartedAt: null
            };
            return updateDoc(userRef, { bpsExpiryAt: null, bpsDecayStartedAt: null });
        }
        return Promise.resolve();
    }

    if (!hasValidExpiry) {
        const nextExpiry = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000)).toISOString();
        const startedAt = now.toISOString();
        currentDashboardData = {
            ...currentDashboardData,
            bpsExpiryAt: nextExpiry,
            bpsDecayStartedAt: startedAt
        };
        return updateDoc(userRef, { bpsExpiryAt: nextExpiry, bpsDecayStartedAt: startedAt });
    }

    if (expiryDate > now) return Promise.resolve();

    const decayAmount = Math.min(10, balance);
    const nextBalance = Math.max(0, balance - decayAmount);
    const nextExpiry = nextBalance > 0 ? new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000)).toISOString() : null;
    const decayStartedAt = nextBalance > 0 ? now.toISOString() : null;

    currentDashboardData = {
        ...currentDashboardData,
        bpsBalance: nextBalance,
        bpsExpiryAt: nextExpiry,
        bpsDecayStartedAt: decayStartedAt
    };

    return updateDoc(userRef, {
        bpsBalance: increment(-decayAmount),
        bpsExpiryAt: nextExpiry,
        bpsDecayStartedAt: decayStartedAt
    });
}

function buildDebtPaymentModalHtml(preview) {
    const lines = preview.breakdown.map((item) => {
        if (item.type === "fine") {
            const insured = Boolean(item.insuranceActive);
            const originalAmount = Number(item.originalAmount || item.amount || 0);
            const cutAmount = Number(item.coveredAmount || 0);
            const payableAmount = Number(item.amount || 0);

            return `
                <div style="background: rgba(231, 76, 60, 0.08); border: 1px solid rgba(231, 76, 60, 0.16); border-radius: 12px; padding: 12px; display: grid; gap: 6px;">
                    <div style="display:flex; justify-content:space-between; gap:10px; align-items:center;">
                        <strong style="color:#fff; text-transform:uppercase; letter-spacing:0.5px; font-size:0.78rem;">Judicial Fine</strong>
                        <strong style="color:#e74c3c;">$${payableAmount.toLocaleString()}</strong>
                    </div>
                    ${insured ? `<div style="font-size:0.68rem; color:#d4af37; font-weight:900; text-transform:uppercase; letter-spacing:1px;">🛡️ 50% Covered by Blutzs Insurance</div>` : ``}
                    <div style="font-size:0.72rem; color:#cfcfcf; line-height:1.7;">${insured ? `<span style="color:#e74c3c; text-decoration:line-through; font-weight:800;">Original fine: $${originalAmount.toLocaleString()}</span> <span style="color:#d4af37; font-weight:900; margin:0 6px;">•</span> <span style="color:#2ecc71; font-weight:900;">Due: $${payableAmount.toLocaleString()}</span> <span style="color:#888;">(Insurance cut: $${cutAmount.toLocaleString()})</span>` : `No fee applied because this amount is going to a judicial fine.`}</div>
                </div>
            `;
        }

        const dueDate = item.dueDate ? new Date(item.dueDate) : null;
        const dueLabel = dueDate ? formatCountdown(dueDate) : "No due date";
        const feeBits = [];
        if (item.fee > 0) feeBits.push(`5% admin fee: $${item.fee.toLocaleString()}`);
        if (item.lateFee > 0) feeBits.push(`5% late fee: $${item.lateFee.toLocaleString()}`);

        return `
            <div style="background: rgba(52, 152, 219, 0.08); border: 1px solid rgba(52, 152, 219, 0.16); border-radius: 12px; padding: 12px; display: grid; gap: 6px;">
                <div style="display:flex; justify-content:space-between; gap:10px; align-items:center;">
                    <strong style="color:#fff; text-transform:uppercase; letter-spacing:0.5px; font-size:0.78rem;">Admin Debt</strong>
                    <strong style="color:#3498db;">$${item.amount.toLocaleString()}</strong>
                </div>
                <div style="font-size:0.72rem; color:#cfcfcf; line-height:1.5;">${escapeHtml(item.reason || "Admin-issued debt")}</div>
                <div style="font-size:0.68rem; color:${item.overdue ? '#e74c3c' : '#f1c40f'}; font-weight:800; text-transform:uppercase; letter-spacing:1px;">${escapeHtml(dueLabel)}</div>
                <div style="font-size:0.72rem; color:#cfcfcf; line-height:1.5;">${feeBits.length ? feeBits.join(" · ") : "No admin fee applied on this slice."}</div>
            </div>
        `;
    }).join("");

    return `
        <div style="display:grid; gap:14px; max-width: 640px; width: min(92vw, 640px); background: linear-gradient(180deg, #151515 0%, #111 100%); border: 1px solid rgba(255,255,255,0.08); border-radius: 18px; padding: 20px; box-shadow: 0 25px 80px rgba(0,0,0,0.55);">
            <div>
                <div style="font-size:0.72rem; color:#888; font-weight:900; text-transform:uppercase; letter-spacing:1.2px; margin-bottom:6px;">Confirm debt payment</div>
                <h3 style="margin:0; color:#fff; font-size:1.2rem;">Judicial fines are paid first, then admin debt</h3>
                <p style="margin:8px 0 0 0; color:#aaa; font-size:0.8rem; line-height:1.5;">Review the breakdown below before confirming. Judicial fine amounts do not get the 5% admin fee, and if insurance is active it cuts judicial fines by 50% before you pay. Admin debt can carry a 5% fee for partial payments and a 5% late fee when overdue.</p>
            </div>

            <div style="display:grid; gap:10px;">
                ${lines || `<div style="color:#888; font-style:italic;">No payable debt found.</div>`}
            </div>

            <div style="display:grid; gap:8px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; padding: 14px;">
                <div style="display:flex; justify-content:space-between; gap:10px; font-size:0.82rem; color:#ddd;"><span>Judicial paid</span><strong>$${preview.finePaid.toLocaleString()}</strong></div>
                <div style="display:flex; justify-content:space-between; gap:10px; font-size:0.82rem; color:#ddd;"><span>Judicial original</span><strong>$${(preview.ledger.fineDebt?.originalAmount || 0).toLocaleString()}</strong></div>
                <div style="display:flex; justify-content:space-between; gap:10px; font-size:0.82rem; color:#ddd;"><span>Insurance cut</span><strong>$${(preview.ledger.fineDebt?.coveredAmount || 0).toLocaleString()}</strong></div>
                <div style="display:flex; justify-content:space-between; gap:10px; font-size:0.82rem; color:#ddd;"><span>Admin paid</span><strong>$${preview.adminPaid.toLocaleString()}</strong></div>
                <div style="display:flex; justify-content:space-between; gap:10px; font-size:0.82rem; color:#ddd;"><span>Admin fees</span><strong>$${(preview.adminPartialFee + preview.adminLateFee).toLocaleString()}</strong></div>
                <div style="display:flex; justify-content:space-between; gap:10px; font-size:0.9rem; color:#fff; border-top:1px solid rgba(255,255,255,0.08); padding-top:8px;"><span>Total charge</span><strong>$${preview.balanceCost.toLocaleString()}</strong></div>
            </div>

            <div style="display:flex; gap:10px; flex-wrap:wrap; justify-content:flex-end;">
                <button id="debt-confirm-cancel" class="btn-secondary" style="min-width: 140px;">Cancel</button>
                <button id="debt-confirm-accept" class="btn-primary" style="min-width: 140px; background:#2ecc71;">Confirm Payment</button>
            </div>
        </div>
    `;
}

function showDebtPaymentConfirmationModal(preview) {
    return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.id = "debt-payment-confirm-overlay";
        overlay.style.cssText = "position:fixed; inset:0; z-index:10001; display:flex; align-items:center; justify-content:center; padding:20px; background:rgba(0,0,0,0.82); backdrop-filter: blur(8px);";
        overlay.innerHTML = buildDebtPaymentModalHtml(preview);

        const close = (result) => {
            overlay.remove();
            resolve(result);
        };

        overlay.addEventListener("click", (event) => {
            if (event.target === overlay) close(false);
        });

        overlay.querySelector("#debt-confirm-cancel")?.addEventListener("click", () => close(false));
        overlay.querySelector("#debt-confirm-accept")?.addEventListener("click", () => close(true));

        document.body.appendChild(overlay);
    });
}

window.requestFineAppeal = async () => {
    if (!auth.currentUser || !currentDashboardData?.activeFine) return;

    if (currentDashboardData.activeFine.appealStatus === "denied") {
        return alert("This appeal was already denied. You can't appeal it again.");
    }

    if (currentDashboardData.activeFine.appealPending) {
        return alert("This fine is already under appeal.");
    }

    const reason = prompt("Enter your appeal reason for this judicial fine:");
    if (!reason || !reason.trim()) return;

    try {
        await updateDoc(doc(db, "users", auth.currentUser.uid), {
            "activeFine.appealPending": true,
            "activeFine.appealStatus": "pending",
            "activeFine.appealReason": reason.trim(),
            "activeFine.appealSubmittedAt": new Date().toISOString()
        });

        await logHistory(auth.currentUser.uid, `Appealed judicial fine: ${reason.trim()}`, "admin");
        sendSlackMessage(
            `📨 *JUDICIAL FINE APPEAL REQUESTED*\n` +
            `👤 *User:* ${currentDashboardData.username || auth.currentUser.uid}\n` +
            `💰 *Fine Due:* $${Number(currentDashboardData.activeFine.remainingDue ?? currentDashboardData.activeFine.amount ?? 0).toLocaleString()}\n` +
            `📝 *Reason:* ${currentDashboardData.activeFine.reason || "Judicial fine"}\n` +
            `📣 *Appeal Reason:* ${reason.trim()}`
        );
        alert("Your appeal was submitted for admin review.");
    } catch (err) {
        alert(err.message || "Unable to submit appeal right now.");
    }
};

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
    if (currentDashboardData) renderSavings(currentDashboardData);
}

/* =========================================================
    THROTTLED MARKET RATE FETCH
    Returns cached rate if fetched within the last minute,
    avoiding a redundant external call on every snapshot.
========================================================= */
async function getThrottledMarketRate() {
    const now = Date.now();
    if (_cachedLiveRate !== null && (now - _lastRateFetchTime) < RATE_FETCH_INTERVAL_MS) {
        return _cachedLiveRate;
    }
    const { rate } = await getLiveMarketRate();
    _cachedLiveRate = rate;
    _lastRateFetchTime = now;
    return rate;
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
    insuranceInitialized = false;
    _lastWeeklyBpsCheckKey = null;

    // Reset all anti-flicker caches on logout
    _prevSavingsKey = null;
    _prevStatsKey = null;
    _prevShopKey = null;
    _prevBpsShopKey = null;
    _prevCosmeticsKey = null;
    _prevBpsConverterKey = null;
    _prevContractKey = null;
    _cachedLiveRate = null;
    _lastRateFetchTime = 0;
    
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
      initGamesUI(); 
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

    await maybeSyncBpsDecayState(userRef, currentDashboardData);

    if (!billingCheckedOnce) {
        await checkMembershipBilling(user.uid, currentDashboardData);
        await checkRewardsBilling(user.uid, currentDashboardData);
        billingCheckedOnce = true;
    }

    await applyInterest(user.uid, currentDashboardData);
    await applyFineInterestIfNeeded(userRef, currentDashboardData);

    if (!themeAppliedOnce) {
        const theme = currentDashboardData.cosmeticsOwned?.darkMode
            ? (currentDashboardData.theme || localStorage.getItem("theme") || "dark")
            : "light"; 
        applyTheme(theme);
        themeAppliedOnce = true; 
    }

    // --- THROTTLED: only fetch market rate once per minute to prevent excess reads ---
    const liveRate = await getThrottledMarketRate();
    updateDashboardUI(user, liveRate);

    // --- GUARDED RENDERS: only re-render when relevant data actually changed ---

    // Shop: depends on membershipLevel, balance, shopOrderCount
    const shopKey = `${currentDashboardData.membershipLevel}|${currentDashboardData.balance}|${currentDashboardData.shopOrderCount}`;
    if (shopKey !== _prevShopKey) {
        if (typeof renderShop === "function") renderShop(currentDashboardData);
        _prevShopKey = shopKey;
    }

    // BPS Shop: depends on bpsBalance
    const bpsShopKey = `${currentDashboardData.bpsBalance}`;
    if (bpsShopKey !== _prevBpsShopKey) {
        if (typeof renderBpsShop === "function") renderBpsShop(currentDashboardData);
        _prevBpsShopKey = bpsShopKey;
    }

    // Cosmetics: depends on cosmeticsOwned and equippedBackground
    const cosmeticsKey = JSON.stringify(currentDashboardData.cosmeticsOwned) + `|${currentDashboardData.equippedBackground}`;
    if (cosmeticsKey !== _prevCosmeticsKey) {
        if (typeof loadCosmetics === "function") loadCosmetics(currentDashboardData);
        _prevCosmeticsKey = cosmeticsKey;
    }

    // Retirement Savings: depends only on retirementSavings field
    const savingsKey = `${currentDashboardData.retirementSavings}`;
    if (savingsKey !== _prevSavingsKey) {
        if (typeof renderSavings === "function") renderSavings(currentDashboardData);
        _prevSavingsKey = savingsKey;
    }

    renderDebtPanel(currentDashboardData);

    // BPS Converter: depends on bpsBalance and volatilityIndex
    const bpsConverterKey = `${currentDashboardData.bpsBalance}|${currentDashboardData.volatilityIndex}`;
    if (bpsConverterKey !== _prevBpsConverterKey) {
        if (typeof renderBpsConverter === "function") renderBpsConverter(currentDashboardData);
        _prevBpsConverterKey = bpsConverterKey;
    }

    // Economy Stats: depends on volatilityIndex (and anything economy-related)
    const statsKey = `${currentDashboardData.volatilityIndex}`;
    if (statsKey !== _prevStatsKey) {
        if (typeof renderStatsTeaser === "function") renderStatsTeaser(currentDashboardData);
        _prevStatsKey = statsKey;
    }

    // Contract: depends on contract-relevant fields
    const contractKey = `${currentDashboardData.contractId}|${currentDashboardData.contractStatus}|${currentDashboardData.employmentStatus}`;
    if (contractKey !== _prevContractKey) {
        if (typeof renderUserContract === "function") renderUserContract(user.uid, currentDashboardData);
        _prevContractKey = contractKey;
    }

    // Subscription shop: load once per session only
    if (!subscriptionShopLoaded && typeof loadSubscriptionShop === "function") {
        loadSubscriptionShop();
        subscriptionShopLoaded = true;
    }

    // Insurance: init once per session only
    if (!insuranceInitialized && typeof initInsurance === "function") {
        initInsurance(currentDashboardData);
        insuranceInitialized = true;
    }

    // Dark Blue Weekly C: award +5 BPS every Monday (EST) while subscribed
    const hasWeeklyC = currentDashboardData.insurance?.activePackages?.includes("darkblue_c");
    if (hasWeeklyC && typeof checkMondayAllowance === "function") {
        const weeklyBpsKey = `${getESTDate(0)}|weekly-c`;
        if (weeklyBpsKey !== _lastWeeklyBpsCheckKey) {
            _lastWeeklyBpsCheckKey = weeklyBpsKey;
            checkMondayAllowance(user.uid, currentDashboardData);
        }
    }

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

      const hasShieldB = data.insurance?.activePackages?.includes("blutzs_b");
      const loanStart = data.loanStartDate ? new Date(data.loanStartDate) : null;
      const protectionPaid = data.insurance?.loanProtectionLastPaid ? new Date(data.insurance.loanProtectionLastPaid) : null;
      const protectionActive = hasShieldB && loanStart && protectionPaid && protectionPaid.getTime() >= loanStart.getTime();

      if (loanProtectionStatusEl) {
          if (protectionActive) {
              loanProtectionStatusEl.textContent = "🛡️ Shield B Boost Active";
              loanProtectionStatusEl.style.display = "inline-flex";
              loanProtectionStatusEl.style.background = "rgba(46, 204, 113, 0.12)";
              loanProtectionStatusEl.style.color = "#2ecc71";
              loanProtectionStatusEl.style.border = "1px solid rgba(46, 204, 113, 0.35)";
          } else if (hasShieldB) {
              loanProtectionStatusEl.textContent = "🛡️ Shield B Available This Month";
              loanProtectionStatusEl.style.display = "inline-flex";
              loanProtectionStatusEl.style.background = "rgba(241, 196, 15, 0.12)";
              loanProtectionStatusEl.style.color = "#f1c40f";
              loanProtectionStatusEl.style.border = "1px solid rgba(241, 196, 15, 0.35)";
          } else {
              loanProtectionStatusEl.textContent = "";
              loanProtectionStatusEl.style.display = "none";
          }
      }
      
      const interestRate = [750000, 1000000].includes(data.originalLoanAmount) ? 0.02 : 0.05;
      if (dailyInterestEl) {
          const liveInterest = activeDebt * interestRate;
          dailyInterestEl.textContent = `$${liveInterest.toLocaleString()}`;
      }
      if (dailyInterestLabelEl) {
          dailyInterestLabelEl.textContent = `Daily Interest (${interestRate * 100}%)`;
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
      if (loanProtectionStatusEl) loanProtectionStatusEl.style.display = "none";
      if (interestTimerInterval) clearInterval(interestTimerInterval);
  }

  if (data.isAdmin) {
      openAdminBtn?.classList.remove("hidden");
      initGamesUI();
  } else {
      openAdminBtn?.classList.add("hidden");
  }

  if(document.getElementById("user-bps")) {
      document.getElementById("user-bps").textContent = bpsBalance.toLocaleString();
  }

    const bpsDecayInfo = getBpsDecayInfo(data);
    const bpsOriginalBalance = Number(data.bpsBalance || 0);
    const bpsAtRisk = bpsDecayInfo.isActive ? bpsDecayInfo.decayAmount : 0;
    const bpsProjectedBalance = Math.max(0, bpsOriginalBalance - bpsAtRisk);

  if (bpsRiskOriginalEl) bpsRiskOriginalEl.textContent = `${bpsOriginalBalance.toLocaleString()} BPS`;
  if (bpsRiskSubtractedEl) bpsRiskSubtractedEl.textContent = `${bpsAtRisk.toLocaleString()} BPS`;
  if (bpsRiskNewEl) bpsRiskNewEl.textContent = `${bpsProjectedBalance.toLocaleString()} BPS`;
  if (bpsRiskExpiresEl) bpsRiskExpiresEl.textContent = bpsDecayInfo.isActive ? bpsDecayInfo.expiresLabel : "Inactive";

  if (userBpsDecay) {
      if (bpsDecayInfo.isActive) {
          userBpsDecay.innerHTML = `⚠ ${bpsAtRisk} BPS at risk`;
          userBpsDecay.style.background = bpsDecayInfo.isOverdue ? "rgba(231, 76, 60, 0.14)" : "rgba(241, 196, 15, 0.12)";
          userBpsDecay.style.color = bpsDecayInfo.isOverdue ? "#ff9b9b" : "#f1c40f";
      } else {
          userBpsDecay.innerHTML = `<span style="color:#888;">Inactive</span>`;
          userBpsDecay.style.background = "rgba(255,255,255,0.04)";
          userBpsDecay.style.color = "#888";
      }
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
    employmentStatusEl.style.color = employmentStatus === "Employed"
      ? "green"
      : employmentStatus === "Retired"
        ? "#3498db"
        : "red";
  }
}

function renderDebtPanel(data, forceRefresh = false) {
    if (!debtSectionEl) return;

    const ledger = getDebtLedger(data);
    const debtKey = JSON.stringify({
        fine: data.activeFine || null,
        admin: data.adminDebts || {},
        loan: data.activeLoan || 0
    });

    if (!forceRefresh && debtKey === _prevDebtKey) return;
    _prevDebtKey = debtKey;

    if (ledger.adminDebts.length > 0 && !debtCountdownInterval) {
        debtCountdownInterval = setInterval(() => {
            if (currentDashboardData) {
                renderDebtPanel(currentDashboardData, true);
            }
        }, 1000);
    } else if (ledger.adminDebts.length === 0 && debtCountdownInterval) {
        clearInterval(debtCountdownInterval);
        debtCountdownInterval = null;
    }

    if (debtFinesTotalEl) debtFinesTotalEl.textContent = `$${ledger.fineTotal.toLocaleString()}`;
    if (debtAdminTotalEl) debtAdminTotalEl.textContent = `$${ledger.adminTotal.toLocaleString()}`;
    if (debtGrandTotalEl) debtGrandTotalEl.textContent = `$${ledger.totalDebt.toLocaleString()}`;

    const now = new Date();
    const entries = [];

    if (ledger.fineDebt) {
        const fineDueDate = ledger.fineDebt.dueDate ? new Date(ledger.fineDebt.dueDate) : null;
        const fineOverdue = fineDueDate ? now > fineDueDate : false;
        const appealPending = Boolean(ledger.fineDebt.appealPending);
        const insuranceLabel = ledger.fineDebt.insuranceActive
            ? ` · 🛡️ 50% Covered by Blutzs Insurance`
            : "";
        entries.push({
            key: "fine",
            title: "Judicial Fine",
            amount: ledger.fineTotal,
            originalAmount: ledger.fineDebt.originalAmount,
            coveredAmount: ledger.fineDebt.coveredAmount,
            insuranceActive: ledger.fineDebt.insuranceActive,
            appealPending,
            appealStatus: ledger.fineDebt.appealStatus,
            reason: ledger.fineDebt.reason || "Judicial penalty",
            appealReason: ledger.fineDebt.appealReason || "",
            insuranceText: ledger.fineDebt.insuranceActive
                ? `🛡️ 50% Covered by Blutzs Insurance`
                : "",
            meta: `${ledger.fineDebt.reason || "Judicial penalty"}${insuranceLabel}`,
            dueLabel: fineDueDate ? `${fineDueDate.toLocaleDateString()} · ${formatCountdown(fineDueDate, now)}` : "No due date",
            status: fineOverdue ? "Overdue - 1% daily interest" : "Open"
        });
    }

    ledger.adminDebts.forEach((debt, index) => {
        const dueDate = debt.dueDate ? new Date(debt.dueDate) : null;
        const overdue = dueDate ? now > dueDate : false;
        entries.push({
            key: debt.id || `admin-${index}`,
            title: "Admin Debt",
            amount: debt.remaining,
            reason: debt.reason || "Admin-issued debt",
            meta: debt.reason || "Admin-issued debt",
            dueLabel: dueDate ? `${dueDate.toLocaleDateString()} · ${formatCountdown(dueDate, now)}` : "No due date",
            status: overdue ? "Overdue - 5% late fee" : "Open"
        });
    });

    if (debtOverdueBadgeEl) {
        const overdueCount = entries.filter((entry) => entry.status.startsWith("Overdue")).length;
        debtOverdueBadgeEl.textContent = `${overdueCount} overdue`;
        debtOverdueBadgeEl.style.opacity = overdueCount > 0 ? "1" : "0.7";
    }

    if (debtInsuranceNoteEl) {
        if (ledger.fineDebt?.insuranceActive) {
            debtInsuranceNoteEl.textContent = `🛡️ 50% Covered by Blutzs Insurance`;
            debtInsuranceNoteEl.style.display = "inline-flex";
        } else {
            debtInsuranceNoteEl.style.display = "none";
        }
    }

    if (debtListEl) {
        if (entries.length === 0) {
            debtListEl.innerHTML = `<p style="color: var(--text-muted); font-style: italic; margin: 0;">No active debt entries.</p>`;
        } else {
            debtListEl.innerHTML = entries.map((entry) => `
                <div style="background: var(--card-bg); border: 1px solid var(--border-color); padding: 14px; border-radius: 12px; display: grid; gap: 8px;">
                    <div style="display: flex; justify-content: space-between; gap: 10px; align-items: center; flex-wrap: wrap;">
                        <div>
                            <div style="font-size: 0.85rem; font-weight: 900; color: var(--text-main); text-transform: uppercase; letter-spacing: 0.6px;">${entry.title}</div>
                            <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 2px; line-height: 1.35;">
                                <span>${entry.reason || entry.meta}</span>
                                ${entry.insuranceText ? `<span style="color:#d4af37; font-weight:900; text-transform:uppercase; letter-spacing:0.5px;"> · ${entry.insuranceText}</span>` : ``}
                            </div>
                        </div>
                        ${entry.insuranceActive
                            ? `
                                <div style="display:flex; flex-direction:column; align-items:flex-end; gap:2px; line-height:1;">
                                    <span style="font-size:0.82rem; font-weight:900; color:#e74c3c; text-decoration:line-through; text-decoration-thickness: 2px;">$${Number(entry.originalAmount || entry.amount || 0).toLocaleString()}</span>
                                    <strong style="font-size:1.1rem; color:#2ecc71;">$${entry.amount.toLocaleString()}</strong>
                                </div>
                            `
                            : `<strong style="font-size: 1.05rem; color: ${entry.status.startsWith("Overdue") ? "#e74c3c" : "#2ecc71"};">$${entry.amount.toLocaleString()}</strong>`
                        }
                    </div>
                    ${entry.title === "Judicial Fine"
                        ? `
                            <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; justify-content:flex-start;">
                                ${entry.appealPending
                                    ? `<span style="background: rgba(52,152,219,0.12); color:#3498db; border:1px solid rgba(52,152,219,0.25); padding:4px 8px; border-radius:999px; font-size:0.62rem; font-weight:900; text-transform:uppercase; letter-spacing:0.8px;">Appeal Pending</span>`
                                    : entry.appealStatus === "denied"
                                        ? `<span style="background: rgba(231,76,60,0.12); color:#e74c3c; border:1px solid rgba(231,76,60,0.25); padding:4px 8px; border-radius:999px; font-size:0.62rem; font-weight:900; text-transform:uppercase; letter-spacing:0.8px;">Appeal Denied</span>`
                                        : `<button type="button" onclick="window.requestFineAppeal()" style="background: rgba(241,196,15,0.15); color:#f1c40f; border:1px solid rgba(241,196,15,0.35); padding:6px 10px; border-radius:8px; font-size:0.65rem; font-weight:900; text-transform:uppercase; letter-spacing:1px; cursor:pointer;">Appeal Fine</button>`
                                }
                                ${entry.appealReason ? `<span style="font-size:0.65rem; color:var(--text-muted);">Reason: ${escapeHtml(entry.appealReason)}</span>` : ``}
                            </div>
                        `
                        : ``}
                    <div style="display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; font-size: 0.68rem; text-transform: uppercase; letter-spacing: 1px; font-weight: 800; color: var(--text-muted);">
                        <span>Status: ${entry.status}</span>
                                <span>Due: ${entry.dueLabel}</span>
                    </div>
                </div>
            `).join("");
        }
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

payDebtBtn?.addEventListener("click", async () => {
    if (!auth.currentUser || !currentDashboardData) return;
    const amount = parseFloat(debtPaymentAmountEl?.value || "0");
    if (!amount || amount <= 0) return alert("Enter a valid debt payment amount.");

    try {
        const userRef = doc(db, "users", auth.currentUser.uid);
        const preview = buildDebtPaymentPreview(currentDashboardData, amount);
        const confirmed = await showDebtPaymentConfirmationModal(preview);
        if (!confirmed) return;

        const result = await payDebtChunk(userRef, currentDashboardData, amount);
        const historyBits = [`Paid debt chunk of $${result.paid.toLocaleString()}`];
        if (result.fineOriginalPaid > 0 && result.fineCoveredPaid > 0) {
            historyBits.push(`judicial original $${result.fineOriginalPaid.toLocaleString()} → covered $${result.fineCoveredPaid.toLocaleString()}`);
        }
        if (result.finePaid > 0) historyBits.push(`judicial $${result.finePaid.toLocaleString()}`);
        if (result.adminPaid > 0) historyBits.push(`admin $${result.adminPaid.toLocaleString()}`);
        if (result.penalty > 0) historyBits.push(`fees $${result.penalty.toLocaleString()}`);
        await logHistory(auth.currentUser.uid, historyBits.join(" · "), "transfer-out");
        debtPaymentAmountEl.value = "";
        if (result.remainingDebt === 0) {
            currentDashboardData = {
                ...currentDashboardData,
                activeFine: null,
                adminDebts: {}
            };
        }
        renderDebtPanel(currentDashboardData, true);
        sendSlackMessage(
            `💸 *DEBT REPAYMENT COMPLETED*\n` +
            `👤 *User:* ${auth.currentUser.displayName || currentDashboardData.username || auth.currentUser.uid}\n` +
            `📌 *Type:* ${result.adminPaid > 0 && result.finePaid > 0 ? "Judicial + Admin" : result.adminPaid > 0 ? "Admin Debt" : "Judicial Fine"}\n` +
            `💰 *Paid:* $${result.paid.toLocaleString()}\n` +
            `🧾 *Judicial Paid:* $${result.finePaid.toLocaleString()}\n` +
            `🏛️ *Admin Paid:* $${result.adminPaid.toLocaleString()}\n` +
            `💸 *Fees:* $${result.penalty.toLocaleString()}`
        );
        const fineMessage = result.fineOriginalPaid > 0 && result.fineCoveredPaid > 0
            ? `Judicial original: $${result.fineOriginalPaid.toLocaleString()}, Insurance cut: $${result.fineCoveredPaid.toLocaleString()}, Judicial paid: $${result.finePaid.toLocaleString()}`
            : `Judicial paid: $${result.finePaid.toLocaleString()}`;
        alert(result.penalty > 0
            ? `Debt payment processed. ${fineMessage}, Admin: $${result.adminPaid.toLocaleString()}, Fees: $${result.penalty.toLocaleString()}.`
            : `Debt payment processed. ${fineMessage}, Admin: $${result.adminPaid.toLocaleString()}.`);
    } catch (err) {
        alert(err.message || "Unable to pay debt right now.");
    }
});

payFullDebtBtn?.addEventListener("click", async () => {
    if (!auth.currentUser || !currentDashboardData) return;
    const debtLedger = getDebtLedger(currentDashboardData);
    if (debtLedger.totalDebt <= 0) return alert("You have no active debt to pay.");

    try {
        const userRef = doc(db, "users", auth.currentUser.uid);
        const result = await payDebtChunk(userRef, currentDashboardData, debtLedger.totalDebt);
        await logHistory(auth.currentUser.uid, `Paid full debt of $${result.paid.toLocaleString()}`, "transfer-out");
        debtPaymentAmountEl.value = "";
        if (result.remainingDebt === 0) {
            currentDashboardData = {
                ...currentDashboardData,
                activeFine: null,
                adminDebts: {}
            };
        }
        renderDebtPanel(currentDashboardData, true);
        sendSlackMessage(
            `💸 *FULL DEBT REPAYMENT COMPLETED*\n` +
            `👤 *User:* ${auth.currentUser.displayName || currentDashboardData.username || auth.currentUser.uid}\n` +
            `💰 *Paid:* $${result.paid.toLocaleString()}\n` +
            `🧾 *Judicial Paid:* $${result.finePaid.toLocaleString()}\n` +
            `🏛️ *Admin Paid:* $${result.adminPaid.toLocaleString()}\n` +
            `💸 *Fees:* $${result.penalty.toLocaleString()}`
        );
        alert("Debt cleared from the selected ledger.");
    } catch (err) {
        alert(err.message || "Unable to pay full debt right now.");
    }
});

/* ---------- LOAN AMOUNT: CUSTOM DROPDOWN ---------- */
if (loanSelectTrigger && loanSelectPanel && loanAmountSelect) {
    const loanOptionEls = loanSelectPanel.querySelectorAll(".loan-select-option");

    const closeLoanPanel = () => {
        loanSelectPanel.classList.remove("open");
        loanSelectTrigger.setAttribute("aria-expanded", "false");
    };

    const selectLoanOption = (optionEl) => {
        loanAmountSelect.value = optionEl.dataset.value;
        loanOptionEls.forEach(el => {
            const isSelected = el === optionEl;
            el.classList.toggle("selected", isSelected);
            el.setAttribute("aria-selected", String(isSelected));
        });
        loanSelectTriggerLabel.innerHTML = `${optionEl.querySelector(".loan-opt-amount").textContent} <em>${optionEl.querySelector(".loan-opt-tag").textContent}</em>`;
        loanAmountSelect.dispatchEvent(new Event("change"));
    };

    loanSelectTrigger.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = loanSelectPanel.classList.toggle("open");
        loanSelectTrigger.setAttribute("aria-expanded", String(isOpen));
    });

    loanOptionEls.forEach(optionEl => {
        optionEl.addEventListener("click", () => {
            selectLoanOption(optionEl);
            closeLoanPanel();
        });
    });

    document.addEventListener("click", (e) => {
        if (!e.target.closest("#loan-select")) closeLoanPanel();
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeLoanPanel();
    });
}

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