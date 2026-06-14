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

// ==================== CHART & HISTORY ====================

// Store price history in memory (in production, store in Firestore)
const priceHistory = new Map();

function generatePriceHistory(company) {
  if (priceHistory.has(company.id)) return priceHistory.get(company.id);

  const basePrice = Number(company.basePrice || 0);
  const now = new Date();
  const history = [];

  // Generate 365 days of historical data
  for (let i = 365; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);

    // Generate realistic price movement (random walk)
    const randomChange = (Math.random() - 0.48) * 0.05; // Slight upward bias
    const volatility = Number(company.volatility || 0.02);
    const dailyPrice = basePrice * (1 + randomChange * volatility);
    
    history.push({
      date: date.toISOString().split('T')[0],
      price: Math.max(1, Number(dailyPrice.toFixed(2))),
      timestamp: date.getTime()
    });
  }

  priceHistory.set(company.id, history);
  return history;
}

function getHistoryByTimeframe(company, timeframe = 'daily') {
  const history = generatePriceHistory(company);
  const now = new Date();
  const data = [];

  switch (timeframe) {
    case 'daily':
      // Last 30 days
      return history.slice(-30);

    case 'weekly':
      // Last 52 weeks, aggregated
      const weeklyData = [];
      for (let i = 51; i >= 0; i--) {
        const weekEnd = new Date(now);
        weekEnd.setDate(weekEnd.getDate() - (i * 7));
        
        const weekStart = new Date(weekEnd);
        weekStart.setDate(weekStart.getDate() - 7);

        const weekPrices = history.filter(h => {
          const hDate = new Date(h.timestamp);
          return hDate >= weekStart && hDate <= weekEnd;
        });

        if (weekPrices.length > 0) {
          const avgPrice = weekPrices.reduce((sum, h) => sum + h.price, 0) / weekPrices.length;
          weeklyData.push({
            date: `Week ${51 - i + 1}`,
            price: Number(avgPrice.toFixed(2)),
            timestamp: weekEnd.getTime()
          });
        }
      }
      return weeklyData;

    case 'monthly':
      // Last 12 months, aggregated
      const monthlyData = [];
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      
      for (let i = 11; i >= 0; i--) {
        const monthEnd = new Date(now);
        monthEnd.setMonth(monthEnd.getMonth() - i);
        
        const monthStart = new Date(monthEnd);
        monthStart.setDate(1);

        const monthPrices = history.filter(h => {
          const hDate = new Date(h.timestamp);
          return hDate >= monthStart && hDate <= monthEnd;
        });

        if (monthPrices.length > 0) {
          const avgPrice = monthPrices.reduce((sum, h) => sum + h.price, 0) / monthPrices.length;
          monthlyData.push({
            date: monthNames[monthEnd.getMonth()],
            price: Number(avgPrice.toFixed(2)),
            timestamp: monthEnd.getTime()
          });
        }
      }
      return monthlyData;

    case 'yearly':
      // Last 5 years, aggregated
      const yearlyData = [];
      for (let i = 4; i >= 0; i--) {
        const yearEnd = new Date(now);
        yearEnd.setFullYear(yearEnd.getFullYear() - i);
        
        const yearStart = new Date(yearEnd);
        yearStart.setFullYear(yearStart.getFullYear() - 1);

        const yearPrices = history.filter(h => {
          const hDate = new Date(h.timestamp);
          return hDate >= yearStart && hDate <= yearEnd;
        });

        if (yearPrices.length > 0) {
          const avgPrice = yearPrices.reduce((sum, h) => sum + h.price, 0) / yearPrices.length;
          yearlyData.push({
            date: yearEnd.getFullYear().toString(),
            price: Number(avgPrice.toFixed(2)),
            timestamp: yearEnd.getTime()
          });
        }
      }
      return yearlyData;

    default:
      return history.slice(-30);
  }
}

function calculateChartStats(data) {
  if (!data || data.length === 0) return { min: 0, max: 0, avg: 0, change: 0, changePercent: 0 };

  const prices = data.map(d => d.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  const change = prices[prices.length - 1] - prices[0];
  const changePercent = prices[0] > 0 ? (change / prices[0]) * 100 : 0;

  return {
    min: Number(min.toFixed(2)),
    max: Number(max.toFixed(2)),
    avg: Number(avg.toFixed(2)),
    change: Number(change.toFixed(2)),
    changePercent: Number(changePercent.toFixed(2))
  };
}

function renderPriceChart(company, containerId, initialTimeframe = 'daily') {
  const container = document.getElementById(containerId);
  if (!container) return;

  const data = getHistoryByTimeframe(company, initialTimeframe);
  const stats = calculateChartStats(data);
  const isPositive = stats.change >= 0;

  const labels = data.map(d => d.date);
  const prices = data.map(d => d.price);

  // Destroy existing chart if it exists
  const existingCanvas = container.querySelector('canvas');
  if (existingCanvas && window.Chart?.helpers?.canvases) {
    const chartInstance = Chart.helpers.canvases.find(c => c === existingCanvas);
    if (chartInstance?.instance) chartInstance.instance.destroy();
  }

  const canvas = document.createElement('canvas');
  container.innerHTML = '';
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: `${company.name} Price`,
        data: prices,
        borderColor: isPositive ? '#2ecc71' : '#e74c3c',
        backgroundColor: isPositive ? 'rgba(46, 204, 113, 0.1)' : 'rgba(231, 76, 60, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: 3,
        pointBackgroundColor: isPositive ? '#2ecc71' : '#e74c3c',
        pointBorderColor: '#fff',
        pointBorderWidth: 1,
        pointHoverRadius: 5,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(0,0,0,0.8)',
          titleColor: '#fff',
          bodyColor: '#ddd',
          borderColor: isPositive ? '#2ecc71' : '#e74c3c',
          borderWidth: 1,
          padding: 8,
          displayColors: false,
          callbacks: {
            label: (context) => `$${Number(context.parsed.y).toFixed(2)}`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: false,
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#aaa', callback: (val) => `$${val.toFixed(2)}` }
        },
        x: {
          grid: { display: false },
          ticks: { color: '#aaa', maxTicksLimit: 10 }
        }
      }
    }
  });
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
      <article class="stock-card" style="background: rgba(0,0,0,0.25); border: 1px solid ${delta >= 0 ? '#2ecc71' : '#e74c3c'}; border-radius: 14px; padding: 16px; display: flex; flex-direction: column; gap: 10px;">
        <div style="display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 200px;">
            <h4 style="margin: 0 0 4px 0; color: #fff; font-size: 1rem; word-break: break-word;">${company.name}</h4>
            <p style="margin: 0; color: #aaa; font-size: 0.75rem; word-break: break-word;">${company.description || "Public company listed for investor trading."}</p>
          </div>
          <span style="background: rgba(52,152,219,0.12); color: #3498db; border: 1px solid rgba(52,152,219,0.2); border-radius: 999px; padding: 4px 8px; font-size: 0.65rem; font-weight: 800; text-transform: uppercase; white-space: nowrap; flex-shrink: 0;">${ownerLabel}</span>
        </div>

        <div class="stock-info-grid" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; font-size: 0.75rem; color: #ddd;">
          <div style="background: rgba(255,255,255,0.04); border-radius: 10px; padding: 10px; min-width: 0;">
            Live Price<br><strong style="color: #f1c40f; font-size: 1rem;">$${livePrice.toLocaleString()}</strong>
          </div>
          <div style="background: rgba(255,255,255,0.04); border-radius: 10px; padding: 10px; min-width: 0;">
            Market Change<br><strong style="color: ${changeClass}; font-size: 1rem;">${delta >= 0 ? '+' : ''}$${delta.toFixed(2)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)</strong>
          </div>
          <div style="background: rgba(255,255,255,0.04); border-radius: 10px; padding: 10px; min-width: 0;">
            Shares Available<br><strong style="color: #2ecc71; font-size: 1rem;">${availableShares}</strong>
          </div>
          <div style="background: rgba(255,255,255,0.04); border-radius: 10px; padding: 10px; min-width: 0;">
            Dividend Yield<br><strong style="color: #8e44ad; font-size: 1rem;">${Number(company.dividendRate || 0)}%</strong>
            <span style="display: block; font-size: 0.6rem; color: #888;">Paid weekly · 15% tax</span>
          </div>
        </div>

        <!-- CHART SECTION -->
        <div style="background: rgba(0,0,0,0.3); border-radius: 10px; padding: 12px; border: 1px solid rgba(255,255,255,0.05);">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap;">
            <span style="color: #aaa; font-size: 0.7rem; text-transform: uppercase; font-weight: 800;">Performance</span>
            <div class="chart-timeframe-buttons" style="display: flex; gap: 6px; flex-wrap: wrap;">
              <button class="chart-btn chart-btn-daily" data-company-id="${company.id}" data-timeframe="daily" style="background: rgba(46,204,113,0.2); color: #2ecc71; border: 1px solid rgba(46,204,113,0.3); border-radius: 6px; padding: 4px 10px; font-size: 0.65rem; font-weight: 700; cursor: pointer; transition: all 0.2s;">D</button>
              <button class="chart-btn chart-btn-weekly" data-company-id="${company.id}" data-timeframe="weekly" style="background: rgba(255,255,255,0.05); color: #aaa; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 4px 10px; font-size: 0.65rem; font-weight: 700; cursor: pointer; transition: all 0.2s;">W</button>
              <button class="chart-btn chart-btn-monthly" data-company-id="${company.id}" data-timeframe="monthly" style="background: rgba(255,255,255,0.05); color: #aaa; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 4px 10px; font-size: 0.65rem; font-weight: 700; cursor: pointer; transition: all 0.2s;">M</button>
              <button class="chart-btn chart-btn-yearly" data-company-id="${company.id}" data-timeframe="yearly" style="background: rgba(255,255,255,0.05); color: #aaa; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 4px 10px; font-size: 0.65rem; font-weight: 700; cursor: pointer; transition: all 0.2s;">Y</button>
            </div>
          </div>
          <div id="chart-container-${company.id}" style="position: relative; height: 200px; width: 100%;"></div>
          <div id="chart-stats-${company.id}" class="chart-stats" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-top: 10px; font-size: 0.7rem; color: #aaa;"></div>
        </div>

        <div style="background: rgba(231,76,60,0.06); border: 1px solid rgba(231,76,60,0.15); border-radius: 8px; padding: 8px 12px; font-size: 0.7rem; color: #e74c3c; word-break: break-word;">
          ⚠️ Sell Tax: 10% deducted from proceeds (~$${estimatedSellTax.toFixed(2)} per share at current price)
        </div>

        <div class="stock-action-row" style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
          <input id="stock-qty-${company.id}" type="number" min="1" max="${availableShares}" value="1"
            style="flex: 1; min-width: 70px; background: #111; color: #fff; border: 1px solid #333; border-radius: 8px; padding: 8px 10px; font-size: 0.85rem; box-sizing: border-box;" />
          <button class="stock-buy-btn" data-company-id="${company.id}" data-price="${livePrice}"
            style="background: #2ecc71; color: #fff; border: none; border-radius: 8px; padding: 8px 12px; font-weight: 800; cursor: pointer; white-space: nowrap;">Buy</button>
          <button class="stock-sell-btn" data-company-id="${company.id}" data-price="${livePrice}"
            style="background: #e74c3c; color: #fff; border: none; border-radius: 8px; padding: 8px 12px; font-weight: 800; cursor: pointer; white-space: nowrap;">Sell</button>
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
      <article class="portfolio-card" style="background: rgba(46,204,113,0.08); border: 1px solid ${positive ? '#2ecc71' : '#e74c3c'}; border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 6px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 150px;">
            <h4 style="margin: 0; color: #fff; font-size: 0.95rem; word-break: break-word;">${company.name || item.companyId}</h4>
            <p style="margin: 2px 0 0 0; color: #aaa; font-size: 0.72rem; word-break: break-word;">${sharesOwned} share(s) @ avg $${avgCost.toLocaleString()} each</p>
          </div>
          <span style="color: ${positive ? '#2ecc71' : '#e74c3c'}; font-size: 0.75rem; font-weight: 800; white-space: nowrap; flex-shrink: 0;">
            ${positive ? '+' : ''}$${profit.toLocaleString()} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)
          </span>
        </div>

        <div style="font-size: 0.75rem; color: #ddd; word-break: break-word;">
          Live value: <strong style="color: #f1c40f;">$${(livePrice * sharesOwned).toLocaleString()}</strong>
        </div>

        ${dividendRate > 0 ? `
          <div style="background: rgba(142,68,173,0.08); border: 1px solid rgba(142,68,173,0.2); border-radius: 8px; padding: 8px 10px; font-size: 0.7rem; color: #ccc; word-break: break-word;">
            💰 Next dividend: <strong style="color: #8e44ad;">$${estimatedDividendAfterTax.toFixed(2)}</strong> after 15% tax
            <span style="color: #888; display: block; margin-top: 3px;">(in ${daysUntilNext} day${daysUntilNext === 1 ? '' : 's'})</span>
          </div>
        ` : ''}
      </article>
    `;
  }).join("");
}

// ==================== TRADE BUTTONS ====================

function updateChartStats(company, timeframe) {
  const statsContainer = document.getElementById(`chart-stats-${company.id}`);
  if (!statsContainer) return;

  const data = getHistoryByTimeframe(company, timeframe);
  const stats = calculateChartStats(data);
  
  statsContainer.innerHTML = `
    <div style="padding: 8px; background: rgba(255,255,255,0.02); border-radius: 6px; border: 1px solid rgba(255,255,255,0.05);">
      Min: <strong style="color: #aaa;">$${stats.min}</strong>
    </div>
    <div style="padding: 8px; background: rgba(255,255,255,0.02); border-radius: 6px; border: 1px solid rgba(255,255,255,0.05);">
      Max: <strong style="color: #aaa;">$${stats.max}</strong>
    </div>
    <div style="padding: 8px; background: rgba(255,255,255,0.02); border-radius: 6px; border: 1px solid rgba(255,255,255,0.05);">
      Avg: <strong style="color: #aaa;">$${stats.avg}</strong>
    </div>
    <div style="padding: 8px; background: rgba(255,255,255,0.02); border-radius: 6px; border: 1px solid rgba(255,255,255,0.05);">
      Change: <strong style="color: ${stats.change >= 0 ? '#2ecc71' : '#e74c3c'};">${stats.change >= 0 ? '+' : ''}$${stats.change} (${stats.changePercent >= 0 ? '+' : ''}${stats.changePercent}%)</strong>
    </div>
  `;
}

function attachTradeButtons() {
  // Initialize charts
  companies.forEach((company) => {
    renderPriceChart(company, `chart-container-${company.id}`, 'daily');
    updateChartStats(company, 'daily');
  });

  // Attach chart timeframe button listeners
  document.querySelectorAll(".chart-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const companyId = btn.dataset.companyId;
      const timeframe = btn.dataset.timeframe;
      const company = companies.find(c => c.id === companyId);
      
      if (company) {
        // Update active button styling
        const buttonGroup = btn.parentElement;
        buttonGroup.querySelectorAll(".chart-btn").forEach(b => {
          b.style.background = "rgba(255,255,255,0.05)";
          b.style.color = "#aaa";
          b.style.borderColor = "rgba(255,255,255,0.1)";
        });
        btn.style.background = "rgba(46,204,113,0.2)";
        btn.style.color = "#2ecc71";
        btn.style.borderColor = "rgba(46,204,113,0.3)";
        
        // Render new chart
        renderPriceChart(company, `chart-container-${company.id}`, timeframe);
        updateChartStats(company, timeframe);
      }
    });
  });

  // Attach buy/sell buttons
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