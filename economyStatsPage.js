// ---------- economyStatsPage.js ----------
import { db, auth } from "./firebaseConfig.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { doc, getDoc, collection, getDocs, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { getLiveMarketRate } from "./economyUtils.js";
import { getMarketHistory } from "./economyLogger.js";

let currentBpsMarketRate = 200; // Updated default to match new floor

onAuthStateChanged(auth, async (user) => {
    if (!user) return window.close();

    try {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        const userData = userDoc.data();

        if (!userData || userData.membershipLevel === "standard") {
            alert("Access Denied: Membership required.");
            window.close();
            return;
        }

        // Fetch real-time Resistance Model data
        const econData = await getLiveMarketRate();
        currentBpsMarketRate = econData.rate;

        // UPDATED: Now monitors Resistance Levels
        updateStressMeter(econData.volatilityIndex);
        populateSummaryBar(userData, econData);

        // Fetch history (last 7 days)
        const historyDocs = await getMarketHistory(7);

        await Promise.all([
            initSpendingDNAChart(user.uid),
            initResistanceChart(econData.volatilityIndex, historyDocs), 
            initBpsChart(econData.rate, historyDocs),
            initTrendingItems() 
        ]);

    } catch (err) {
        console.error("Economy Stats Error:", err);
    } finally {
        if (typeof window.hideStatsLoader === "function") window.hideStatsLoader();
    }
});

/**
 * UPDATED: Stress Meter reflects Admin Index range ($14M to $54M)
 */
function updateStressMeter(adminIndex) {
    const stressFill = document.getElementById("market-stress-fill");
    if (!stressFill) return;

    // Scale percentage based on operational range ($14M to $54M)
    let percentage = ((adminIndex - 14000000) / 40000000) * 100;
    if (percentage > 100) percentage = 100;
    if (percentage < 0) percentage = 0;

    stressFill.style.width = `${percentage}%`;

    // Updated colors to match Restricted/Optimal logic
    if (adminIndex > 45000000) {
        stressFill.style.background = "#e74c3c"; // Restricted (Red)
    } else if (adminIndex < 25000000) {
        stressFill.style.background = "#2ecc71"; // Optimal (Green)
    } else {
        stressFill.style.background = "#3498db"; // Stable (Blue)
    }
}

function populateSummaryBar(userData, econData) {
    document.getElementById("stat-total-wealth").textContent = `$${(econData.globalSupply / 1000000).toFixed(1)}M`;
    document.getElementById("stat-bps-rate").textContent = `$${currentBpsMarketRate.toLocaleString()}`;
    document.getElementById("stat-bps-total").textContent = `${econData.totalBps.toLocaleString()} BPS`;
}

async function initSpendingDNAChart(uid) {
    const logsRef = collection(db, "users", uid, "history_logs");
    const q = query(logsRef, orderBy("timestamp", "desc"), limit(100));
    const snapshot = await getDocs(q);
    
    let values = { "Shop": 0, "Loans": 0, "Transfers": 0, "Cosmetics": 0, "Retirement": 0, "BPS": 0, "Other": 0 };

    snapshot.forEach(doc => {
        const data = doc.data();
        const msg = (data.message || "").toLowerCase();
        const amountMatch = msg.match(/\$([\d,]+)/);
        const amount = amountMatch ? parseInt(amountMatch[1].replace(/,/g, '')) : 0;

        if (amount > 0) {
            if (msg.includes("shop") || msg.includes("bought")) values["Shop"] += amount;
            else if (msg.includes("loan") || msg.includes("repaid")) values["Loans"] += amount;
            else if (msg.includes("transfer") || msg.includes("sent")) values["Transfers"] += amount;
            else if (msg.includes("skin") || msg.includes("cosmetic")) values["Cosmetics"] += amount;
            else if (msg.includes("retirement") || msg.includes("savings")) values["Retirement"] += amount;
            else if (msg.includes("bps") || msg.includes("converted")) values["BPS"] += amount;
            else values["Other"] += amount;
        }
    });

    const labels = Object.keys(values).filter(k => values[k] > 0);
    const dataPoints = Object.values(values).filter(v => v > 0);

    new Chart(document.getElementById('spendingPieChart'), {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: dataPoints,
                backgroundColor: ['#2ecc71', '#e67e22', '#3498db', '#9b59b6', '#1abc9c', '#f1c40f', '#95a5a6'],
                borderWidth: 0
            }]
        },
        options: { cutout: '75%', plugins: { legend: { position: 'bottom', labels: { color: '#888', font: { size: 10 } } } } }
    });
}

/**
 * UPDATED: Chart supports $200 floor with visible room at the bottom.
 */
async function initBpsChart(currentRate, historyDocs) {
    let labels = historyDocs.map(d => d.date.split('-').slice(1).join('/'));
    let dataPoints = historyDocs.map(d => d.bpsRate);

    const todayLabel = "03/03";
    if (labels.length > 0 && labels[labels.length - 1] === todayLabel) {
        dataPoints[dataPoints.length - 1] = currentRate;
    } else {
        labels.push(todayLabel);
        dataPoints.push(currentRate);
    }

    new Chart(document.getElementById('bpsValueChart'), {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'BPS Value',
                data: dataPoints,
                borderColor: '#f1c40f',
                backgroundColor: 'rgba(241, 196, 15, 0.1)',
                fill: true,
                tension: 0.4,
                pointRadius: 6,
                pointBackgroundColor: '#f1c40f'
            }]
        },
        options: { 
            scales: { 
                y: { 
                    min: 100, // Room below the $200 floor
                    max: 2600, // Room above the $2500 ceiling
                    ticks: { color: '#555' }, 
                    grid: { color: 'rgba(255,255,255,0.05)' } 
                },
                x: { ticks: { color: '#555' }, grid: { display: false } }
            },
            plugins: { legend: { display: false } }
        }
    });
}

/**
 * UPDATED: Sync labels with "Optimal" and "Restricted" terminology.
 */
async function initResistanceChart(adminIndex, historyDocs) {
    let labels = historyDocs.map(d => d.date.split('-').slice(1).join('/'));
    let dataPoints = historyDocs.map(d => d.volatilityIndex || 34000000);

    const todayLabel = "03/03";
    if (labels.length > 0 && labels[labels.length - 1] === todayLabel) {
        dataPoints[dataPoints.length - 1] = adminIndex;
    } else {
        labels.push(todayLabel);
        dataPoints.push(adminIndex);
    }

    // Professional Terminology Sync
    let healthStatus = "Stable";
    let healthColor = "#3498db";
    let marketTip = "Resistance is balanced. BPS value is stable.";

    if (adminIndex > 45000000) {
        healthStatus = "Restricted"; // High Resistance
        healthColor = "#e74c3c";
        marketTip = "Market friction is high. BPS growth is suppressed.";
    } else if (adminIndex < 25000000) {
        healthStatus = "Optimal"; // Low Resistance
        healthColor = "#2ecc71";
        marketTip = "Market conditions are optimal! BPS value is approaching the ceiling.";
    }

    const healthEl = document.getElementById("market-health-status");
    const healthDot = document.getElementById("market-health-dot");
    const tipContainer = document.getElementById("market-tip-container");
    const tipText = document.getElementById("market-tip-text");

    if (healthEl) { healthEl.textContent = healthStatus; healthEl.style.color = healthColor; }
    if (healthDot) { healthDot.style.backgroundColor = healthColor; }
    if (tipContainer && tipText) {
        tipContainer.style.display = "flex";
        tipText.textContent = marketTip;
    }

    const chartEl = document.getElementById('inflationChart');
    if (chartEl) {
        new Chart(chartEl, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Market Resistance',
                    data: dataPoints,
                    borderColor: healthColor,
                    backgroundColor: `${healthColor}22`,
                    fill: true,
                    tension: 0.3
                }]
            },
            options: { 
                plugins: { legend: { display: false } },
                scales: { 
                    y: { 
                        ticks: { callback: (v) => `$${(v/1000000).toFixed(0)}M` },
                        grid: { color: 'rgba(255,255,255,0.05)' }
                    } 
                }
            }
        });
    }
}

async function initTrendingItems() {
    const trendingContainer = document.getElementById("trending-items-container");
    if (!trendingContainer) return;

    try {
        const shopRef = collection(db, "shop");
        const snapshot = await getDocs(shopRef);
        let items = [];
        snapshot.forEach(doc => items.push({ id: doc.id, ...doc.data() }));

        const topThree = items.sort((a, b) => (b.purchaseCount || 0) - (a.purchaseCount || 0)).slice(0, 3);

        trendingContainer.innerHTML = topThree.map((item, index) => {
            const isUrl = item.image && (item.image.startsWith('http') || item.image.startsWith('https'));
            const displayMedia = isUrl 
                ? `<img src="${item.image}" style="width: 100%; height: 80px; object-fit: contain; border-radius: 8px; margin-bottom: 10px;" onerror="this.src='https://via.placeholder.com/80?text=📦'">` 
                : `<div style="font-size: 2.5rem; margin-bottom: 10px;">${item.image || '📦'}</div>`;

            return `
                <div style="background: rgba(255,255,255,0.03); padding: 20px; border-radius: 15px; border: 1px solid rgba(255,255,255,0.05); text-align: center; position: relative; overflow: hidden; display: flex; flex-direction: column; align-items: center;">
                    <span style="position: absolute; top: 10px; left: 10px; background: #f1c40f; color: #000; font-size: 0.7rem; font-weight: 900; padding: 2px 8px; border-radius: 5px; z-index: 2;">#${index+1}</span>
                    ${displayMedia}
                    <h4 style="margin: 5px 0 0; font-size: 1rem; color: #fff; width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${item.name}</h4>
                    <p style="color: #2ecc71; font-weight: bold; margin: 5px 0;">$${(item.cost || 0).toLocaleString()}</p>
                    <div style="font-size: 0.6rem; color: #666; text-transform: uppercase; font-weight: 800;">Demand Velocity: HIGH</div>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error("Trending Error:", err);
    }
}