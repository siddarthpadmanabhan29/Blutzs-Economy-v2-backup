// ---------- membership_plans.js (Updated for Same-Day-Each-Month Billing) ----------
import { db } from "./firebaseConfig.js";
import { 
    doc, updateDoc, increment, getDoc 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/**
 * SOURCE OF TRUTH: Configuration for all tiers.
 */
export const PLANS = {
    standard: {
        label: "Standard",
        price: 0,
        taxRate: 0.10,
        interest: 0.03,
        cashback: 0,
        bpsPerPurchase: 5,
        shopFreeFreq: 0, 
        badge: "⚪",
        color: "#95a5a6"
    },
    basic: {
        label: "Basic",
        price: 100000,
        taxRate: 0.08,
        interest: 0.04,
        cashback: 0.01,
        bpsPerPurchase: 5,
        shopFreeFreq: 3, 
        badge: "🟢",
        color: "#2ecc71"
    },
    premium: {
        label: "Premium",
        price: 300000,
        taxRate: 0.04,
        interest: 0.05,
        cashback: 0.02,
        bpsPerPurchase: 10,
        shopFreeFreq: 2, 
        badge: "💎",
        color: "#9b59b6"
    },
    platinum: {
        label: "Platinum",
        price: 500000,
        taxRate: 0.00,
        interest: 0.05,
        cashback: 0.03,
        bpsPerPurchase: 20,
        shopFreeFreq: 1, 
        badge: "👑",
        color: "#f1c40f"
    }
};

/**
 * UI HELPER: Calculates the next billing date (Same day next month).
 * Fixes the "February Jump" by locking to the calendar day.
 */
export function getNextBillingDate(userData) {
    if (userData.trialExpiration) return new Date(userData.trialExpiration).toLocaleDateString();
    if (!userData.membershipLastPaid) return "N/A";
    
    const lastPaid = new Date(userData.membershipLastPaid);
    const nextBill = new Date(lastPaid);
    
    // JS setMonth handles month-end logic (e.g., Jan 31 -> Feb 28)
    nextBill.setMonth(nextBill.getMonth() + 1);
    
    return nextBill.toLocaleDateString();
}

/**
 * HELPER: Determines if the next purchase is free based on order count.
 */
export function isNextItemFree(type, userData) {
    if (type !== 'shop') return false; 

    const tier = userData.membershipLevel || 'standard';
    const plan = PLANS[tier];
    const freq = plan.shopFreeFreq;
    
    if (freq === 0) return false;

    const count = userData.shopOrderCount || 0;
    return count >= freq;
}

/**
 * BILLING & TRIAL CHECK: Processes monthly fees using Calendar Month logic.
 */
export async function checkMembershipBilling(userId, userData) {
    const tier = userData.membershipLevel || 'standard';
    const now = new Date();

    // --- 1. ADMIN FEATURE: TRIAL EXPIRATION CHECK ---
    if (userData.trialExpiration) {
        const expiration = new Date(userData.trialExpiration);
        if (now > expiration) {
            await updateDoc(doc(db, "users", userId), {
                membershipLevel: "standard",
                trialExpiration: null, 
                shopOrderCount: 0
            });
            alert("Your Admin-granted Free Trial has expired. Reverting to Standard tier.");
            return; 
        }
        return; 
    }

    // --- 2. STANDARD BILLING LOGIC (Same-Day-Each-Month) ---
    if (tier === 'standard') return;

    const lastPaidStr = userData.membershipLastPaid;
    if (!lastPaidStr) return;

    const lastPaid = new Date(lastPaidStr);
    const nextDueDate = new Date(lastPaid);
    nextDueDate.setMonth(nextDueDate.getMonth() + 1);

    // If "Now" has reached or passed the same calendar day next month
    if (now >= nextDueDate) {
        const cost = PLANS[tier].price;

        if ((userData.balance || 0) >= cost) {
            // Auto-pay and update the anchor date to "Now" to start the next month
            await updateDoc(doc(db, "users", userId), {
                balance: increment(-cost),
                membershipLastPaid: now.toISOString()
            });
            console.log(`Auto-renewed ${tier} for $${cost}`);
        } else {
            // Insufficient funds - demote to standard
            await updateDoc(doc(db, "users", userId), {
                membershipLevel: "standard",
                shopOrderCount: 0
            });
            alert("Membership cancelled due to insufficient funds. Reverting to Standard.");
        }
    }
}

/**
 * ADMIN HELPER: Get time remaining on a trial
 */
export function getTrialTimeLeft(expirationISO) {
    if (!expirationISO) return null;
    const now = new Date();
    const exp = new Date(expirationISO);
    const diff = exp - now;
    if (diff <= 0) return "Expired";

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    return `${days}d ${hours}h remaining`;
}

/**
 * UI HELPER: Returns the HTML string for the user's badge for the profile.
 */
export function getTierBadge(tier) {
    const plan = PLANS[tier] || PLANS.standard;
    return `<span class="badge" style="background: ${plan.color}; padding: 2px 8px; border-radius: 4px; font-size: 0.8em; color: white; margin-left: 10px;">
                ${plan.badge} ${plan.label}
            </span>`;
}