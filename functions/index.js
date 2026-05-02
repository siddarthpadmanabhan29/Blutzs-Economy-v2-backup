/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const {setGlobalOptions} = require("firebase-functions");
const {onRequest} = require("firebase-functions/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

// Initialize Firebase Admin SDK if not already done
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// For cost control, you can set the maximum number of containers that can be
// running at the same time.
setGlobalOptions({ maxInstances: 10 });

/**
 * SCHEDULED: Process subscription renewals daily
 * Runs every day at 1 AM UTC
 * Optimized using collectionGroup and Transactions + Tier Tax Logic
 */
exports.processSubscriptionRenewals = onSchedule(
  {
    schedule: "0 1 * * *", // Every day at 1 AM UTC
    timeoutSeconds: 300,
    memory: "256MB",
  },
  async (context) => {
    logger.info("🔄 Starting subscription renewal process (Optimized)...");
    let processedCount = 0;
    let successCount = 0;
    let failureCount = 0;

    const now = new Date();
    const nowIso = now.toISOString();

    try {
      // OPTIMIZED: Query all subscriptions due for renewal across all users at once
      const expiredSubs = await db.collectionGroup("subscriptions")
        .where("status", "==", "active")
        .where("nextBillingDate", "<=", nowIso)
        .get();

      if (expiredSubs.empty) {
        logger.info("✅ No subscriptions due for renewal today.");
        return;
      }

      for (const subDoc of expiredSubs.docs) {
        processedCount++;
        const subData = subDoc.data();
        const subRef = subDoc.ref;
        // Navigation: Sub-collection doc -> subscriptions collection -> user doc
        const userRef = subRef.parent.parent; 

        try {
          await db.runTransaction(async (transaction) => {
            const userSnap = await transaction.get(userRef);
            const userData = userSnap.data();
            const itemSnap = await transaction.get(db.collection("subscriptionShop").doc(subData.itemId));

            if (!itemSnap.exists()) {
              logger.warn(`Subscription item ${subData.itemId} not found for sub ${subDoc.id}`);
              throw new Error("ItemNotFound");
            }

            const itemData = itemSnap.data();
            const basePrice = Number(itemData.cost);
            
            // --- TAX LOGIC INTEGRATION ---
            // Calculate tax based on the user's current membership tier tax rate
            const userTaxRate = Number(userData.activeTaxRate !== undefined ? userData.activeTaxRate : 0.10);
            const taxAmount = Math.floor(basePrice * userTaxRate);
            const finalRenewalCost = basePrice + taxAmount;

            // Check for clipped coupon and apply discount
            let finalChargeAmount = finalRenewalCost;
            const clippedCoupon = subData.clippedCoupon || null;
            if (clippedCoupon && clippedCoupon.discountValue) {
              const couponDiscount = Math.floor(finalRenewalCost * (clippedCoupon.discountValue / 100));
              finalChargeAmount = finalRenewalCost - couponDiscount;
              logger.info(`Coupon applied: ${clippedCoupon.discountValue}% off. Original: $${finalRenewalCost}, After: $${finalChargeAmount}`);
            }

            const userBalance = Number(userData.balance || 0);

            // 1. Check Funds (Price + Tier Tax + Coupon Applied)
            if (userBalance < finalChargeAmount) {
              transaction.update(subRef, {
                lastRenewalAttempt: nowIso,
                renewalFailed: true,
              });
              logger.warn(`User ${userRef.id} insufficient funds. Bal: $${userBalance}, Cost: $${finalRenewalCost}`);
              failureCount++;
              return;
            }

            // 2. Calculate next billing date
            const nextBilling = new Date(subData.nextBillingDate);
            if (subData.renewalType === "days") {
              nextBilling.setDate(nextBilling.getDate() + (subData.renewalInterval || 7));
            } else {
              nextBilling.setMonth(nextBilling.getMonth() + (subData.renewalInterval || 1));
            }

            // 3. Commit Renewal
            transaction.update(userRef, {
              balance: admin.firestore.FieldValue.increment(-finalChargeAmount),
            });

            transaction.update(subRef, {
              nextBillingDate: nextBilling.toISOString(),
              chargeCount: admin.firestore.FieldValue.increment(1),
              lastChargedAt: nowIso,
              renewalFailed: false,
              lastPaidAmount: finalChargeAmount,
              taxRateAtRenewal: userTaxRate,
              clippedCoupon: null,
              couponUsedAt: clippedCoupon ? nowIso : null
            });

            transaction.update(itemSnap.ref, {
              totalRevenue: admin.firestore.FieldValue.increment(finalChargeAmount),
              lastChargeAt: nowIso,
            });

            successCount++;
          });
        } catch (txnErr) {
          if (txnErr.message !== "ItemNotFound") {
            logger.error(`Transaction failed for sub ${subDoc.id}:`, txnErr);
            failureCount++;
          }
        }
      }

      logger.info(
        `📊 Subscription renewal complete: ${successCount} success, ${failureCount} failed (${processedCount} total processed)`
      );
    } catch (err) {
      logger.error("Subscription renewal process failed:", err);
      throw err;
    }
  }
);

/**
 * SCHEDULED: Clean up cancelled subscriptions (keep for 30 days then archive)
 * Runs every Sunday at 2 AM UTC
 * Optimized using collectionGroup
 */
exports.cleanupCancelledSubscriptions = onSchedule(
  {
    schedule: "0 2 ? * 0", // Every Sunday at 2 AM UTC
    timeoutSeconds: 300,
    memory: "256MB",
  },
  async (context) => {
    logger.info("🗑️ Starting cancelled subscriptions cleanup...");
    let cleanupCount = 0;

    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const thirtyDaysAgoIso = thirtyDaysAgo.toISOString();

      // OPTIMIZED: Use collectionGroup to find all cancelled subs regardless of parent user
      const cancelledSubs = await db.collectionGroup("subscriptions")
        .where("status", "==", "cancelled")
        .where("cancelledAt", "<", thirtyDaysAgoIso)
        .get();

      const batch = db.batch();

      cancelledSubs.forEach(doc => {
        batch.delete(doc.ref);
        cleanupCount++;
      });

      if (cleanupCount > 0) {
        await batch.commit();
      }

      logger.info(`✅ Cleanup complete: ${cleanupCount} old subscriptions removed`);
    } catch (err) {
      logger.error("Subscription cleanup failed:", err);
      throw err;
    }
  }
);