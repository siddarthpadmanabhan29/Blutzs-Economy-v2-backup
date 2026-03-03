// ---------- economyLogger.js ----------
import { db } from "./firebaseConfig.js";
import { doc, getDoc, setDoc, collection, query, orderBy, limit, getDocs } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { getLiveMarketRate } from "./economyUtils.js";

/**
 * Captures a daily snapshot of the economy.
 * Uses a local EST-based date string as the ID to prevent UTC date-skipping.
 */
export async function logDailyEconomySnapshot() {
    // DATA ENGINEERING FIX: Generate a localized YYYY-MM-DD string for EST (GMT-5)
    // This ensures March 2nd doesn't become March 3rd at 7:00 PM local time.
    const now = new Date();
    const estDate = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) - (5 * 3600000));
    const today = estDate.toISOString().split('T')[0]; 

    const snapshotRef = doc(db, "market_history", today);

    try {
        // QUOTA PROTECTION: Check if today is already logged before fetching full market math.
        // This ensures exactly 1 write per day regardless of traffic.
        const snap = await getDoc(snapshotRef);
        if (snap.exists()) {
            console.log(`✅ Economy already archived for ${today}. Skipping.`);
            return;
        }

        // Fetch the REAL math from our centralized source of truth
        const { rate, globalSupply, totalBps, volatilityIndex } = await getLiveMarketRate();

        await setDoc(snapshotRef, {
            date: today,
            bpsRate: rate,
            liquidity: globalSupply,
            volatilityIndex: volatilityIndex, // Synced Resistance Index
            circulation: totalBps,
            timestamp: new Date().getTime() // Stored for accurate chronological sorting
        });

        console.log(`📊 Economy Archived: Snapshot for ${today} saved (Resistance: $${(volatilityIndex/1000000).toFixed(1)}M).`);
    } catch (err) {
        console.error("Failed to archive economy snapshot:", err);
    }
}

/**
 * Fetches the last X days of history for the charts.
 * Ordered chronologically for Chart.js.
 */
export async function getMarketHistory(days = 7) {
    try {
        const historyRef = collection(db, "market_history");
        
        // We fetch the newest records first to satisfy the 'limit'
        const q = query(historyRef, orderBy("timestamp", "desc"), limit(days));
        const snapshot = await getDocs(q);
        
        let historyData = [];
        snapshot.forEach(doc => historyData.push(doc.data()));
        
        // Reverse the array to get chronological order (Oldest to Newest) for the UI charts
        return historyData.reverse();
    } catch (err) {
        console.error("Error fetching market history:", err);
        return [];
    }
}