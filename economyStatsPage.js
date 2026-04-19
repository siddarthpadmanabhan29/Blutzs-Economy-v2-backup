// ---------- economyStatsPage.js ----------
import { db, auth } from "./firebaseConfig.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { doc, getDoc, collection, getDocs, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { getLiveMarketRate } from "./economyUtils.js";
import { getMarketHistory } from "./economyLogger.js";

let currentBpsMarketRate = 200; 

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

        // Visual Synchronization
        updateStressMeter(econData.volatilityIndex);
        populateSummaryBar(userData, econData);

        const historyDocs = await getMarketHistory(7);

        await Promise.all([
            initSpendingDNAChart(user.uid),
            initWealthChart(econData.globalSupply, historyDocs), // REPLACED Resistance with Wealth
            initBpsChart(econData.rate, historyDocs),
            initTrendingItems() 
        ]);

    } catch (err) {
        console.error("Economy Stats Error:", err);
    } finally {
        if (typeof window.hideStatsLoader === "function") window.hideStatsLoader();
    }
});

// --- HELPER: GET DYNAMIC DATE LABEL ---
function getTodayLabel() {
    const now = new Date();
    return `${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getDate().toString().padStart(2, '0')}`;
}

/**
 * Monitors Admin Resistance Index ($14M to $54M)
 */
function updateStressMeter(adminIndex) {
    const stressFill = document.getElementById("market-stress-fill");
    if (!stressFill) return;

    let percentage = ((adminIndex - 14000000) / 40000000) * 100;
    if (percentage > 100) percentage = 100;
    if (percentage < 0) percentage = 0;

    stressFill.style.width = `${percentage}%`;

    if (adminIndex > 45000000) {
        stressFill.style.background = "#e74c3c"; // Restricted
    } else if (adminIndex < 25000000) {
        stressFill.style.background = "#2ecc71"; // Optimal
    } else {
        stressFill.style.background = "#3498db"; // Stable
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
 * FIXED: BPS Performance Chart
 */
async function initBpsChart(currentRate, historyDocs) {
    let labels = historyDocs.map(d => d.date.split('-').slice(1).join('/'));
    let dataPoints = historyDocs.map(d => d.bpsRate);

    const todayLabel = getTodayLabel();
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
                y: { min: 100, max: 2600, ticks: { color: '#555' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                x: { ticks: { color: '#555' }, grid: { display: false } }
            },
            plugins: { legend: { display: false } }
        }
    });
}

/**
 * NEW: Tracks Global Liquidity (Total Cash + Savings) over time.
 * Replaces the static Resistance chart for better user engagement.
 */
async function initWealthChart(currentWealth, historyDocs) {
    let labels = historyDocs.map(d => d.date.split('-').slice(1).join('/'));
    
    // Pull 'liquidity' (globalSupply) from history logs
    let dataPoints = historyDocs.map(d => d.liquidity || 30000000); 

    const todayLabel = getTodayLabel();
    if (labels.length > 0 && labels[labels.length - 1] === todayLabel) {
        dataPoints[dataPoints.length - 1] = currentWealth;
    } else {
        labels.push(todayLabel);
        dataPoints.push(currentWealth);
    }

    const chartEl = document.getElementById('inflationChart');
    if (chartEl) {
        new Chart(chartEl, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Global Liquidity',
                    data: dataPoints,
                    borderColor: '#3498db',
                    backgroundColor: 'rgba(52, 152, 219, 0.1)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 4
                }]
            },
            options: { 
                plugins: { legend: { display: false } },
                scales: { 
                    y: { 
                        ticks: { 
                            color: '#555',
                            callback: (v) => `$${(v/1000000).toFixed(1)}M` 
                        },
                        grid: { color: 'rgba(255,255,255,0.05)' }
                    },
                    x: { ticks: { color: '#555' }, grid: { display: false } }
                }
            }
        });
    }

    // Keep the "Tip" logic to help explain the Wealth/BPS relationship
    const tipText = document.getElementById("market-tip-text");
    if (tipText) {
        tipText.textContent = "Global wealth directly influences BPS value. As liquidity rises, BPS growth potential increases.";
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

        // Filter items purchased in last 7 days
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const recentItems = items.filter(item => {
            if (!item.lastPurchasedAt) return false;
            const lastPurchase = new Date(item.lastPurchasedAt);
            return lastPurchase >= sevenDaysAgo;
        });

        // Sort by purchaseCount desc
        const topThree = recentItems.sort((a, b) => (b.purchaseCount || 0) - (a.purchaseCount || 0)).slice(0, 3);

        // If less than 3 recent, fill with older trending items
        if (topThree.length < 3) {
            const olderItems = items.filter(item => !recentItems.includes(item))
                .sort((a, b) => (b.purchaseCount || 0) - (a.purchaseCount || 0))
                .slice(0, 3 - topThree.length);
            topThree.push(...olderItems);
        }

        trendingContainer.innerHTML = topThree.map((item, index) => {
            const isUrl = item.image && (item.image.startsWith('http') || item.image.startsWith('https'));
            const displayMedia = isUrl 
                ? `<img src="${item.image}" style="width: 100%; height: 80px; object-fit: contain; border-radius: 8px; margin-bottom: 10px;" onerror="this.src='https://via.placeholder.com/80?text=📦'">` 
                : `<div style="font-size: 2.5rem; margin-bottom: 10px;">${item.image || '📦'}</div>`;

            // Calculate demand velocity based on recency
            let velocity = "LOW";
            if (item.lastPurchasedAt) {
                const lastPurchase = new Date(item.lastPurchasedAt);
                const now = new Date();
                const hoursSince = (now - lastPurchase) / (1000 * 60 * 60);
                if (hoursSince < 24) velocity = "HIGH";
                else if (hoursSince < 168) velocity = "MEDIUM"; // 7 days
            }

            return `
                <div style="background: rgba(255,255,255,0.03); padding: 20px; border-radius: 15px; border: 1px solid rgba(255,255,255,0.05); text-align: center; position: relative; overflow: hidden; display: flex; flex-direction: column; align-items: center;">
                    <span style="position: absolute; top: 10px; left: 10px; background: #f1c40f; color: #000; font-size: 0.7rem; font-weight: 900; padding: 2px 8px; border-radius: 5px; z-index: 2;">#${index+1}</span>
                    ${displayMedia}
                    <h4 style="margin: 5px 0 0; font-size: 1rem; color: #fff; width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${item.name}</h4>
                    <p style="color: #2ecc71; font-weight: bold; margin: 5px 0;">$${(item.cost || 0).toLocaleString()}</p>
                    <div style="font-size: 0.6rem; color: #666; text-transform: uppercase; font-weight: 800;">Demand Velocity: ${velocity}</div>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error("Trending Error:", err);
    }
}