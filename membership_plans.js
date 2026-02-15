// ---------- membership_plans.js (Updated for Complete Slack Notifications + New Subscriber Alerts) ----------
import { db } from "./firebaseConfig.js";
import { 
    doc, updateDoc, increment, getDoc 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { sendSlackMessage } from "./slackNotifier.js"; // <-- Slack integration

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
 * Includes Slack notifications for all membership events.
 */
export async function checkMembershipBilling(userId, userData) {
    const tier = userData.membershipLevel || 'standard';
    const now = new Date();

    // --- 1. TRIAL EXPIRATION ---
    if (userData.trialExpiration) {
        const expiration = new Date(userData.trialExpiration);
        if (now > expiration) {
            await updateDoc(doc(db, "users", userId), {
                membershipLevel: "standard",
                trialExpiration: null, 
                shopOrderCount: 0
            });
            alert("Your Admin-granted Free Trial has expired. Reverting to Standard tier.");

            // Slack notification: trial expiration downgrade
            const username = userData.displayName || userData.username || 'Unknown user';
            const timestamp = new Date().toLocaleString();
            sendSlackMessage(`⚠️ *Membership Downgrade:* ${username}'s free trial expired. Reverted to Standard.\n*Time:* ${timestamp}`);
            return; 
        }
        return; 
    }

    // --- 2. STANDARD BILLING LOGIC ---
    if (tier === 'standard') return;

    const lastPaidStr = userData.membershipLastPaid;
    const isFirstSubscription = !lastPaidStr && PLANS[tier].price > 0;
    const lastPaid = lastPaidStr ? new Date(lastPaidStr) : now;
    const nextDueDate = lastPaidStr ? new Date(lastPaid) : now;
    if (lastPaidStr) nextDueDate.setMonth(nextDueDate.getMonth() + 1);

    if (now >= nextDueDate) {
        const cost = PLANS[tier].price;
        const username = userData.displayName || userData.username || 'Unknown user';
        const timestamp = new Date().toLocaleString();

        // --- New Subscriber Slack Notification ---
        if (isFirstSubscription) {
            sendSlackMessage(`💥 *New Subscriber:* ${username} subscribed to ${tier.toUpperCase()} membership for $${cost.toLocaleString()}.\n*Time:* ${timestamp}`);
        }

        if ((userData.balance || 0) >= cost) {
            // Auto-renew
            await updateDoc(doc(db, "users", userId), {
                balance: increment(-cost),
                membershipLastPaid: now.toISOString()
            });
            console.log(`Auto-renewed ${tier} for $${cost}`);

            // Slack notification: auto-renewal
            sendSlackMessage(`💳 *Membership Renewal:* ${username} renewed their ${tier.toUpperCase()} membership for $${cost.toLocaleString()}.\n*Time:* ${timestamp}`);
        } else {
            // Insufficient funds - demote to Standard
            await updateDoc(doc(db, "users", userId), {
                membershipLevel: "standard",
                shopOrderCount: 0
            });
            alert("Membership cancelled due to insufficient funds. Reverting to Standard.");

            sendSlackMessage(`⚠️ *Membership Cancelled:* ${username} could not renew ${tier.toUpperCase()} membership due to insufficient funds. Downgraded to Standard.\n*Time:* ${timestamp}`);
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
 * UI HELPER: Returns the HTML string for the user's badge
 */
export function getTierBadge(tier) {
    const plan = PLANS[tier] || PLANS.standard;
    return `<span class="badge" style="background: ${plan.color}; padding: 2px 8px; border-radius: 4px; font-size: 0.8em; color: white; margin-left: 10px;">
                ${plan.badge} ${plan.label}
            </span>`;
}

/**
 * SLACK HELPERS: Manual membership purchase / upgrade
 */
export async function purchaseMembership(userId, newTier, userData) {
    const currentTier = userData.membershipLevel || 'standard';
    const plan = PLANS[newTier];
    if (!plan) throw new Error("Invalid membership tier");

    const cost = plan.price;
    if ((userData.balance || 0) < cost) throw new Error("Insufficient funds for membership purchase");

    const isNewSubscriber = currentTier === 'standard' && cost > 0;

    await updateDoc(doc(db, "users", userId), {
        balance: increment(-cost),
        membershipLevel: newTier,
        membershipLastPaid: new Date().toISOString()
    });

    const username = userData.displayName || userData.username || 'Unknown user';
    const timestamp = new Date().toLocaleString();

    // Slack notifications
    if (isNewSubscriber) {
        sendSlackMessage(`💥 *New Subscriber:* ${username} subscribed to ${newTier.toUpperCase()} membership for $${cost.toLocaleString()}.\n*Time:* ${timestamp}`);
    } else if (PLANS[newTier].price > PLANS[currentTier].price) {
        sendSlackMessage(`⬆️ *Membership Upgrade:* ${username} upgraded from ${currentTier.toUpperCase()} to ${newTier.toUpperCase()} for $${cost.toLocaleString()}.\n*Time:* ${timestamp}`);
    } else if (PLANS[newTier].price < PLANS[currentTier].price) {
        sendSlackMessage(`⬇️ *Membership Downgrade:* ${username} downgraded from ${currentTier.toUpperCase()} to ${newTier.toUpperCase()}.\n*Time:* ${timestamp}`);
    } else {
        sendSlackMessage(`💳 *Membership Purchase:* ${username} purchased ${newTier.toUpperCase()} membership for $${cost.toLocaleString()}.\n*Time:* ${timestamp}`);
    }
}

/**
 * CANCEL MEMBERSHIP (manual)
 */
export async function cancelMembership(userId, userData) {
    const tier = userData.membershipLevel || 'standard';
    if (tier === 'standard') return;

    await updateDoc(doc(db, "users", userId), {
        membershipLevel: "standard",
        shopOrderCount: 0
    });

    const username = userData.displayName || userData.username || 'Unknown user';
    const timestamp = new Date().toLocaleString();
    sendSlackMessage(`⚠️ *Membership Cancelled:* ${username} cancelled their ${tier.toUpperCase()} membership. Reverted to Standard.\n*Time:* ${timestamp}`);
}
