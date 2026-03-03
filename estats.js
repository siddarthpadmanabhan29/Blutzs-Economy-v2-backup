// ---------- estats.js ----------
import { getLiveMarketRate } from "./economyUtils.js";

const statsTeaserUI = document.getElementById("estats-lock-ui");

export async function renderStatsTeaser(userData) {
    if (!statsTeaserUI) return;

    const tier = userData.membershipLevel || "standard";
    const isMember = tier !== "standard";

    // 1. LOCKED STATE (Standard Users)
    if (!isMember) {
        statsTeaserUI.innerHTML = `
            <p style="font-size: 0.85rem; color: #888; margin-bottom: 12px; line-height: 1.4;">
                Unlock deep market insights, resistance tracking, and personal spending DNA.
            </p>
            <div style="margin-bottom: 15px; opacity: 0.4; filter: grayscale(1); font-size: 1.5rem; letter-spacing: 10px;">
                📈 🥧 📉
            </div>
            <button onclick="scrollToPlans()" class="btn-secondary" style="font-size: 0.75rem; font-weight: bold; padding: 8px 16px;">
                🔒 Unlock with Membership
            </button>
        `;
        return;
    }

    // 2. LOADING STATE
    statsTeaserUI.innerHTML = `<p style="font-size: 0.85rem; color: #555;">Syncing Intelligence...</p>`;

    try {
        // 3. UNLOCKED STATE (Premium Intelligence)
        // Destructuring 'rate' to show current purchasing power
        const { globalSupply, volatilityIndex, rate } = await getLiveMarketRate();
        
        // --- RESISTANCE MODEL LOGIC (Synced Terminology) ---
        let healthText = "Stable";
        let healthColor = "#3498db"; // Blue
        
        if (volatilityIndex > 45000000) {
            healthText = "Restricted"; // High Resistance
            healthColor = "#e74c3c"; // Red
        } else if (volatilityIndex < 25000000) {
            healthText = "Optimal"; // Low Resistance
            healthColor = "#2ecc71"; // Green
        }

        const supplyFormatted = (globalSupply / 1000000).toFixed(1);

        statsTeaserUI.innerHTML = `
            <div style="margin-bottom: 15px; padding: 12px; background: rgba(255, 255, 255, 0.03); border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.08);">
                <span style="font-size: 0.65rem; color: #888; text-transform: uppercase; font-weight: 800; letter-spacing: 1px;">Resistance Pressure</span>
                <div style="font-size: 1.2rem; font-weight: 900; color: ${healthColor}; text-shadow: 0 0 10px ${healthColor}33;">
                    ${healthText}
                </div>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; padding: 0 5px;">
               
            </div>

            <button id="open-estats-btn" class="btn-primary" 
                style="background: #3498db; border: none; font-weight: bold; width: 100%; box-shadow: 0 0 15px rgba(52, 152, 219, 0.3); padding: 10px; cursor: pointer;">
                📊 Launch Economy Analytics
            </button>
        `;

        document.getElementById("open-estats-btn")?.addEventListener("click", () => {
            window.open('economy_stats.html', '_blank');
        });

    } catch (error) {
        console.error("Market Data Error:", error);
        statsTeaserUI.innerHTML = `<p style="color: #e74c3c; font-size: 0.75rem;">Failed to fetch market stats.</p>`;
    }
}