// ---------- bpsManager.js (LOYALTY & SECURITY CORE) ----------
import { db, auth } from "./firebaseConfig.js";
import { 
    doc, getDoc, updateDoc, increment, collection, addDoc 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { sendSlackMessage } from "./slackNotifier.js";
import { PLANS } from "./membership_plans.js"; 

/**
 * CHANGE PIN: Securely updates the 4-digit code
 */
export async function changeBpsPin(oldPin, newPin, confirmPin) {
    const user = auth.currentUser;
    if (!user) return { success: false, message: "No active session." };

    if (newPin !== confirmPin) {
        return { success: false, message: "New PINs do not match!" };
    }

    if (!/^\d{4}$/.test(newPin)) {
        return { success: false, message: "New PIN must be exactly 4 digits." };
    }

    try {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        
        if (!userSnap.exists()) return { success: false, message: "User not found." };
        const storedPin = userSnap.data().bpsPin;

        if (oldPin !== storedPin) {
            return { success: false, message: "Current PIN is incorrect." };
        }

        await updateDoc(userRef, { bpsPin: newPin });
        return { success: true, message: "PIN updated successfully!" };

    } catch (err) {
        console.error("Change PIN Error:", err);
        return { success: false, message: "System error updating PIN." };
    }
}

/**
 * JOIN REWARDS: Charges $50,000 and sets the first 30-day renewal date.
 */
export async function joinRewardsProgram() {
    const user = auth.currentUser;
    if (!user) return { success: false, message: "No active session." };

    const userRef = doc(db, "users", user.uid);
    const cost = 50000;
    const welcomeBonus = 10;

    try {
        const snap = await getDoc(userRef);
        if (!snap.exists()) return { success: false, message: "User data not found." };
        
        const data = snap.data();
        const username = data.username || data.displayName || 'Unknown User';
        const timestampStr = new Date().toLocaleString();

        if ((data.balance || 0) < cost) {
            return { success: false, message: "Insufficient funds! ($50,000 required)" };
        }

        const renewalDate = new Date();
        renewalDate.setDate(renewalDate.getDate() + 30);

        await updateDoc(userRef, {
            balance: increment(-cost),
            isRewardsActive: true,
            rewardsLastPaid: new Date().toISOString(),
            rewardsRenewalDate: renewalDate.toISOString(),
            bpsBalance: increment(welcomeBonus),
            bpsLifetimeEarnings: increment(welcomeBonus)
        });

        sendSlackMessage(`✨ *New Rewards Member!*\n*User:* ${username}\n*Action:* Joined Blutzs Rewards for $50,000.\n*Time:* ${timestampStr}`);

        return { success: true, message: "Welcome to Blutzs Rewards! +10 BPS awarded." };
    } catch (err) {
        console.error("Join Rewards Error:", err);
        return { success: false, message: "System error joining rewards." };
    }
}

/**
 * AUTO-BILLING: Checks if the subscription has expired and charges the user.
 */
export async function checkRewardsBilling(uid, userData) {
    if (!userData.isRewardsActive || !userData.rewardsRenewalDate) return;

    const now = new Date();
    const renewalDate = new Date(userData.rewardsRenewalDate);

    if (now >= renewalDate) {
        const cost = 50000;
        const userRef = doc(db, "users", uid);
        const username = userData.username || userData.displayName || uid;
        const timestampStr = now.toLocaleString();

        try {
            if ((userData.balance || 0) >= cost) {
                const nextRenewal = new Date(renewalDate);
                nextRenewal.setDate(nextRenewal.getDate() + 30);

                await updateDoc(userRef, {
                    balance: increment(-cost),
                    rewardsLastPaid: now.toISOString(),
                    rewardsRenewalDate: nextRenewal.toISOString()
                });
                
                console.log("Blutzs Rewards auto-renewed for $50,000.");
                sendSlackMessage(`♻️ *Subscription Renewed*\n*User:* ${username}\n*Amount:* $50,000 auto-deducted.\n*Time:* ${timestampStr}`);
            } else {
                await updateDoc(userRef, { isRewardsActive: false });
                sendSlackMessage(`❌ *Subscription Cancelled*\n*User:* ${username}\n*Reason:* Insufficient funds for renewal.\n*Time:* ${timestampStr}`);
                alert("Your Blutzs Rewards subscription was cancelled due to insufficient funds.");
            }
        } catch (err) {
            console.error("Auto-billing error:", err);
        }
    }
}

/**
 * CANCEL REWARDS
 */
export async function cancelRewardsProgram() {
    const user = auth.currentUser;
    if (!user) return { success: false, message: "No active session." };
    
    try {
        const userRef = doc(db, "users", user.uid);
        await updateDoc(userRef, { isRewardsActive: false });
        
        // Fetch username for notification
        const snap = await getDoc(userRef);
        const name = snap.exists() ? (snap.data().username || user.uid) : user.uid;
        const timestampStr = new Date().toLocaleString();
        
        sendSlackMessage(`🚫 *Rewards Cancelled*\n*User:* ${name}\n*Status:* Access limited to standard items.\n*Time:* ${timestampStr}`);

        return { success: true, message: "Rewards subscription cancelled. Shop access limited." };
    } catch (err) {
        return { success: false, message: "Error cancelling subscription." };
    }
}

/**
 * REGISTRATION: First-time wallet setup.
 */
export async function registerLoyalty(pin) {
    const user = auth.currentUser;
    if (!user) return { success: false, message: "No active session." };
    
    if (!/^\d{4}$/.test(pin)) return { success: false, message: "PIN must be exactly 4 digits." };

    const userRef = doc(db, "users", user.uid);
    const welcomeBonus = 10;
    
    const renewalDate = new Date();
    renewalDate.setDate(renewalDate.getDate() + 30);

    try {
        await updateDoc(userRef, {
            bpsPin: pin,
            isLoyaltyRegistered: true,
            isRewardsActive: true, 
            rewardsRenewalDate: renewalDate.toISOString(),
            bpsBalance: increment(welcomeBonus),
            bpsLifetimeEarnings: increment(welcomeBonus),
            activeBoosts: {
                taxHoliday: false,
                priceLock: false,
                instantInsurance: false,
                jackpotDouble: false,
                interestBoostExpiry: null
            }
        });
        
        const timestampStr = new Date().toLocaleString();
        sendSlackMessage(`🎉 *Loyalty Registered*\n*User:* ${user.uid}\n*Bonus:* +10 BPS awarded.\n*Time:* ${timestampStr}`);

        return { success: true, message: "Registration Complete! +10 BPS Bonus added." };
    } catch (error) {
        console.error("Loyalty Registration Error:", error);
        return { success: false, message: "System error during registration." };
    }
}

/**
 * SECURITY: PIN Verification
 */
export async function verifyBpsPin(enteredPin) {
    const user = auth.currentUser;
    if (!user) return false;

    try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (!userSnap.exists()) return false;

        const storedPin = userSnap.data().bpsPin;
        return enteredPin === storedPin;
    } catch (error) {
        console.error("PIN Verification Error:", error);
        return false;
    }
}

/**
 * PERKS EXECUTION: Handles specialized logic for BPS Shop items
 */
export async function applyBpsPerk(perkId, cost, userData) {
    const user = auth.currentUser;
    if (!user) return false;

    const currentBps = Number(userData.bpsBalance || 0);
    if (currentBps < cost) {
        alert("🔒 Transaction Failed: Insufficient BPS Tokens.");
        return false;
    }

    const userRef = doc(db, "users", user.uid);
    const inventoryRef = collection(db, "users", user.uid, "inventory");
    const buyerName = userData.username || userData.displayName || user.uid;

    try {
        const updates = { bpsBalance: increment(-cost) };

        switch (perkId) {
            case "taxHoliday": 
                updates["activeBoosts.taxHoliday"] = true; 
                break;
            case "priceLock":
                updates["activeBoosts.priceLock"] = true;
                const currentTier = userData.membershipLevel || 'standard';
                updates.membershipLockedPrice = PLANS[currentTier].price; 
                break;
            case "instantInsurance": 
                updates["activeBoosts.instantInsurance"] = true; 
                break;
            case "lotteryLimitBypass":
                await addDoc(inventoryRef, {
                    name: "Extra Lottery Entry",
                    type: "lottery_bypass",
                    description: "Bypass your daily limit to purchase one extra ticket.",
                    acquiredAt: new Date().toISOString(),
                    isFree: false
                });
                break;
            case "jackpotDouble":
                updates["activeBoosts.jackpotDouble"] = true;
                break;
            case "premiumTrial":
                await addDoc(inventoryRef, {
                    name: "7-Day Premium Trial",
                    type: "premium_trial",
                    description: "Activate to instantly upgrade to Premium for 7 days.",
                    acquiredAt: new Date().toISOString(),
                    isFree: false
                });
                break;
            case "interestBoost":
                await addDoc(inventoryRef, {
                    name: "+1% Retirement Interest",
                    type: "interest_boost",
                    description: "Activate to increase retirement interest by 1% for 30 days.",
                    acquiredAt: new Date().toISOString(),
                    isFree: false
                });
                break;
        }

        await updateDoc(userRef, updates);
        
        const timestampStr = new Date().toLocaleString();
        sendSlackMessage(`🛒 *BPS Purchase!*\n*User:* ${buyerName}\n*Item:* ${perkId}\n*Cost:* ${cost} BPS\n*Time:* ${timestampStr}`);

        return true;
        
    } catch (error) {
        console.error("Perk Application Error:", error);
        return false;
    }
}