// ---------- subscriptionShop.js ----------
console.log("subscriptionShop.js loaded");

import { db, auth } from "../firebaseConfig.js";
import { 
  doc, getDoc, updateDoc, collection, getDocs, addDoc, increment, where, query, runTransaction 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { logHistory } from "../historyManager.js";
import { PLANS, isNextItemFree } from "../membership_plans.js";
import { sendSlackMessage } from "../slackNotifier.js";

const subscriptionItemsContainer = document.getElementById("subscription-shop-items");
const userSubscriptionsContainer = document.getElementById("user-subscriptions");

let currentSubscriptionItems = [];
let userActiveSubscriptions = [];
let localUserData = null;

/**
 * Load subscription items and user's active subscriptions
 */
export async function loadSubscriptionShop() {
  const user = auth.currentUser;
  if (!user) return;

  try {
    // Load subscription items
    const subRef = collection(db, "subscriptionShop");
    const querySnap = await getDocs(subRef);
    currentSubscriptionItems = [];
    querySnap.forEach((doc) => {
      currentSubscriptionItems.push({ id: doc.id, ...doc.data() });
    });
    console.log("✅ Loaded subscription items:", currentSubscriptionItems);

    // Load user data
    const userSnap = await getDoc(doc(db, "users", user.uid));
    if (userSnap.exists()) {
      localUserData = userSnap.data();
    }

    // Load user's active subscriptions
    const userSubsRef = collection(db, "users", user.uid, "subscriptions");
    const userSubsSnap = await getDocs(query(userSubsRef, where("status", "==", "active")));
    userActiveSubscriptions = [];
    userSubsSnap.forEach((doc) => {
      userActiveSubscriptions.push({ id: doc.id, ...doc.data() });
    });
    console.log("✅ Loaded user subscriptions:", userActiveSubscriptions);

    renderSubscriptionShop();
    renderUserSubscriptions();
  } catch (err) {
    console.error("Failed to load subscription shop:", err);
  }
}

/**
 * Render available subscription items
 */
function renderSubscriptionShop() {
  if (!subscriptionItemsContainer) return;

  subscriptionItemsContainer.innerHTML = "";

  if (currentSubscriptionItems.length === 0) {
    subscriptionItemsContainer.innerHTML = 
      "<p style='color:gray; font-style:italic; text-align:center; grid-column: 1/-1; padding: 20px;'>No subscriptions available...</p>";
    return;
  }

  const userBalance = Number(localUserData?.balance || 0);
  const activeDiscount = Number(localUserData?.activeDiscount || 0);

  currentSubscriptionItems.forEach((item) => {
    const originalCost = Number(item.cost);
    
    let discountedPrice = originalCost;
    if (activeDiscount > 0) {
      discountedPrice = Math.floor(originalCost * (1 - activeDiscount));
    }

    const renewalText = item.renewalType === "days" 
      ? `Renews every ${item.renewalInterval} days` 
      : `Renews every ${item.renewalInterval} months`;

    // Check if user already subscribed to this item
    const alreadySubscribed = userActiveSubscriptions.some(sub => sub.itemId === item.id);
    
    const affordable = userBalance >= discountedPrice;
    const isExpired = localUserData?.expirationDate && new Date(localUserData.expirationDate) < new Date();
    const isDisabled = !affordable || isExpired || alreadySubscribed;

    let btnText = alreadySubscribed ? "Already Subscribed" : (affordable ? "Subscribe" : "Insufficient");
    let btnColor = alreadySubscribed ? '#555' : (affordable ? '#2ecc71' : '#e74c3c');

    const itemCard = document.createElement("div");
    itemCard.classList.add("subscription-item");
    itemCard.style.cssText = `
      background: #1a1a1a;
      border: 1px solid #2ecc71;
      border-radius: 16px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 15px;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
      text-align: center;
      box-shadow: 0 4px 10px rgba(46, 204, 113, 0.1);
      position: relative;
      overflow: hidden;
    `;

    itemCard.onmouseenter = () => { if (!isDisabled) itemCard.style.transform = "translateY(-4px)"; };
    itemCard.onmouseleave = () => { itemCard.style.transform = "translateY(0)"; };

    itemCard.innerHTML = `
      <div class="subscription-item-image" style="width:100%; height:120px; border-radius:8px; overflow:hidden; background:rgba(46, 204, 113, 0.1);">
        <img src="${item.image || 'https://via.placeholder.com/150?text=Sub'}" alt="${item.name}" style="width:100%; height:100%; object-fit:cover;">
      </div>
      <div class="subscription-item-info">
        <h4 style="margin:0; font-size: 0.95rem; color: #2ecc71;">${item.name}</h4>
        <p style="margin: 5px 0; font-size: 0.8rem; color: #aaa;">${item.description || "Subscription service"}</p>
        <div style="margin: 8px 0; font-size: 0.75rem; color: #888;">
          <div style="margin: 4px 0;">💚 ${renewalText}</div>
          <div style="margin: 4px 0; color: #f1c40f;">
            ${activeDiscount > 0 ? `<span style="text-decoration: line-through; opacity: 0.6;">$${originalCost.toLocaleString()}</span> ` : ''}
            First charge: $${discountedPrice.toLocaleString()}
          </div>
        </div>
      </div>
      <button class="subscribe-btn" data-id="${item.id}" ${isDisabled ? "disabled" : ""} 
        style="width: 100%; padding: 10px; border-radius: 6px; border:none; background: ${btnColor}; color:white; font-weight:bold; cursor:${isDisabled ? 'not-allowed' : 'pointer'}; font-size: 0.9rem;">
        ${btnText}
      </button>
    `;

    subscriptionItemsContainer.appendChild(itemCard);
  });

  attachSubscribeListeners();
}

/**
 * Render user's active subscriptions
 */
function renderUserSubscriptions() {
  if (!userSubscriptionsContainer) return;

  userSubscriptionsContainer.innerHTML = "";

  if (userActiveSubscriptions.length === 0) {
    userSubscriptionsContainer.innerHTML = 
      `<div style="text-align: center; color: #888; padding: 20px; grid-column: 1/-1;">
        <p style="font-style: italic;">You don't have any active subscriptions yet.</p>
      </div>`;
    return;
  }

  userActiveSubscriptions.forEach((subscription) => {
    const item = currentSubscriptionItems.find(i => i.id === subscription.itemId);
    if (!item) return;

    const nextBillingDate = new Date(subscription.nextBillingDate);
    const daysUntilRenewal = Math.ceil((nextBillingDate - new Date()) / (1000 * 60 * 60 * 24));

    const subscriptionCard = document.createElement("div");
    subscriptionCard.style.cssText = `
      background: rgba(46, 204, 113, 0.1);
      border: 1px solid #2ecc71;
      border-radius: 12px;
      padding: 15px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 15px;
    `;

    subscriptionCard.innerHTML = `
      <div style="flex: 1;">
        <h4 style="margin: 0 0 5px 0; color: #2ecc71;">${item.name}</h4>
        <p style="margin: 0; font-size: 0.8rem; color: #aaa;">
          Cost: <span style="color: #f1c40f;">$${Number(item.cost).toLocaleString()}</span> every ${subscription.renewalInterval} ${subscription.renewalType}
        </p>
        <p style="margin: 5px 0 0 0; font-size: 0.75rem; color: #888;">
          Next charge: ${nextBillingDate.toLocaleDateString()} (in ${daysUntilRenewal} days)
        </p>
      </div>
      <button class="cancel-subscription-btn" data-subscription-id="${subscription.id}" data-item-id="${item.id}"
        style="background: #e74c3c; color: white; border: none; padding: 8px 15px; border-radius: 6px; cursor: pointer; font-size: 0.85rem; font-weight: bold; white-space: nowrap;">
        Cancel Sub
      </button>
    `;

    userSubscriptionsContainer.appendChild(subscriptionCard);
  });

  attachCancelListeners();
}

/**
 * Attach subscribe button listeners
 */
function attachSubscribeListeners() {
  document.querySelectorAll(".subscribe-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await subscribeToItem(btn.dataset.id, btn);
    });
  });
}

/**
 * Attach cancel subscription listeners
 */
function attachCancelListeners() {
  document.querySelectorAll(".cancel-subscription-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await cancelSubscription(btn.dataset.subscriptionId, btn.dataset.itemId, btn);
    });
  });
}

/**
 * Subscribe user to an item
 */
async function subscribeToItem(itemId, btnElement) {
  const user = auth.currentUser;
  if (!user) return;

  try {
    const userRef = doc(db, "users", user.uid);
    const itemRef = doc(db, "subscriptionShop", itemId);

    const [userSnap, itemSnap] = await Promise.all([getDoc(userRef), getDoc(itemRef)]);

    if (!userSnap.exists() || !itemSnap.exists()) {
      alert("Error: User or subscription item not found.");
      return;
    }

    const userData = userSnap.data();
    const itemData = itemSnap.data();

    // Check expiration
    const now = new Date();
    const expirationDate = userData.expirationDate ? new Date(userData.expirationDate) : null;
    if (expirationDate && expirationDate < now) {
      alert("⛔ Your ID is expired! Please renew your ID to subscribe.");
      return;
    }

    const basePrice = Number(itemData.cost);
    const activeDiscount = Number(localUserData?.activeDiscount || 0);
    const discountedPrice = activeDiscount > 0 ? Math.floor(basePrice * (1 - activeDiscount)) : basePrice;
    const userTaxRate = Number(userData.activeTaxRate !== undefined ? userData.activeTaxRate : 0.10);
    const taxAmount = Math.floor(discountedPrice * userTaxRate);
    const finalCost = discountedPrice + taxAmount;
    
    const userBalance = Number(userData.balance || 0);

    if (userBalance < finalCost) {
      alert(`Insufficient funds! Total cost with tax is $${finalCost.toLocaleString()}`);
      return;
    }

    // --- UPDATED ALERT TEXT ---
    const taxPercent = Math.round(userTaxRate * 100);
    const confirmMsg = `Subscribe to ${itemData.name}?\n\n` +
                       `Total Today: $${finalCost.toLocaleString()}\n` +
                       `(Includes ${taxPercent}% Tier Tax)\n\n` +
                       `Note: Future renewals will apply the tax rate of your current membership tier at the time of billing.\n\n` +
                       `You can cancel anytime.`;

    if (!confirm(confirmMsg)) return;

    btnElement.disabled = true;
    btnElement.textContent = "Processing...";

    const nextBillingDate = new Date();
    if (itemData.renewalType === "days") {
      nextBillingDate.setDate(nextBillingDate.getDate() + itemData.renewalInterval);
    } else {
      nextBillingDate.setMonth(nextBillingDate.getMonth() + itemData.renewalInterval);
    }

    const subscriptionsRef = doc(collection(db, "users", user.uid, "subscriptions"));

    await runTransaction(db, async (transaction) => {
        const uSnap = await transaction.get(userRef);
        const currentBalance = Number(uSnap.data().balance || 0);
  
     if (currentBalance < finalCost) throw new Error("Insufficient funds at moment of purchase.");
      transaction.set(subscriptionsRef, {
        itemId: itemId,
        itemName: itemData.name,                
        cost: basePrice, // Store base price for future tax calculations
        status: "active",
        subscribedAt: new Date().toISOString(),
        nextBillingDate: nextBillingDate.toISOString(),
        chargeCount: 1,
        initialTaxPaid: userTaxRate,
        renewalInterval: itemData.renewalInterval,
        renewalType: itemData.renewalType 
      });

      transaction.update(userRef, {
        balance: increment(-finalCost)
      });

      transaction.update(itemRef, {
        subscriberCount: increment(1),
        totalRevenue: increment(finalCost),
        lastSubscribedAt: new Date().toISOString()
      });
    });

    await logHistory(user.uid, `Subscribed to ${itemData.name}: Paid $${finalCost.toLocaleString()} (Tax included)`, "subscription");

    sendSlackMessage(
      `✅ *New Subscription:* ${userData.username || 'User'} subscribed to *${itemData.name}* for *$${finalCost.toLocaleString()}* (Tier Tax: ${taxPercent}%)`
    );

    alert(`✅ Successfully subscribed to ${itemData.name}!`);

    // Reload UI
    // Update local state without re-fetching
    localUserData.balance -= finalCost;
    userActiveSubscriptions.push({
    id: subscriptionsRef.id,
    itemId: itemId,
    itemName: itemData.name,
    cost: basePrice,
    status: "active",
    nextBillingDate: nextBillingDate.toISOString(),
    renewalInterval: itemData.renewalInterval,
    renewalType: itemData.renewalType
    });
    renderSubscriptionShop();
    renderUserSubscriptions();

  } catch (err) {
    console.error("Subscription error:", err);
    alert("Subscription failed: " + err.message);
    btnElement.disabled = false;
    btnElement.textContent = "Subscribe";
  }
}

/**
 * Cancel user subscription
 */
async function cancelSubscription(subscriptionId, itemId, btnElement) {
  const user = auth.currentUser;
  if (!user) return;

  if (!confirm("Are you sure you want to cancel this subscription? You won't be charged again.")) {
    return;
  }

  try {
    btnElement.disabled = true;
    btnElement.textContent = "Canceling...";

    const subscriptionRef = doc(db, "users", user.uid, "subscriptions", subscriptionId);
    const itemRef = doc(db, "subscriptionShop", itemId);
    const userRef = doc(db, "users", user.uid);

    // Perform atomic transaction for cancellation
    await runTransaction(db, async (transaction) => {
      const sSnap = await transaction.get(subscriptionRef);
      if (!sSnap.exists()) throw new Error("Subscription not found.");

      // Mark subscription as cancelled
      transaction.update(subscriptionRef, {
        status: "cancelled",
        cancelledAt: new Date().toISOString()
      });

      // Update subscription item stats
      transaction.update(itemRef, {
        subscriberCount: increment(-1)
      });
    });

    // Get metadata for logs/Slack
    const [userSnap, itemSnap] = await Promise.all([getDoc(userRef), getDoc(itemRef)]);
    const userData = userSnap.data();
    const itemData = itemSnap.data();

    // Log to history
    await logHistory(user.uid, `Cancelled subscription: ${itemData.name}`, "subscription");

    // Send Slack notification
    const userName = userData.username || 'Unknown user';
    sendSlackMessage(
      `❌ *Subscription Cancelled:* ${userName} cancelled subscription to *${itemData.name}*`
    );

    alert(`✅ Subscription cancelled. You won't be charged again.`);

    // Reload
    // Update local state without re-fetching
    userActiveSubscriptions = userActiveSubscriptions.filter(s => s.id !== subscriptionId);
    renderSubscriptionShop();
    renderUserSubscriptions();

  } catch (err) {
    console.error("Cancel subscription error:", err);
    alert("Failed to cancel: " + err.message);
    btnElement.disabled = false;
    btnElement.textContent = "Cancel Sub";
  }
}

export { renderSubscriptionShop, renderUserSubscriptions };