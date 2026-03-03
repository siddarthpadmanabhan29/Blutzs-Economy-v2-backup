// ---------- bpsConverter.js ----------
import { db, auth } from "./firebaseConfig.js";
import { doc, updateDoc, increment } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { logHistory } from "./historyManager.js";
import { PLANS } from "./membership_plans.js"; 
import { sendSlackMessage } from "./slackNotifier.js";

// NEW: Shared Source of Truth for Rate Math
import { getLiveMarketRate } from "./economyUtils.js";

const converterSection = document.getElementById("bps-converter-section");
const converterUI = document.getElementById("bps-converter-ui"); 

let currentData = null;

/**
 * Main Render Function
 */
export async function renderBpsConverter(userData) {
    if (!userData || !converterSection) return;
    currentData = userData;

    // --- REAL-TIME RATIO ENGINE SYNC (RESISTANCE MODEL) ---
    // Fetching master rate directly from the centralized utility
    const { rate: liveRate } = await getLiveMarketRate();

    const rateEl = document.getElementById("dynamic-bps-rate");
    if (rateEl) {
        rateEl.textContent = `$${liveRate.toLocaleString()}`;
    }

    // Ensure the section is always visible
    converterSection.classList.remove("hidden");

    const tier = userData.membershipLevel || "standard";
    const hasMembership = tier !== "standard";

    // 1. LOCKED STATE FOR NON-MEMBERS
    if (!hasMembership) {
        converterUI.innerHTML = `
            <div style="text-align: center; padding: 20px; background: rgba(0,0,0,0.2); border-radius: 10px; border: 1px dashed #444;">
                <span style="font-size: 2rem; display: block; margin-bottom: 10px;">🔒</span>
                <p style="color: #d1bce3; font-weight: bold; margin-bottom: 5px;">Feature Locked</p>
                <p style="font-size: 0.8rem; color: #888; margin-bottom: 15px;">Subscribe to a membership plan to unlock BPS to Cash conversion.</p>
                <button onclick="scrollToPlans()" 
                        style="background: #8e44ad; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 0.8rem; font-weight: bold; transition: 0.3s;"
                        onmouseover="this.style.transform='scale(1.05)'" 
                        onmouseout="this.style.transform='scale(1)'">
                    View Plans
                </button>
            </div>
        `;
        return;
    }

    // 2. RESTORE UI STRUCTURE
    if (!document.getElementById("bps-convert-amount")) {
        rebuildConverterUI();
    }

    // 3. MEMBER LOGIC (Limits & Countdown)
    const planConfig = PLANS[tier];
    const weeklyLimit = planConfig.bpsConversionLimit || 25; 
    const convertedThisWeek = userData.bpsConvertedThisWeek || 0;
    const remaining = Math.max(0, weeklyLimit - convertedThisWeek);
    
    const activeRemainingEl = document.getElementById("bps-weekly-remaining");
    const activeConvertBtn = document.getElementById("convert-bps-btn");
    const activeTimerEl = document.getElementById("bps-countdown-timer");

    if (activeRemainingEl) {
        const parentPara = activeRemainingEl.parentElement;
        if (parentPara) {
            parentPara.innerHTML = `Weekly Limit: <strong id="bps-weekly-remaining" style="color: ${remaining <= 0 ? '#e74c3c' : '#2ecc71'}">${remaining}</strong> / ${weeklyLimit} BPS`;
        }
    }

    const lastDateStr = userData.lastBpsConversionDate;
    if (lastDateStr) {
        const lastDate = new Date(lastDateStr);
        const now = new Date();
        const msInWeek = 7 * 24 * 60 * 60 * 1000;
        const timeLeft = (lastDate.getTime() + msInWeek) - now.getTime();

        if (timeLeft <= 0 && convertedThisWeek > 0) {
            resetWeeklyLimit();
            return;
        }

        if (remaining <= 0 && timeLeft > 0) {
            if (activeConvertBtn) activeConvertBtn.disabled = true;
            if (activeTimerEl) {
                activeTimerEl.classList.remove("hidden");
                const days = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
                const hours = Math.floor((timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                activeTimerEl.textContent = `Reset in: ${days}d ${hours}h`;
            }
        } else {
            if (activeConvertBtn) activeConvertBtn.disabled = false;
            if (activeTimerEl) activeTimerEl.classList.add("hidden");
        }
    }
}

/**
 * Rebuilds the HTML structure with dynamic limits
 */
function rebuildConverterUI() {
    const tier = currentData.membershipLevel || "standard";
    const maxLimit = PLANS[tier]?.bpsConversionLimit || 25;

    converterUI.innerHTML = `
        <div style="display: flex; gap: 10px; align-items: flex-end;">
            <div style="flex: 1;">
                <label class="contract-label">Amount to Convert</label>
                <input type="number" id="bps-convert-amount" placeholder="e.g. 10" style="width: 100%; background: #1a1a1a; border: 1px solid #333; color: white; border-radius: 8px; padding: 10px; box-sizing: border-box;">
            </div>
            <button id="convert-bps-btn" class="btn-primary" style="height: 42px; background: #8e44ad; border: none; padding: 0 20px;">Convert</button>
        </div>
        <div style="margin-top: 15px; display: flex; justify-content: space-between; align-items: center;">
            <p style="font-size: 0.8rem; color: #aaa; margin: 0;">Weekly Limit: <strong id="bps-weekly-remaining"></strong> / ${maxLimit} BPS</p>
            <p id="bps-countdown-timer" class="hidden" style="font-size: 0.8rem; color: #e67e22; font-weight: bold;"></p>
        </div>
    `;
}

async function resetWeeklyLimit() {
    try {
        await updateDoc(doc(db, "users", auth.currentUser.uid), {
            bpsConvertedThisWeek: 0
        });
    } catch (err) { console.error("Error resetting BPS limit:", err); }
}

/**
 * Handle Conversion Action
 * UPDATED: Uses the synced rate from the UI to save Quota and ensure accuracy.
 */
async function handleConversion() {
    const input = document.getElementById("bps-convert-amount");
    if (!input) return;

    const amount = parseInt(input.value);
    if (!amount || amount <= 0) return alert("Please enter a valid amount.");
    
    // DATA ENGINEERING OPTIMIZATION: Pull the live rate that was already rendered
    // to ensure transaction price matches the screen perfectly without a new DB read.
    const rateEl = document.getElementById("dynamic-bps-rate");
    const liveRate = parseInt(rateEl.textContent.replace(/[$,]/g, '')) || 500;
    
    const cashValue = amount * liveRate;
    
    const tier = currentData.membershipLevel || "standard";
    const planConfig = PLANS[tier];
    const currentBps = currentData.bpsBalance || 0;
    const convertedThisWeek = currentData.bpsConvertedThisWeek || 0;
    const weeklyLimit = planConfig.bpsConversionLimit || 25;
    
    if (amount > currentBps) return alert("Insufficient BPS balance!");
    if (convertedThisWeek + amount > weeklyLimit) {
        return alert(`Limit reached. You can only convert ${weeklyLimit - convertedThisWeek} more BPS this week.`);
    }

    if (!confirm(`Confirm: Convert ${amount} BPS into $${cashValue.toLocaleString()}?\n(Synced Market Rate: $${liveRate.toLocaleString()} / BPS)`)) return;

    try {
        const userRef = doc(db, "users", auth.currentUser.uid);
        const updates = {
            bpsBalance: increment(-amount),
            balance: increment(cashValue),
            bpsConvertedThisWeek: increment(amount)
        };

        if (convertedThisWeek === 0) {
            updates.lastBpsConversionDate = new Date().toISOString();
        }

        await updateDoc(userRef, updates);
        await logHistory(auth.currentUser.uid, `Exchanged ${amount} BPS for $${cashValue.toLocaleString()} at $${liveRate.toLocaleString()}/BPS`, "transfer-in");
        
        // Slack notification
        const username = currentData.username || "Unknown User";
        const timestamp = new Date().toLocaleString();
        const slackMsg = `💱 *BPS Conversion:* ${username} exchanged ${amount} BPS for *$${cashValue.toLocaleString()}*.\n*Market Rate:* $${liveRate.toLocaleString()}\n*Tier:* ${tier.toUpperCase()}\n*Time:* ${timestamp}`;
        sendSlackMessage(slackMsg);

        alert(`✅ Success! Added $${cashValue.toLocaleString()} to your balance.`);
        input.value = "";
    } catch (err) {
        alert("Conversion failed: " + err.message);
    }
}

document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'convert-bps-btn') {
        handleConversion();
    }
});