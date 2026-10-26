// ---------- bpsShop.js (QUOTA OPTIMIZED + SYSTEM UI INTEGRATED) ----------
console.log("bpsShop.js loaded");
import { db, auth } from "../firebaseConfig.js";
import { 
 doc, getDoc, updateDoc, collection, getDocs, arrayUnion, addDoc, query, where, increment, onSnapshot
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// --- NEW BPS SECURITY IMPORTS ---
import { openPinModal } from "../securityModal.js";
import { applyBpsPerk, joinRewardsProgram, cancelRewardsProgram } from "../bpsManager.js";
import { sendSlackMessage } from "../slackNotifier.js";
import { logHistory } from "../historyManager.js";
import { buildBpsBalanceUpdate, getThirtyDayExpiryIso } from "../expirationUtils.js";

const bpsContainer = document.getElementById("bps-shop-items");

// We store data locally to avoid constant database pings
let currentUserData = null;
let currentBpsItems = [];
let bpsShopUnsubscribe = null;
let saleExpiryTimer = null;

/**
 * HELPER: Calculates the effective cost based on Insurance Package C (Cross Go)
 */
function getEffectiveCost(baseCost, userData = currentUserData) {
 const hasInsuranceDiscount = userData?.insurance?.activePackages?.includes("crossgo_c");
 if (hasInsuranceDiscount) {
   return Math.floor(baseCost * 0.9); // 10% Discount
 }
 return baseCost;
}

function getActiveSalePrice(item, now = new Date()) {
 const saleEndsAt = item.saleEndsAt ? new Date(item.saleEndsAt) : null;
 const salePrice = Number(item.salePrice);
 if (!saleEndsAt || !Number.isFinite(saleEndsAt.getTime()) || saleEndsAt <= now ||
     !Number.isSafeInteger(salePrice) || salePrice < 1 || salePrice >= Number(item.cost)) {
   return null;
 }
 return salePrice;
}

async function loadBpsShop() {
 const user = auth.currentUser;
 if (!user) return;

 const userRef = doc(db, "users", user.uid);

 try {
   const userSnap = await getDoc(userRef);
   if (userSnap.exists()) {
     currentUserData = userSnap.data();
   }

   if (bpsShopUnsubscribe) bpsShopUnsubscribe();
   bpsShopUnsubscribe = onSnapshot(collection(db, "bpsShop"), (snapshot) => {
     currentBpsItems = snapshot.docs.map(itemDoc => ({ id: itemDoc.id, ...itemDoc.data() }));
     renderBpsShop();
   }, (err) => {
     console.error("Failed to listen to BPS shop updates:", err);
   });
 } catch (err) {
   console.error("Failed to load BPS shop:", err);
 }
}

/**
 * Renders UI.
 */
function renderBpsShop(externalUserData = null) {
 if (!bpsContainer) return;
 
 if (externalUserData) currentUserData = externalUserData;
 
 const isRegistered = currentUserData?.isLoyaltyRegistered === true;
 const isSubscribed = currentUserData?.isRewardsActive === true;

 bpsContainer.style.display = "grid";
 bpsContainer.style.gridTemplateColumns = "repeat(auto-fill, minmax(220px, 1fr))";
 bpsContainer.style.gap = "20px";
 bpsContainer.style.marginTop = "15px";

 bpsContainer.innerHTML = "";

 // --- UNIFIED BPS HEADER (Merged Registration & Rewards) ---
 const headerDiv = document.createElement("div");
 headerDiv.style.cssText = `
    grid-column: 1 / -1;
    background: ${isRegistered ? 'var(--card-bg)' : 'linear-gradient(135deg, #8e44ad, #6c5ce7)'};
    border: 1px solid ${isSubscribed ? 'purple' : '#8e44ad'};
    border-radius: 14px;
    padding: 20px;
    margin-bottom: 10px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    box-shadow: 0 4px 15px rgba(0,0,0,0.2);
    color: white;
 `;

 if (!isRegistered) {
    // STATE 1: User needs to register PIN
    headerDiv.innerHTML = `
        <div>
            <h3 style="margin:0; display:flex; align-items:center; gap:10px;">Ready for Secure Perks? 🛡️</h3>
            <p style="margin:5px 0 0 0; font-size:0.85rem; opacity: 0.9;">
                Register your 4-digit PIN to secure your wallet and get 10 FREE BPS tokens.
            </p>
        </div>
        <button id="bps-register-btn" style="
            padding: 10px 20px;
            border-radius: 8px;
            border: none;
            font-weight: 900;
            background: white;
            color: #8e44ad;
            cursor: pointer;
            text-transform: uppercase;
            font-size: 0.75rem;
        ">
            Join Rewards ($50,000)
        </button>
    `;
 } else {
    // STATE 2: Registered user, show Rewards Subscription with Renewal Date
    const renewalDateRaw = currentUserData?.rewardsRenewalDate;
    const formattedDate = renewalDateRaw 
        ? new Date(renewalDateRaw).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
        : "Next Billing Cycle";

    headerDiv.innerHTML = `
        <div>
            <h3 style="margin:0; display:flex; align-items:center; gap:10px;">
                ${isSubscribed ? '✅' : '✨'} Blutzs Rewards Program
            </h3>
            <p style="margin:5px 0 0 0; font-size:0.85rem; color:var(--text-muted);">
                ${isSubscribed 
                    ? `Auto-renews for $50,000 on: <span style="color:#2ecc71; font-weight:bold;">${formattedDate}</span>` 
                    : 'Join for $50,000/mo to unlock specialty items + 10 BPS Bonus.'}
            </p>
        </div>
        <button id="rewards-subscription-btn" style="
            padding: 10px 20px;
            border-radius: 8px;
            border: none;
            font-weight: 800;
            cursor: pointer;
            text-transform: uppercase;
            font-size: 0.75rem;
            background: purple;
            color: white;
        ">
            ${isSubscribed ? 'Cancel Rewards' : 'Join Rewards'}
        </button>
    `;
 }
 bpsContainer.appendChild(headerDiv);

 if (currentBpsItems.length === 0) {
   const emptyMsg = document.createElement("p");
   emptyMsg.style.cssText = "color:gray; font-style:italic; grid-column: 1/-1; text-align:center;";
   emptyMsg.textContent = "No specialty coupons currently available.";
   bpsContainer.appendChild(emptyMsg);
 } else {
    const userBPS = Number(currentUserData?.bpsBalance || 0);
    const hasInsuranceDiscount = currentUserData?.insurance?.activePackages?.includes("crossgo_c");
    
    const now = new Date();
    const expirationDate = currentUserData?.expirationDate ? new Date(currentUserData.expirationDate) : null;
    const isExpired = expirationDate && expirationDate < now;

    currentBpsItems.forEach(item => {
        const activeSalePrice = getActiveSalePrice(item, now);
        const saleEndsAt = activeSalePrice !== null ? new Date(item.saleEndsAt) : null;
        const priceBeforeInsurance = activeSalePrice ?? Number(item.cost);
        const finalCost = getEffectiveCost(priceBeforeInsurance);
        const affordable = userBPS >= finalCost;
        const isGiftCard = item.type === "giftcard";
        const isLoanDiscount = item.type === "loan_discount";
        
        // --- UPDATED GATING LOGIC ---
        // Only the basic 10% coupon and the smallest gift card remain unlocked for non-subscribers.
        // Everything else (Interest, Lottery, Premium, High Coupons) requires the subscription.
        const isAlwaysUnlocked = (item.name && item.name === "10% off Coupon") || item.id === "10bps_gift";

        const isLockedBySub = !isSubscribed && !isAlwaysUnlocked;
        
        const isDisabled = !affordable || isExpired || isLockedBySub;

        let btnText = affordable ? (isGiftCard ? "Send Gift" : "Purchase") : "Need Tokens";
        if (isExpired) btnText = "ID Expired";
        if (isLockedBySub) btnText = "Locked 🔒";

        const div = document.createElement("div");
        div.classList.add("shop-item", "bps-item");
        
        const cardBg = isGiftCard 
            ? 'linear-gradient(135deg, #f1c40f, #d35400)' 
            : 'var(--card-bg)'; 

        div.style.cssText = `
            background: ${cardBg};
            border: 1px solid ${isGiftCard ? '#f1c40f' : 'var(--contract-border)'};
            border-radius: 14px;
            padding: 18px;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            opacity: ${isDisabled ? '0.75' : '1'};
            filter: ${isLockedBySub ? 'grayscale(0.8)' : 'none'};
            position: relative;
            overflow: hidden;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            pointer-events: ${isLockedBySub ? 'none' : 'auto'};
        `;

        if (!isDisabled) {
            div.onmouseenter = () => {
                div.style.transform = "translateY(-5px)";
                div.style.borderStyle = "solid";
                div.style.borderColor = isGiftCard ? "#fff" : "#8e44ad";
                div.style.boxShadow = isGiftCard ? "0 8px 20px rgba(241, 196, 15, 0.3)" : "0 8px 20px rgba(142, 68, 173, 0.2)";
            };
            div.onmouseleave = () => {
                div.style.transform = "translateY(0)";
                div.style.borderStyle = "solid";
                div.style.borderColor = isGiftCard ? "#f1c40f" : "var(--contract-border)";
                div.style.boxShadow = "0 4px 6px rgba(0,0,0,0.1)";
            };
        }

        const priceColor = isGiftCard ? "#fff" : "#6c5ce7";
        const itemBadge = isLoanDiscount
            ? `<span style="display: inline-block; font-size: 0.6rem; color: #8e44ad; font-weight: 900; text-transform: uppercase; margin-top: 4px; background: rgba(142, 68, 173, 0.12); padding: 2px 6px; border-radius: 4px;">Applies to one active loan</span>`
            : "";

        const priceHTML = `
            <div style="margin: 10px 0;">
                ${activeSalePrice !== null ? `<span style="text-decoration: line-through; color: ${isGiftCard ? '#eee' : 'var(--text-muted)'}; font-size: 0.8rem; opacity: 0.8;">${Number(item.cost)} BPS</span>` : ""}
                ${hasInsuranceDiscount ? `<span style="display: block; text-decoration: line-through; color: ${isGiftCard ? '#eee' : 'var(--text-muted)'}; font-size: 0.75rem; opacity: 0.8;">${priceBeforeInsurance} BPS</span>` : ""}
                <div style="color: ${priceColor}; font-weight: 900; font-size: 1.3rem; letter-spacing: -0.5px;">${finalCost} <span style="font-size: 0.7rem; opacity: 0.8;">BPS</span></div>
                ${activeSalePrice !== null ? `<div style="display: inline-block; font-size: 0.6rem; color: #fff; font-weight: 800; text-transform: uppercase; margin-top: 4px; background: #e74c3c; padding: 2px 6px; border-radius: 4px;">⚡ Flash sale · ends ${saleEndsAt.toLocaleDateString()}</div>` : ""}
                ${hasInsuranceDiscount ? `<div style="display: inline-block; font-size: 0.6rem; color: #2ecc71; font-weight: 800; text-transform: uppercase; margin-top: 4px; background: rgba(255, 255, 255, 0.15); padding: 2px 6px; border-radius: 4px;">🛡️ Insurance -10%</div>` : ""}
                ${itemBadge}
            </div>`;

        div.innerHTML = `
            <div style="position: relative; z-index: 2;">
            <h4 style="margin:0; font-size: 1rem; font-weight: 700; color: ${isGiftCard ? '#fff' : 'var(--text-main)'}; line-height: 1.2;">${isGiftCard ? '🎁 ' : ''}${item.name}</h4>
            ${priceHTML}
            </div>
            <button class="buy-bps-btn" data-id="${item.id}" data-cost="${finalCost}" ${isDisabled ? "disabled" : ""}
                style="
                    width: 100%; 
                    padding: 10px; 
                    border-radius: 8px; 
                    border: none; 
                    background: ${isDisabled ? '#2c3e50' : (isGiftCard ? '#fff' : 'linear-gradient(135deg, #8e44ad, #6c5ce7)')}; 
                    color: ${isGiftCard && !isDisabled ? '#d35400' : 'white'}; 
                    font-weight: 900; 
                    text-transform: uppercase;
                    font-size: 0.75rem;
                    letter-spacing: 0.5px;
                    cursor: ${isDisabled ? 'not-allowed' : 'pointer'};
                    transition: 0.2s;
                    box-shadow: ${isDisabled ? 'none' : '0 4px 10px rgba(0,0,0,0.2)'};
                ">
            ${btnText}
            </button>
            <div style="position: absolute; top: -15px; right: -15px; width: 70px; height: 70px; background: rgba(255, 255, 255, 0.03); border-radius: 50%; z-index: 1;"></div>
        `;
        bpsContainer.appendChild(div);
    });
 }

 attachBpsListeners();
 scheduleSaleExpiryRefresh();
}

function scheduleSaleExpiryRefresh() {
 if (saleExpiryTimer) clearTimeout(saleExpiryTimer);
 const now = Date.now();
 const nextExpiry = currentBpsItems
   .map(item => new Date(item.saleEndsAt).getTime())
   .filter(expiry => Number.isFinite(expiry) && expiry > now)
   .sort((left, right) => left - right)[0];
 if (nextExpiry) {
   const refreshDelay = Math.min(nextExpiry - now + 100, 2147483647);
   saleExpiryTimer = setTimeout(() => renderBpsShop(), refreshDelay);
 }
}

function attachBpsListeners() {
 // --- REGISTRATION LISTENER ---
 const regBtn = document.getElementById("bps-register-btn");
 if (regBtn) {
    regBtn.onclick = () => {
        openPinModal('register', () => {
            alert("Registration Complete! +10 BPS Bonus added.");
        });
    };
 }

 // --- REWARDS SUBSCRIPTION TOGGLE ---
 const subBtn = document.getElementById("rewards-subscription-btn");
 if (subBtn) {
    subBtn.onclick = async () => {
        const isSubscribed = currentUserData?.isRewardsActive === true;
        if (isSubscribed) {
            if (confirm("Are you sure you want to cancel your Blutzs Rewards subscription? You will lose access to specialty items.")) {
                const res = await cancelRewardsProgram();
                alert(res.message);
            }
        } else {
            if (confirm("Join Blutzs Rewards for $50,000/month? You will receive a 10 BPS bonus!")) {
                const res = await joinRewardsProgram();
                alert(res.message);
            }
        }
    };
 }

 // --- ITEM PURCHASE BUTTONS ---
 document.querySelectorAll(".buy-bps-btn").forEach(btn => {
   btn.addEventListener("click", () => {
       const itemId = btn.dataset.id;

       if (!currentUserData?.isLoyaltyRegistered) {
           openPinModal('register', () => {
               alert("Registration Complete! You can now purchase perks.");
           });
       } else {
           openPinModal('verify', async () => {
               btn.disabled = true;
               btn.style.opacity = "0.7";
               btn.textContent = "Processing...";
               await buyBpsItem(itemId, btn);
           });
       }
   });
 });
}

async function buyBpsItem(itemId, btnElement) {
 const user = auth.currentUser;
 if (!user) return;

 const userRef = doc(db, "users", user.uid);
 const itemRef = doc(db, "bpsShop", itemId);

 try {
   const [userSnap, itemSnap] = await Promise.all([getDoc(userRef), getDoc(itemRef)]);
   if (!userSnap.exists()) {
       alert("Your account could not be loaded. Please try again.");
       return resetBtn(btnElement);
   }
   const userData = userSnap.data();
   const itemData = itemSnap.exists() ? itemSnap.data() : null;
   if (!itemData) {
       alert("That shop item is unavailable right now.");
       return resetBtn(btnElement);
   }
   const senderName = userData.username || userData.displayName || user.uid;

   const now = new Date();
   const finalCost = getEffectiveCost(getActiveSalePrice(itemData, now) ?? Number(itemData.cost), userData);
   const timestampStr = now.toLocaleString();
   const expirationDate = userData.expirationDate ? new Date(userData.expirationDate) : null;
   if (expirationDate && expirationDate < now) {
       alert("⛔ Your ID is expired! Please renew to buy coupons.");
       return resetBtn(btnElement);
   }

   if(Number(userData.bpsBalance || 0) < finalCost) {
       alert("Not enough BPS Tokens!");
       return resetBtn(btnElement);
   }

   // --- GIFT CARD LOGIC ---
   if (itemData.type === "giftcard") {
       const recipientUsername = prompt("🎁 Enter exactly the username of the recipient:");
       if (!recipientUsername) return resetBtn(btnElement);

       if (recipientUsername.toLowerCase() === userData.username.toLowerCase()) {
           alert("❌ You cannot send a gift card to yourself!");
           return resetBtn(btnElement);
       }

       const usersRef = collection(db, "users");
       const q = query(usersRef, where("username", "==", recipientUsername));
       const querySnap = await getDocs(q);

       if (querySnap.empty) {
           alert("User not found! Gift cancelled.");
           return resetBtn(btnElement);
       }

       const recipientDoc = querySnap.docs[0];
       const recipientRef = recipientDoc.ref;
       const recipientData = recipientDoc.data();

       // 1. Update Recipient
       await updateDoc(recipientRef, {
           ...buildBpsBalanceUpdate(recipientData, Number(itemData.value || 0), new Date()),
           bpsLifetimeEarnings: increment(itemData.value)
       });
       await logHistory(recipientDoc.id, `Received BPS Gift: ${itemData.value} BPS from ${senderName}`, "transfer-in");

       // 2. Update Sender
       await updateDoc(userRef, {
           ...buildBpsBalanceUpdate(userData, -finalCost, new Date())
       });
       await logHistory(user.uid, `Sent BPS Gift: ${itemData.value} BPS to ${recipientUsername}`, "transfer-out");

       // 3. SLACK NOTIFICATION
       sendSlackMessage(`🎁 *BPS Gift Sent!*\n*From:* ${senderName}\n*To:* ${recipientUsername}\n*Amount:* ${itemData.value} BPS\n*Time:* ${timestampStr}`);

       alert(`🎁 GIFT SENT! ${itemData.value} BPS added to ${recipientUsername}.`);
       return renderBpsShop();
   }

     if (itemData.type === "loan_discount") {
             const inventoryRef = collection(db, "users", user.uid, "inventory");

             await addDoc(inventoryRef, {
                 name: itemData.name,
                 type: "loan_discount",
                 discountValue: itemData.discountValue || 10,
                 acquiredAt: new Date().toISOString(),
                 expiresAt: getThirtyDayExpiryIso(),
                 isFree: false,
                 value: 0
             });

             await updateDoc(userRef, buildBpsBalanceUpdate(userData, -finalCost, new Date()));

             await logHistory(user.uid, `Purchased ${itemData.name} for ${finalCost} BPS`, "usage");
             sendSlackMessage(`🛒 *BPS Shop Purchase*\n*User:* ${senderName}\n*Item:* ${itemData.name}\n*Cost:* ${finalCost} BPS\n*Time:* ${timestampStr}`);

             alert(`Transaction Successful: ${itemData.name} added to your inventory!`);
             return renderBpsShop();
     }

   // --- SPECIALIZED PERK LOGIC ---
   const specializedPerks = ["taxHoliday", "priceLock", "instantInsurance", "premiumTrial", "interestBoost"];
   if (specializedPerks.includes(itemId)) {
       const success = await applyBpsPerk(itemId, finalCost, userData);
       if (!success) return resetBtn(btnElement);
   } else {
       // Standard Coupon Logic
       const newBpsBalance = Number(userData.bpsBalance || 0) - finalCost;
       await updateDoc(userRef, { bpsBalance: newBpsBalance });

       const inventoryRef = collection(db, "users", user.uid, "inventory");
       await addDoc(inventoryRef, {
         name: itemData.name,
         type: "coupon", 
         discountValue: itemData.value || 0, 
         acquiredAt: new Date().toISOString(),
                 expiresAt: getThirtyDayExpiryIso(),
         isFree: false 
       });

       // Log Activity for standard coupons
       await logHistory(user.uid, `Purchased ${itemData.name} for ${finalCost} BPS`, "usage");
       sendSlackMessage(`🛒 *BPS Shop Purchase*\n*User:* ${senderName}\n*Item:* ${itemData.name}\n*Cost:* ${finalCost} BPS\n*Time:* ${timestampStr}`);
   }

   alert(`Transaction Successful: ${itemData.name} activated!`);
   renderBpsShop();

 } catch (err) {
     console.error(err);
     alert("Error: " + err.message);
     return resetBtn(btnElement);
 }
}

function resetBtn(btn) {
   if(btn) {
       btn.disabled = false;
       btn.style.opacity = "1";
       btn.textContent = "Purchase";
   }
}

auth.onAuthStateChanged(user => {
 if (user) loadBpsShop();
 else {
   if (bpsShopUnsubscribe) bpsShopUnsubscribe();
   bpsShopUnsubscribe = null;
   if (saleExpiryTimer) clearTimeout(saleExpiryTimer);
   saleExpiryTimer = null;
   currentUserData = null;
   currentBpsItems = [];
 }
});

// setInterval(() => {
//  if (currentUserData) {
//    renderBpsShop();
//  }
// }, 10000);

export { loadBpsShop, renderBpsShop };