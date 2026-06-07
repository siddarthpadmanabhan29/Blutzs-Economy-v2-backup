console.log("stockMarket.js loaded");

import { db, auth } from "../firebaseConfig.js";
import {
  collection,
  onSnapshot,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  runTransaction,
  increment,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { logHistory } from "../historyManager.js";

const stockMarketList = document.getElementById("stock-market-list");
const stockPortfolioList = document.getElementById("stock-portfolio-list");

let companies = [];
let holdings = [];
let companyUnsubscribe = null;
let portfolioUnsubscribe = null;
let authUnsubscribe = null; // added

const SELL_TAX_RATE = 0.10;       // 10% tax on sell proceeds
const DIVIDEND_TAX_RATE = 0.15;   // 15% tax on dividend payouts
const DIVIDEND_INTERVAL_DAYS = 30; // Pay dividends every 30 days

// ==================== PRICE LOGIC ====================

function getLivePrice(company) {
  const base = Number(company.basePrice || 0);
  const trend = Number(company.marketTrend || 0) / 100;
  const live = base * (1 + trend);
  return Math.max(1, Number(live.toFixed(2)));
}

function calculatePriceImpact(company, quantity, action) {
  const totalShares = Number(company.availableShares || 0) + quantity;
  const currentBase = Number(company.basePrice || 0);
  const tradeFraction = totalShares > 0 ? quantity / totalShares : 0;
  const maxImpact = 0.05;
  const impactPct = Math.min(tradeFraction, maxImpact);
  const direction = action === "buy" ? 1 : -1;
  const newBase = currentBase * (1 + direction * impactPct);
  return Math.max(1, Number(newBase.toFixed(2)));
}

function formatDelta(price, base) {
  const delta = price - base;
  const pct = base > 0 ? (delta / base) * 100 : 0;
  return { delta, pct };
}

// ==================== RENDER ====================

function renderStockMarket() {
  if (!stockMarketList) return;

  if (companies.length === 0) {
    stockMarketList.innerHTML = "<p style='color: gray; font-style: italic; text-align: center; padding: 20px;'>No public companies are available yet.</p>";
    return;
  }

  stockMarketList.innerHTML = companies.map((company) => {
    const livePrice = getLivePrice(company);
    const { delta, pct } = formatDelta(livePrice, Number(company.basePrice || 0));
    const changeClass = delta >= 0 ? "#2ecc71" : "#e74c3c";
    const availableShares = Number(company.availableShares || 0);
    const ownerLabel = company.ownerName || "Open Market";
    const estimatedSellTax = livePrice * SELL_TAX_RATE;

    return `
      <article style="background: rgba(0,0,0,0.25); border: 1px solid ${delta >= 0 ? '#2ecc71' : '#e74c3c'}; border-radius: 14px; padding: 16px; display: flex; flex-direction: column; gap: 10px;">
        <div style="display: flex; justify-content: space-between; gap: 10px; align-items: start;">
          <div>
            <h4 style="margin: 0 0 4px 0; color: #fff; font-size: 1rem;">${company.name}</h4>
            <p style="margin: 0; color: #aaa; font-size: 0.75rem;">${company.description || "Public company listed for investor trading."}</p>
          </div>
          <span style="background: rgba(52,152,219,0.12); color: #3498db; border: 1px solid rgba(52,152,219,0.2); border-radius: 999px; padding: 4px 8px; font-size: 0.65rem; font-weight: 800; text-transform: uppercase;">${ownerLabel}</span>
        </div>

        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; font-size: 0.75rem; color: #ddd;">
          <div style="background: rgba(255,255,255,0.04); border-radius: 10px; padding: 10px;">
            Live Price<br><strong style="color: #f1c40f; font-size: 1rem;">$${livePrice.toLocaleString()}</strong>
          </div>
          <div style="background: rgba(255,255,255,0.04); border-radius: 10px; padding: 10px;">
            Market Change<br><strong style="color: ${changeClass}; font-size: 1rem;">${delta >= 0 ? '+' : ''}$${delta.toFixed(2)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)</strong>
          </div>
          <div style="background: rgba(255,255,255,0.04); border-radius: 10px; padding: 10px;">
            Shares Available<br><strong style="color: #2ecc71; font-size: 1rem;">${availableShares}</strong>
          </div>
          <div style="background: rgba(255,255,255,0.04); border-radius: 10px; padding: 10px;">
            Dividend Yield<br><strong style="color: #8e44ad; font-size: 1rem;">${Number(company.dividendRate || 0)}%</strong>
            <span style="display: block; font-size: 0.6rem; color: #888;">Paid weekly · 15% tax</span>
          </div>
        </div>

        <div style="background: rgba(231,76,60,0.06); border: 1px solid rgba(231,76,60,0.15); border-radius: 8px; padding: 8px 12px; font-size: 0.7rem; color: #e74c3c;">
          ⚠️ Sell Tax: 10% deducted from proceeds (~$${estimatedSellTax.toFixed(2)} per share at current price)
        </div>

        <div style="display: flex; gap: 8px; align-items: center;">
          <input id="stock-qty-${company.id}" type="number" min="1" max="${availableShares}" value="1"
            style="flex: 1; background: #111; color: #fff; border: 1px solid #333; border-radius: 8px; padding: 8px 10px; font-size: 0.85rem;" />
          <button class="stock-buy-btn" data-company-id="${company.id}" data-price="${livePrice}"
            style="background: #2ecc71; color: #fff; border: none; border-radius: 8px; padding: 8px 12px; font-weight: 800; cursor: pointer;">Buy</button>
          <button class="stock-sell-btn" data-company-id="${company.id}" data-price="${livePrice}"
            style="background: #e74c3c; color: #fff; border: none; border-radius: 8px; padding: 8px 12px; font-weight: 800; cursor: pointer;">Sell</button>
        </div>
      </article>
    `;
  }).join("");

  attachTradeButtons();
}

function renderPortfolio() {
  if (!stockPortfolioList) return;

  if (holdings.length === 0) {
    stockPortfolioList.innerHTML = "<p style='color: gray; font-style: italic; text-align: center; padding: 20px;'>You do not own any shares yet.</p>";
    return;
  }

  stockPortfolioList.innerHTML = holdings.map((item) => {
    const company = companies.find((c) => c.id === item.companyId) || {};
    const livePrice = getLivePrice(company);
    const avgCost = Number(item.avgCost || 0);
    const sharesOwned = Number(item.shares || 0);
    const profit = (livePrice - avgCost) * sharesOwned;
    const pct = avgCost > 0 ? ((livePrice - avgCost) / avgCost) * 100 : 0;
    const positive = profit >= 0;

    // Show next dividend info if company has a dividend rate
    const dividendRate = Number(company.dividendRate || 0);
    const estimatedDividend = dividendRate > 0
      ? ((dividendRate / 100) * livePrice * sharesOwned)
      : 0;
    const estimatedDividendAfterTax = estimatedDividend * (1 - DIVIDEND_TAX_RATE);

    // Show days until next dividend
    const lastPaid = item.lastDividendPaidAt ? new Date(item.lastDividendPaidAt) : null;
    const now = new Date();
    const daysSinceLastPaid = lastPaid
      ? Math.floor((now - lastPaid) / (1000 * 60 * 60 * 24))
      : DIVIDEND_INTERVAL_DAYS;
    const daysUntilNext = Math.max(0, DIVIDEND_INTERVAL_DAYS - daysSinceLastPaid);

    return `
      <article style="background: rgba(46,204,113,0.08); border: 1px solid ${positive ? '#2ecc71' : '#e74c3c'}; border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 6px;">
        <div style="display: flex; justify-content: space-between; align-items: start; gap: 10px;">
          <div>
            <h4 style="margin: 0; color: #fff; font-size: 0.95rem;">${company.name || item.companyId}</h4>
            <p style="margin: 2px 0 0 0; color: #aaa; font-size: 0.72rem;">${sharesOwned} share(s) @ avg $${avgCost.toLocaleString()} each</p>
          </div>
          <span style="color: ${positive ? '#2ecc71' : '#e74c3c'}; font-size: 0.75rem; font-weight: 800;">
            ${positive ? '+' : ''}$${profit.toLocaleString()} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)
          </span>
        </div>

        <div style="font-size: 0.75rem; color: #ddd;">
          Live value: <strong style="color: #f1c40f;">$${(livePrice * sharesOwned).toLocaleString()}</strong>
        </div>

        ${dividendRate > 0 ? `
          <div style="background: rgba(142,68,173,0.08); border: 1px solid rgba(142,68,173,0.2); border-radius: 8px; padding: 8px 10px; font-size: 0.7rem; color: #ccc;">
            💰 Next dividend: <strong style="color: #8e44ad;">$${estimatedDividendAfterTax.toFixed(2)}</strong> after 15% tax
            <span style="color: #888; margin-left: 6px;">(in ${daysUntilNext} day${daysUntilNext === 1 ? '' : 's'})</span>
          </div>
        ` : ''}
      </article>
    `;
  }).join("");
}

// ==================== TRADE BUTTONS ====================

function attachTradeButtons() {
  document.querySelectorAll(".stock-buy-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const companyId = btn.dataset.companyId;
      const price = Number(btn.dataset.price || 0);
      const qtyInput = document.getElementById(`stock-qty-${companyId}`);
      const qty = Math.max(1, parseInt(qtyInput?.value || "1", 10) || 1);
      await tradeShares(companyId, qty, price, "buy");
    });
  });

  document.querySelectorAll(".stock-sell-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const companyId = btn.dataset.companyId;
      const price = Number(btn.dataset.price || 0);
      const qtyInput = document.getElementById(`stock-qty-${companyId}`);
      const qty = Math.max(1, parseInt(qtyInput?.value || "1", 10) || 1);
      await tradeShares(companyId, qty, price, "sell");
    });
  });
}

// ==================== TRADE LOGIC ====================

async function tradeShares(companyId, quantity, price, action) {
  const user = auth.currentUser;
  if (!user) return;

  const companyRef = doc(db, "stockCompanies", companyId);
  const userRef = doc(db, "users", user.uid);
  const holdingRef = doc(db, "users", user.uid, "shares", companyId);

  try {
    const companySnap = await getDoc(companyRef);
    const userSnap = await getDoc(userRef);

    if (!companySnap.exists() || !userSnap.exists()) {
      return alert("Company or user profile was not found.");
    }

    const companyData = companySnap.data();
    const userData = userSnap.data();
    const livePrice = getLivePrice(companyData);
    const totalCost = livePrice * quantity;
    const newBasePrice = calculatePriceImpact(companyData, quantity, action);

    // ── BUY ──
    if (action === "buy") {
      if (Number(companyData.availableShares || 0) < quantity) return alert("Not enough shares available.");
      if (Number(userData.balance || 0) < totalCost) return alert("Insufficient funds for this trade.");

      await runTransaction(db, async (transaction) => {
        const freshUser = await transaction.get(userRef);
        const freshCompany = await transaction.get(companyRef);
        const freshHolding = await transaction.get(holdingRef);

        if (!freshCompany.exists()) throw new Error("Company not found.");
        if (!freshUser.exists()) throw new Error("User not found.");
        if (Number(freshUser.data().balance || 0) < livePrice * quantity) throw new Error("Insufficient funds.");
        if (Number(freshCompany.data().availableShares || 0) < quantity) throw new Error("Not enough shares available.");

        const freshCurrentShares = freshHolding.exists() ? Number(freshHolding.data().shares || 0) : 0;
        const freshCurrentAvg = freshHolding.exists() ? Number(freshHolding.data().avgCost || 0) : 0;
        const freshNextAvg = freshCurrentShares === 0
          ? livePrice
          : ((freshCurrentAvg * freshCurrentShares) + (livePrice * quantity)) / (freshCurrentShares + quantity);

        transaction.update(userRef, { balance: increment(-totalCost) });
        transaction.update(companyRef, {
          availableShares: increment(-quantity),
          basePrice: newBasePrice
        });
        transaction.set(holdingRef, {
          companyId,
          companyName: freshCompany.data().name,
          shares: freshCurrentShares + quantity,
          avgCost: Number(freshNextAvg.toFixed(2)),
          lastUpdatedAt: new Date().toISOString()
        }, { merge: true });
      });

      await logHistory(user.uid, `Bought ${quantity} share(s) of ${companyData.name} at $${livePrice.toLocaleString()} each`, "stock");
      alert(`✅ Bought ${quantity} share(s) of ${companyData.name} at $${livePrice.toLocaleString()} each.\nTotal paid: $${totalCost.toLocaleString()}`);
      return;
    }

    // ── SELL ──
    if (action === "sell") {
      const existing = await getDoc(holdingRef);
      if (!existing.exists() || Number(existing.data().shares || 0) < quantity) {
        return alert("You do not own enough shares to sell that amount.");
      }

      // Calculate tax
      const grossProceeds = livePrice * quantity;
      const taxAmount = Number((grossProceeds * SELL_TAX_RATE).toFixed(2));
      const netProceeds = Number((grossProceeds - taxAmount).toFixed(2));

      // Confirm with user showing tax breakdown
      const confirmed = confirm(
        `Sell ${quantity} share(s) of ${companyData.name}?\n\n` +
        `Gross proceeds: $${grossProceeds.toLocaleString()}\n` +
        `Sell tax (10%): -$${taxAmount.toLocaleString()}\n` +
        `You receive:    $${netProceeds.toLocaleString()}`
      );
      if (!confirmed) return;

      await runTransaction(db, async (transaction) => {
        const freshUser = await transaction.get(userRef);
        const freshCompany = await transaction.get(companyRef);
        const freshHolding = await transaction.get(holdingRef);

        if (!freshCompany.exists()) throw new Error("Company not found.");
        if (!freshHolding.exists()) throw new Error("Holding not found.");

        const currentShares = Number(freshHolding.data().shares || 0);
        const nextShares = currentShares - quantity;

        // Credit net proceeds (after tax) to user
        transaction.update(userRef, { balance: increment(netProceeds) });
        transaction.update(companyRef, {
          availableShares: increment(quantity),
          basePrice: newBasePrice
        });

        if (nextShares <= 0) {
          transaction.delete(holdingRef);
        } else {
          transaction.update(holdingRef, {
            shares: nextShares,
            lastUpdatedAt: new Date().toISOString()
          });
        }
      });

      await logHistory(
        user.uid,
        `Sold ${quantity} share(s) of ${companyData.name} at $${livePrice.toLocaleString()} each — received $${netProceeds.toLocaleString()} after 10% tax ($${taxAmount.toLocaleString()} deducted)`,
        "stock"
      );
      alert(
        `✅ Sold ${quantity} share(s) of ${companyData.name}\n\n` +
        `Gross: $${grossProceeds.toLocaleString()}\n` +
        `Tax (10%): -$${taxAmount.toLocaleString()}\n` +
        `Net received: $${netProceeds.toLocaleString()}`
      );
    }
  } catch (err) {
    console.error("Stock trade failed:", err);
    alert("Trade failed: " + err.message);
  }
}

// ==================== DIVIDENDS ====================

/**
 * Checks all holdings for the current user and pays out
 * dividends for any company where 7+ days have passed
 * since the last payout. Called on login/page load.
 * 
 * Payout = shares × (basePrice × dividendRate%)
 * Tax    = 15% deducted from payout
 */
async function processDividends(userId) {
  try {
    const sharesSnap = await getDocs(collection(db, "users", userId, "shares"));
    if (sharesSnap.empty) return;

    const now = new Date();
    const userRef = doc(db, "users", userId);
    const payouts = []; // collect all payouts first

    for (const shareDoc of sharesSnap.docs) {
      const holding = shareDoc.data();
      const companyId = holding.companyId;
      if (!companyId) continue;

      const lastPaid = holding.lastDividendPaidAt ? new Date(holding.lastDividendPaidAt) : null;
      const daysSinceLastPaid = lastPaid
        ? (now - lastPaid) / (1000 * 60 * 60 * 24)
        : DIVIDEND_INTERVAL_DAYS;

      if (daysSinceLastPaid < DIVIDEND_INTERVAL_DAYS) continue;

      const companySnap = await getDoc(doc(db, "stockCompanies", companyId));
      if (!companySnap.exists()) continue;

      const company = companySnap.data();
      const dividendRate = Number(company.dividendRate || 0);
      if (dividendRate <= 0) continue;

      const livePrice = getLivePrice(company);
      const sharesOwned = Number(holding.shares || 0);

      const grossDividend = Number(((dividendRate / 100) * livePrice * sharesOwned).toFixed(2));
      const taxAmount = Number((grossDividend * DIVIDEND_TAX_RATE).toFixed(2));
      const netDividend = Number((grossDividend - taxAmount).toFixed(2));

      if (netDividend <= 0) continue;

      const holdingRef = doc(db, "users", userId, "shares", shareDoc.id);

      await runTransaction(db, async (transaction) => {
        transaction.update(userRef, { balance: increment(netDividend) });
        transaction.update(holdingRef, {
          lastDividendPaidAt: now.toISOString()
        });
      });

      await logHistory(
        userId,
        `Dividend from ${company.name}: $${netDividend.toLocaleString()} received after 15% tax ($${taxAmount.toLocaleString()} deducted) for ${sharesOwned} share(s)`,
        "stock"
      );

      // collect instead of alerting immediately
      payouts.push(
        `${company.name}: +$${netDividend.toLocaleString()} after 15% tax\n` +
        `  (${sharesOwned} shares, gross $${grossDividend.toLocaleString()}, tax -$${taxAmount.toLocaleString()})`
      );
    }

    // one alert summarizing everything
    if (payouts.length > 0) {
      alert(`💰 Dividends Received\n\n${payouts.join("\n\n")}`);
    }
  } catch (err) {
    console.error("Dividend processing failed:", err);
  }
}

// ==================== INIT ====================

export function initStockMarketUI() {
  if (!stockMarketList || !stockPortfolioList) return;

  if (companyUnsubscribe) companyUnsubscribe();
  if (portfolioUnsubscribe) portfolioUnsubscribe();
  if (authUnsubscribe) authUnsubscribe(); // added — cleans up previous auth listener

  companyUnsubscribe = onSnapshot(collection(db, "stockCompanies"), (snapshot) => {
    companies = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    renderStockMarket();
    renderPortfolio();
  }, (err) => console.error("Failed to load stock companies:", err));

  authUnsubscribe = auth.onAuthStateChanged((user) => { // stored at module level now
    if (portfolioUnsubscribe) portfolioUnsubscribe();
    if (!user) {
      holdings = [];
      renderPortfolio();
      return;
    }

    processDividends(user.uid);

    const q = query(collection(db, "users", user.uid, "shares"));
    portfolioUnsubscribe = onSnapshot(q, (snapshot) => {
      holdings = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      renderPortfolio();
    }, (err) => console.error("Failed to load stock portfolio:", err));
  });

  return () => {
    if (authUnsubscribe) authUnsubscribe(); // updated to use module-level var
    if (companyUnsubscribe) companyUnsubscribe();
    if (portfolioUnsubscribe) portfolioUnsubscribe();
  };
}

initStockMarketUI();