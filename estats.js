// ---------- estats.js ----------
import { getLiveMarketRate } from "./economyUtils.js";

const statsTeaserUI = document.getElementById("estats-lock-ui");

export async function renderStatsTeaser(userData) {
    if (!statsTeaserUI) return;

    // Market Insights is free for all users; no membership gate.

    // 2. LOADING STATE
    statsTeaserUI.innerHTML = `<p style="font-size: 0.85rem; color: var(--text-muted);">Syncing Intelligence...</p>`;

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
            <div style="margin-bottom: 15px; padding: 12px; background: var(--input-bg); border-radius: 8px; border: 1px solid var(--contract-border);">
                <span style="font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase; font-weight: 800; letter-spacing: 1px;">Resistance Pressure</span>
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