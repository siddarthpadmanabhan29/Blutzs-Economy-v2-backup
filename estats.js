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
        const { volatilityIndex } = await getLiveMarketRate();
        
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

        statsTeaserUI.innerHTML = `
            <div class="market-teaser-layout">
                <div class="market-resistance">
                    <span style="font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase; font-weight: 800; letter-spacing: 1px;">Resistance Pressure</span>
                    <div class="market-resistance-value" style="color: ${healthColor};">
                        ${healthText}
                    </div>
                </div>
                <button id="open-estats-btn" class="btn-primary market-analytics-btn" type="button">
                    📊 Launch Economy Analytics
                </button>
            </div>
        `;

        document.getElementById("open-estats-btn")?.addEventListener("click", () => {
            window.open('economy_stats.html', '_blank');
        });

    } catch (error) {
        console.error("Market Data Error:", error);
        statsTeaserUI.innerHTML = `<p style="color: #e74c3c; font-size: 0.75rem;">Failed to fetch market stats.</p>`;
    }
}