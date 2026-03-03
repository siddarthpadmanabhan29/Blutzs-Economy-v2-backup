// ---------- economyUtils.js ----------
import { db, auth } from "./firebaseConfig.js";
import { collection, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/**
 * CALIBRATION CONSTANTS
 * Adjust BPS_BASE_MULTIPLIER to change the global exchange rate.
 * - Higher = BPS is worth more cash (Easy Mode)
 * - Lower = BPS is worth less cash (Hardcore Mode)
 */
const BPS_BASE_MULTIPLIER = 1350; 

/**
 * Aggregates real-time data from all users and the Admin Index to calculate the BPS Market Rate.
 * RESISTANCE MODEL: (Global Wealth / Admin Index) * BPS_BASE_MULTIPLIER
 */
export async function getLiveMarketRate() {
    try {
        // 1. Fetch all user data to calculate current Global Wealth
        const usersSnap = await getDocs(collection(db, "users"));
        
        let totalCash = 0;
        let totalRetirement = 0;
        let totalBpsInCirculation = 0;
        let adminIndex = 34000000; // Default Resistance Baseline

        usersSnap.forEach(uDoc => {
            const u = uDoc.data();
            totalCash += (u.balance || 0);
            totalRetirement += (u.retirementSavings || 0);
            totalBpsInCirculation += (u.bpsBalance || 0);
            
            // Capture the volatility index from the Admin user as the Resistance Factor
            if (u.isAdmin === true) {
                adminIndex = u.volatilityIndex || 34000000;
            }
        });

        // Global Wealth (Strength) = Liquid Cash + Savings
        const realGlobalWealth = totalCash + totalRetirement;
        
        /* =========================================================
            RESISTANCE ENGINE: (Strength / Resistance)
            Logic: 
            - Higher Wealth = Higher Price (Strength pushes UP)
            - Higher Index  = Lower Price  (Resistance pushes DOWN)
        ========================================================= */
        
        // Multiplier centers the "Neutral" state ($38M Wealth / $34M Index) at ~$1,500
        const rawRate = (realGlobalWealth / adminIndex) * BPS_BASE_MULTIPLIER;
        
        let rate = Math.floor(rawRate);

        // DEBUG LOG: Essential for monitoring the Wealth vs Resistance gap
        console.log(`📊 Resistance Engine: Rate=$${rate}, Wealth=$${(realGlobalWealth/1000000).toFixed(1)}M, Resistance=$${(adminIndex/1000000).toFixed(1)}M`);

        // SAFETY CLAMPING ($500 - $2500)
        if (rate < 200) rate = 200; 
        if (rate > 2500) rate = 2500;
        
        return {
            rate,
            rawRate, 
            globalSupply: realGlobalWealth,
            volatilityIndex: adminIndex,
            totalBps: totalBpsInCirculation
        };
    } catch (err) {
        console.error("Economy Aggregation Error:", err);
        // Fallback to floor if network fails
        return { rate: 200, rawRate: 200, globalSupply: 0, volatilityIndex: 34000000, totalBps: 0 }; 
    }
}