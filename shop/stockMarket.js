console.log("stockMarket.js loaded");

import { db, auth } from "../firebaseConfig.js";
import {
  collection,
  onSnapshot,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
  limit,
  where,
  runTransaction,
  increment,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  addDoc
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { logHistory } from "../historyManager.js";
import { logAdminAction } from "../admin/adminUtils.js";

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
const MIN_STOCK_PRICE = 0; // allow exact zero so losses can reach -100%
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function getEstDate(value = new Date()) {
  const now = new Date(value);
  const estOffset = now.getTime() + (now.getTimezoneOffset() * 60000) - (5 * 3600000);
  return new Date(estOffset);
}

function startOfEstDay(value = new Date()) {
  const estDate = getEstDate(value);
  estDate.setHours(0, 0, 0, 0);
  return estDate;
}

function formatChartDate(value, includeTime = false) {
  const date = getEstDate(value);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  if (!includeTime) {
    return `${month}/${day}`;
  }

  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 || 12;
  return `${month}/${day} ${displayHour}:${minutes} ${suffix}`;
}

function formatMidnightDate(value) {
  const date = getEstDate(value);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}/${day} 12:00 AM`;
}

function formatDateTimeLabel(value) {
  const date = getEstDate(value);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 || 12;
  return `${month}/${day} ${displayHour}:${minutes} ${suffix}`;
}

function getSnapshotRangeForTimeframe(timeframe) {
  const now = new Date();
  const startToday = startOfEstDay(now);

  switch (timeframe) {
    case 'daily':
      return { start: startToday, end: new Date(now) };
    case 'weekly':
      return { start: new Date(startToday.getTime() - (6 * DAY_MS)), end: new Date(now) };
    case 'monthly':
      return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: new Date(now) };
    case 'yearly':
      return { start: new Date(now.getFullYear() - 1, now.getMonth(), 1), end: new Date(now) };
    default:
      return { start: startToday, end: new Date(now) };
  }
}

function isSameEstDay(left, right) {
  return getEstDate(left).toDateString() === getEstDate(right).toDateString();
}

function isSameEstMonth(left, right) {
  const leftDate = getEstDate(left);
  const rightDate = getEstDate(right);
  return leftDate.getFullYear() === rightDate.getFullYear() && leftDate.getMonth() === rightDate.getMonth();
}

function groupHistoryByDay(history) {
  const grouped = new Map();

  history.forEach((entry) => {
    const entryDate = getEstDate(entry.timestamp);
    const key = `${entryDate.getFullYear()}-${String(entryDate.getMonth() + 1).padStart(2, '0')}-${String(entryDate.getDate()).padStart(2, '0')}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(entry);
  });

  return Array.from(grouped.values()).map((entries) => {
    const sorted = [...entries].sort((left, right) => left.timestamp - right.timestamp);
    const first = sorted[0];
    const closing = sorted[sorted.length - 1]; // last snapshot of the day = closing price
    return {
      date: formatMidnightDate(first.timestamp),
      price: Number(closing.price || 0),
      timestamp: first.timestamp,
      tooltipLabel: formatMidnightDate(first.timestamp),
    };
  }).sort((left, right) => left.timestamp - right.timestamp);
}

function groupHistoryByMonth(history) {
  const grouped = new Map();

  history.forEach((entry) => {
    const entryDate = getEstDate(entry.timestamp);
    const key = `${entryDate.getFullYear()}-${String(entryDate.getMonth() + 1).padStart(2, '0')}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(entry);
  });

  return Array.from(grouped.entries()).map(([key, entries]) => {
    const [year, month] = key.split('-').map(Number);
    const sorted = [...entries].sort((left, right) => left.timestamp - right.timestamp);
    const closing = sorted[sorted.length - 1]; // last snapshot of the month = closing price
    const monthDate = new Date(year, month - 1, 1, 0, 0, 0, 0);

    return {
      date: `${MONTH_NAMES[month - 1]} 12:00 AM`,
      price: Number(closing.price || 0),
      timestamp: monthDate.getTime(),
      tooltipLabel: `${MONTH_NAMES[month - 1]} ${year} 12:00 AM`,
    };
  }).sort((left, right) => left.timestamp - right.timestamp);
}

// ==================== PRICE LOGIC ====================

function getLivePrice(company) {
  const base = Number(company.basePrice || 0);
  const trend = Number(company.marketTrend || 0) / 100;
  const live = base * (1 + trend);
  return Math.max(MIN_STOCK_PRICE, Number(live.toFixed(2)));
}

function calculatePriceImpact(company, quantity, action) {
  const totalShares = Number(company.availableShares || 0) + quantity;
  const currentBase = Number(company.basePrice || 0);
  const tradeFraction = totalShares > 0 ? quantity / totalShares : 0;
  const maxImpact = 0.05;
  const impactPct = Math.min(tradeFraction, maxImpact);
  const direction = action === "buy" ? 1 : -1;
  const newBase = currentBase * (1 + direction * impactPct);
  return Math.max(MIN_STOCK_PRICE, Number(newBase.toFixed(2)));
}

function formatDelta(price, base) {
  const delta = price - base;
  const pct = base > 0 ? (delta / base) * 100 : 0;
  return { delta, pct };
}

function syncCompanyState(companyId, updater) {
  companies = companies.map((company) => {
    if (company.id !== companyId) return company;
    return updater(company);
  });
}

function syncHoldingState(companyId, updater) {
  holdings = holdings
    .map((holding) => {
      if (holding.companyId !== companyId) return holding;
      const nextHolding = updater(holding);
      return nextHolding;
    })
    .filter(Boolean);
}

// ==================== CHART & HISTORY ====================

// Record price snapshot to Firestore whenever price changes
export async function recordPriceSnapshot(companyId, price) {
  try {
    const historyRef = collection(db, "stockCompanies", companyId, "priceHistory");
    await addDoc(historyRef, {
      price: Number(price.toFixed(2)),
      date: new Date().toISOString().split('T')[0],
      timestamp: new Date().getTime()
    });
  } catch (err) {
    console.error("Failed to record price snapshot:", err);
  }
}

async function getPriceHistoryFromFirestore(companyId) {
  try {
    const historyRef = collection(db, "stockCompanies", companyId, "priceHistory");
    const q = query(historyRef, orderBy("timestamp", "asc"), limit(500));
    const snapshot = await getDocs(q);

    const history = [];
    snapshot.forEach((docSnap) => {
      history.push(docSnap.data());
    });

    return history;
  } catch (err) {
    console.error("Failed to fetch price history:", err);
    return [];
  }
}

async function getHistoryByTimeframe(company, timeframe = 'daily') {
  const history = await getPriceHistoryFromFirestore(company.id);
  const now = new Date();
  const range = getSnapshotRangeForTimeframe(timeframe);

  const filtered = history.filter((entry) => {
    const timestamp = new Date(entry.timestamp);
    return timestamp >= range.start && timestamp <= range.end;
  });

  switch (timeframe) {
    case 'daily':
      return filtered
        .filter((entry) => isSameEstDay(entry.timestamp, now))
        .map((entry) => ({
          date: formatDateTimeLabel(entry.timestamp),
          price: Number(entry.price || 0),
          timestamp: entry.timestamp,
          tooltipLabel: formatDateTimeLabel(entry.timestamp),
        }));

    case 'weekly':
      return filtered.map((entry) => ({
        date: formatDateTimeLabel(entry.timestamp),
        price: Number(entry.price || 0),
        timestamp: entry.timestamp,
        tooltipLabel: formatDateTimeLabel(entry.timestamp),
      }));

    case 'monthly':
      return groupHistoryByDay(filtered.filter((entry) => isSameEstMonth(entry.timestamp, now)));

    case 'yearly':
      return groupHistoryByMonth(filtered);

    default:
      return [];
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

const chartInstancesByContainer = new Map();

function renderPriceChart(company, containerId, initialTimeframe = 'daily') {
  const container = document.getElementById(containerId);
  if (!container) return;

  // Make it async to load real data
  (async () => {
    const data = await getHistoryByTimeframe(company, initialTimeframe);
    const stats = calculateChartStats(data);
    const isPositive = stats.change >= 0;

    const labels = data.map(d => d.date);
    const prices = data.map(d => d.price);
    const tooltipLabels = data.map(d => d.tooltipLabel || d.date);

    if (labels.length === 0) {
      container.innerHTML = '<p style="color: #888; text-align: center; padding: 20px; font-size: 0.75rem;">No price data yet. Check back after trading begins.</p>';
      return;
    }

    // Destroy the chart instance previously attached to this container, if any
    const existingChart = chartInstancesByContainer.get(containerId);
    if (existingChart) {
      existingChart.destroy();
      chartInstancesByContainer.delete(containerId);
    }

    const canvas = document.createElement('canvas');
    container.innerHTML = '';
    container.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    const chartInstance = new Chart(ctx, {
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
        maintainAspectRatio: false,
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
              title: (context) => tooltipLabels[context[0].dataIndex] || context[0].label,
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

    chartInstancesByContainer.set(containerId, chartInstance);
  })();
}

// ==================== RENDER ====================

function renderStockMarket() {
  if (!stockMarketList) return;

  if (companies.length === 0) {
    stockMarketList.innerHTML = "<p style='color: gray; font-style: italic; text-align: center; padding: 20px;'>No public companies are available yet.</p>";
    return;
  }

  stockMarketList.innerHTML = companies.map((company) => {
    const livePrice = (company.isBankrupt || Number(company.basePrice || 0) <= MIN_STOCK_PRICE) ? 0 : getLivePrice(company);
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
            ${company.isBankrupt ? `Status<br><strong style="color: #e74c3c; font-size: 1rem;">Bankrupt</strong>` : `Live Price<br><strong style="color: #f1c40f; font-size: 1rem;">$${livePrice.toLocaleString()}</strong>`}
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
            ${company.isBankrupt ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''}
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
    const livePrice = (company.isBankrupt || Number(company.basePrice || 0) <= MIN_STOCK_PRICE) ? 0 : getLivePrice(company);
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

    const totalInvested = avgCost * sharesOwned;
    const currentValue = company.isBankrupt ? 0 : livePrice * sharesOwned;
    const gainLoss = currentValue - totalInvested;

    return `
      <article class="portfolio-card" style="background: rgba(46,204,113,0.08); border: 1px solid ${positive ? '#2ecc71' : '#e74c3c'}; border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 6px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 150px;">
            <h4 style="margin: 0; color: #fff; font-size: 0.95rem; word-break: break-word;">${company.name || item.companyId} ${company.isBankrupt ? '<span style="color:#e74c3c; font-weight:800; font-size:0.8rem; margin-left:8px;">(Bankrupt)</span>' : ''}</h4>
            <p style="margin: 2px 0 0 0; color: #aaa; font-size: 0.72rem; word-break: break-word;">${sharesOwned} share(s) @ avg $${avgCost.toLocaleString()} each</p>
          </div>
          <span style="color: ${positive ? '#2ecc71' : '#e74c3c'}; font-size: 0.75rem; font-weight: 800; white-space: nowrap; flex-shrink: 0;">
            ${positive ? '+' : ''}$${profit.toLocaleString()} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)
          </span>
        </div>

        <div style="font-size: 0.75rem; color: #ddd; display: grid; gap: 6px; word-break: break-word;">
          <div>Initial investment: <strong style="color: #f1c40f;">$${totalInvested.toLocaleString()}</strong></div>
          <div>Current value: <strong style="color: #f1c40f;">$${currentValue.toLocaleString()}</strong></div>
          <div>Gain/Loss: <strong style="color: ${positive ? '#2ecc71' : '#e74c3c'};">${gainLoss >= 0 ? '+' : ''}$${gainLoss.toLocaleString()}</strong></div>
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

  // Make it async to load real data
  (async () => {
    const data = await getHistoryByTimeframe(company, timeframe);
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
  })();
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
      const livePrice = (companyData.isBankrupt || Number(companyData.basePrice || 0) <= MIN_STOCK_PRICE) ? 0 : getLivePrice(companyData);
    const totalCost = livePrice * quantity;
    const newBasePrice = calculatePriceImpact(companyData, quantity, action);
      const willBankrupt = newBasePrice <= MIN_STOCK_PRICE;

    // ── BUY ──
    if (action === "buy") {
      if (companyData.isBankrupt) return alert("Cannot buy shares: company is bankrupt/delisted.");
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
          availableShares: willBankrupt ? 0 : increment(-quantity),
          basePrice: willBankrupt ? MIN_STOCK_PRICE : newBasePrice,
          isBankrupt: willBankrupt
        });
        transaction.set(holdingRef, {
          companyId,
          companyName: freshCompany.data().name,
          shares: freshCurrentShares + quantity,
          avgCost: Number(freshNextAvg.toFixed(2)),
          lastUpdatedAt: new Date().toISOString()
        }, { merge: true });
      });

      syncCompanyState(companyId, (company) => ({
        ...company,
        availableShares: willBankrupt ? 0 : Math.max(0, Number(company.availableShares || 0) - quantity),
        basePrice: willBankrupt ? MIN_STOCK_PRICE : newBasePrice,
        isBankrupt: willBankrupt,
      }));

      const existingHolding = holdings.find((holding) => holding.companyId === companyId);
      if (existingHolding) {
        syncHoldingState(companyId, (holding) => ({
          ...holding,
          shares: Number(holding.shares || 0) + quantity,
          avgCost: Number(((Number(holding.avgCost || 0) * Number(holding.shares || 0)) + totalCost) / (Number(holding.shares || 0) + quantity)).toFixed(2),
          lastUpdatedAt: new Date().toISOString(),
        }));
      } else {
        holdings = [
          ...holdings,
          {
            id: companyId,
            companyId,
            companyName: companyData.name,
            shares: quantity,
            avgCost: Number(livePrice.toFixed(2)),
            lastUpdatedAt: new Date().toISOString(),
          },
        ];
      }

      renderStockMarket();
      renderPortfolio();

      await recordPriceSnapshot(companyId, newBasePrice);
      await logHistory(user.uid, `Bought ${quantity} share(s) of ${companyData.name} at $${livePrice.toLocaleString()} each`, "stock");
      if (willBankrupt) {
        try {
          await logAdminAction(user.uid, `Company ${companyData.name} declared BANKRUPT after trade by ${user.uid}`);
        } catch (err) {
          console.error("Failed to log bankruptcy action:", err);
        }
      }
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
          availableShares: willBankrupt ? 0 : increment(quantity),
          basePrice: willBankrupt ? MIN_STOCK_PRICE : newBasePrice,
          isBankrupt: willBankrupt
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

      syncCompanyState(companyId, (company) => ({
        ...company,
        availableShares: willBankrupt ? 0 : Number(company.availableShares || 0) + quantity,
        basePrice: willBankrupt ? MIN_STOCK_PRICE : newBasePrice,
        isBankrupt: willBankrupt,
      }));

      syncHoldingState(companyId, (holding) => {
        const nextShares = Number(holding.shares || 0) - quantity;
        if (nextShares <= 0) return null;
        return {
          ...holding,
          shares: nextShares,
          lastUpdatedAt: new Date().toISOString(),
        };
      });

      renderStockMarket();
      renderPortfolio();

      await recordPriceSnapshot(companyId, newBasePrice);
      await logHistory(
        user.uid,
        `Sold ${quantity} share(s) of ${companyData.name} at $${livePrice.toLocaleString()} each — received $${netProceeds.toLocaleString()} after 10% tax ($${taxAmount.toLocaleString()} deducted)`,
        "stock"
      );
      if (willBankrupt) {
        try {
          await logAdminAction(user.uid, `Company ${companyData.name} declared BANKRUPT after trade by ${user.uid}`);
        } catch (err) {
          console.error("Failed to log bankruptcy action:", err);
        }
      }
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

  if (authUnsubscribe) authUnsubscribe(); // added — cleans up previous auth listener

  authUnsubscribe = auth.onAuthStateChanged(async (user) => { // stored at module level now
    if (!user) {
      companies = [];
      holdings = [];
      renderStockMarket();
      renderPortfolio();
      return;
    }

    const [companySnapshot, holdingSnapshot] = await Promise.all([
      getDocs(collection(db, "stockCompanies")),
      getDocs(query(collection(db, "users", user.uid, "shares"))),
    ]);

    companies = companySnapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    holdings = holdingSnapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    renderStockMarket();
    renderPortfolio();

    processDividends(user.uid);
  });

  return () => {
    if (authUnsubscribe) authUnsubscribe(); // updated to use module-level var
  };
}

initStockMarketUI();