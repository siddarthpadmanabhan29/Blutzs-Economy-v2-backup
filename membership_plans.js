// ---------- membership_plans.js ----------
import { db } from "./firebaseConfig.js";
import { 
    doc, updateDoc, increment, getDoc 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { sendSlackMessage } from "./slackNotifier.js";

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
        bpsConversionLimit: 0,
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
        bpsConversionLimit: 25, 
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
        bpsConversionLimit: 50, 
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
        bpsConversionLimit: 75, 
        badge: "👑",
        color: "#f1c40f"
    }
};

/**
 * UI HELPER: Calculates the next billing date.
 */
export function getNextBillingDate(userData) {
    if (userData.trialExpiration) return new Date(userData.trialExpiration).toLocaleDateString();
    if (!userData.membershipLastPaid) return "N/A";
    
    const lastPaid = new Date(userData.membershipLastPaid);
    const nextBill = new Date(lastPaid);
    nextBill.setMonth(nextBill.getMonth() + 1);
    return nextBill.toLocaleDateString();
}

/**
 * HELPER: Determines if the next purchase is free.
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
 * BILLING & TRIAL CHECK: Processes monthly fees.
 */
export async function checkMembershipBilling(userId, userData) {
    const tier = userData.membershipLevel || 'standard';
    const now = new Date();

    if (userData.trialExpiration) {
        const expiration = new Date(userData.trialExpiration);
        if (now > expiration) {
            await updateDoc(doc(db, "users", userId), {
                membershipLevel: "standard",
                trialExpiration: null, 
                shopOrderCount: 0,
                membershipLockedPrice: null
            });
            alert("Your trial has expired. Reverting to Standard tier.");
            const username = userData.username || 'Unknown user';
            sendSlackMessage(`⏰ *Trial Expired:* ${username}'s free trial has ended.`);
            return; 
        }
        return; 
    }

    if (tier === 'standard') return;

    const lastPaidStr = userData.membershipLastPaid;
    const isFirstSubscription = !lastPaidStr && PLANS[tier].price > 0;
    const lastPaid = lastPaidStr ? new Date(lastPaidStr) : now;
    const nextDueDate = lastPaidStr ? new Date(lastPaid) : now;
    if (lastPaidStr) nextDueDate.setMonth(nextDueDate.getMonth() + 1);

    if (now >= nextDueDate) {
        let cost = PLANS[tier].price;
        const hasPriceLock = userData.insurance?.activePackages?.includes("darkblue_a");
        let usedPriceLock = false;

        if (hasPriceLock && userData.membershipLockedPrice) {
            if (cost > userData.membershipLockedPrice) {
                cost = userData.membershipLockedPrice;
                usedPriceLock = true;
            }
        }

        const username = userData.username || 'Unknown user';

        if (isFirstSubscription) {
            sendSlackMessage(`💥 *New Subscriber:* ${username} subscribed to ${tier.toUpperCase()}.`);
        }

        if ((userData.balance || 0) >= cost) {
            const updatePayload = {
                balance: increment(-cost),
                membershipLastPaid: now.toISOString()
            };

            if (hasPriceLock && !userData.membershipLockedPrice) {
                updatePayload.membershipLockedPrice = PLANS[tier].price;
            }

            if (usedPriceLock) {
                updatePayload.membershipLockedPrice = null; 
            }

            await updateDoc(doc(db, "users", userId), updatePayload);
            const lockAlert = usedPriceLock ? " (Price Lock Active 🛡️)" : "";
            sendSlackMessage(`💳 *Membership Renewal:* ${username} renewed ${tier.toUpperCase()} for $${cost.toLocaleString()}${lockAlert}.`);
        } else {
            await updateDoc(doc(db, "users", userId), {
                membershipLevel: "standard",
                shopOrderCount: 0,
                membershipLockedPrice: null
            });
            alert("Membership renewal failed (insufficient funds). Reverting to Standard.");
            sendSlackMessage(`⚠️ *Membership Cancelled:* ${username} failed to renew ${tier.toUpperCase()} tier.`);
        }
    }
}

/**
 * UI HELPER: Returns the HTML string for the user's badge.
 * Optimized for the new Sidebar/Overview interface.
 */
export function getTierBadge(tier) {
    const plan = PLANS[tier] || PLANS.standard;
    return `<span style="background: ${plan.color}; color: white; padding: 2px 8px; border-radius: 6px; font-size: 0.65rem; font-weight: 800; text-transform: uppercase; margin-left: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                ${plan.badge} ${plan.label}
            </span>`;
}

/**
 * SLACK HELPERS: Manual purchase actions
 */
export async function purchaseMembership(userId, newTier, userData, oldTier = null) {
    const currentTier = oldTier || userData.membershipLevel || 'standard';
    const plan = PLANS[newTier];
    const username = userData.username || 'Unknown user';
    const cost = plan.price;

    if (currentTier === 'standard') {
        sendSlackMessage(`💥 *New Subscriber:* ${username} joined ${newTier.toUpperCase()}.`);
    } else {
        sendSlackMessage(`🟢 *Tier Change:* ${username} moved from ${currentTier.toUpperCase()} to ${newTier.toUpperCase()}.`);
    }

    const updatePayload = {
        membershipLevel: newTier,
        membershipLastPaid: new Date().toISOString()
    };

    if (userData.insurance?.activePackages?.includes("darkblue_a")) {
        updatePayload.membershipLockedPrice = plan.price;
    }

    await updateDoc(doc(db, "users", userId), updatePayload);
}

/**
 * Manual Cancellation
 */
export async function cancelMembership(userId, userData, previousTier = null) {
    const tierToReport = previousTier || userData.membershipLevel || 'standard';
    
    await updateDoc(doc(db, "users", userId), {
        membershipLevel: "standard",
        shopOrderCount: 0,
        membershipLockedPrice: null
    });

    const username = userData.username || 'Unknown user';
    if (tierToReport !== 'standard') {
        sendSlackMessage(`🚫 *Membership Cancelled:* ${username} left ${tierToReport.toUpperCase()} tier.`);
    }
}