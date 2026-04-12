// ---------- bpsShop.js (QUOTA OPTIMIZED + SYSTEM UI INTEGRATED) ----------
console.log("bpsShop.js loaded");
import { db, auth } from "./firebaseConfig.js";
import { 
 doc, getDoc, updateDoc, collection, getDocs, arrayUnion, addDoc, query, where, increment 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// --- NEW BPS SECURITY IMPORTS ---
import { openPinModal } from "./securityModal.js";
import { applyBpsPerk, joinRewardsProgram, cancelRewardsProgram } from "./bpsManager.js";
import { sendSlackMessage } from "./slackNotifier.js";
import { logHistory } from "./historyManager.js";

const bpsContainer = document.getElementById("bps-shop-items");

// We store data locally to avoid constant database pings
let currentUserData = null;
let currentBpsItems = [];

/**
 * HELPER: Calculates the effective cost based on Insurance Package C (Cross Go)
 */
function getEffectiveCost(baseCost) {
 const hasInsuranceDiscount = currentUserData?.insurance?.activePackages?.includes("crossgo_c");
 if (hasInsuranceDiscount) {
   return Math.floor(baseCost * 0.9); // 10% Discount
 }
 return baseCost;
}

async function loadBpsShop() {
 const user = auth.currentUser;
 if (!user) return;

 const shopRef = collection(db, "bpsShop");
 const userRef = doc(db, "users", user.uid);

 try {
   // ONE-TIME FETCH: Read the catalog once to save reads
   const querySnap = await getDocs(shopRef);
   currentBpsItems = [];
   querySnap.forEach(doc => currentBpsItems.push({ id: doc.id, ...doc.data() }));

   // Fetch user data once for the initial render
   const userSnap = await getDoc(userRef);
   if (userSnap.exists()) {
     currentUserData = userSnap.data();
   }

   renderBpsShop();
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
        const finalCost = getEffectiveCost(item.cost);
        const affordable = userBPS >= finalCost;
        const isGiftCard = item.type === "giftcard";
        
        // --- FIXED GATING LOGIC ---
        const isAlwaysUnlocked = (item.name && item.name.includes("10% off")) || 
                                 item.id === "lotteryLimitBypass" || 
                                 item.id === "premiumTrial" || 
                                 item.id === "interestBoost";

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
                div.style.borderColor = isGiftCard ? "#fff" : "#8e44ad";
                div.style.boxShadow = isGiftCard ? "0 8px 20px rgba(241, 196, 15, 0.3)" : "0 8px 20px rgba(142, 68, 173, 0.2)";
            };
            div.onmouseleave = () => {
                div.style.transform = "translateY(0)";
                div.style.borderColor = isGiftCard ? "#f1c40f" : "var(--contract-border)";
                div.style.boxShadow = "0 4px 6px rgba(0,0,0,0.1)";
            };
        }

        const priceColor = isGiftCard ? "#fff" : "#a29bfe";

        const priceHTML = hasInsuranceDiscount 
            ? `
            <div style="margin: 10px 0;">
                <span style="text-decoration: line-through; color: ${isGiftCard ? '#eee' : '#7f8c8d'}; font-size: 0.8rem; opacity: 0.8;">${item.cost} BPS</span>
                <div style="color: ${priceColor}; font-weight: 900; font-size: 1.3rem; letter-spacing: -0.5px;">${finalCost} <span style="font-size: 0.7rem; opacity: 0.8;">BPS</span></div>
                <div style="display: inline-block; font-size: 0.6rem; color: #2ecc71; font-weight: 800; text-transform: uppercase; margin-top: 4px; background: rgba(255, 255, 255, 0.15); padding: 2px 6px; border-radius: 4px;">🛡️ Insurance -10%</div>
            </div>`
            : `
            <div style="margin: 10px 0;">
                <div style="color: ${priceColor}; font-weight: 900; font-size: 1.3rem; letter-spacing: -0.5px;">${item.cost} <span style="font-size: 0.7rem; opacity: 0.8;">BPS</span></div>
            </div>`;

        div.innerHTML = `
            <div style="position: relative; z-index: 2;">
            <h4 style="margin:0; font-size: 1rem; font-weight: 700; color: #fff; line-height: 1.2;">${isGiftCard ? '🎁 ' : ''}${item.name}</h4>
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
       const cost = Number(btn.dataset.cost);

       if (!currentUserData?.isLoyaltyRegistered) {
           openPinModal('register', () => {
               alert("Registration Complete! You can now purchase perks.");
           });
       } else {
           openPinModal('verify', async () => {
               btn.disabled = true;
               btn.style.opacity = "0.7";
               btn.textContent = "Processing...";
               await buyBpsItem(itemId, cost, btn);
           });
       }
   });
 });
}

async function buyBpsItem(itemId, finalCost, btnElement) {
 const user = auth.currentUser;
 if (!user) return;

 const userRef = doc(db, "users", user.uid);
 const itemRef = doc(db, "bpsShop", itemId);

 try {
   const [userSnap, itemSnap] = await Promise.all([getDoc(userRef), getDoc(itemRef)]);
   const userData = userSnap.data();
   const itemData = itemSnap.data();
   const senderName = userData.username || userData.displayName || user.uid;

   const now = new Date();
   const timestampStr = now.toLocaleString();
   const expirationDate = userData.expirationDate ? new Date(userData.expirationDate) : null;
   if (expirationDate && expirationDate < now) {
       alert("⛔ Your ID is expired! Please renew to buy coupons.");
       return resetBtn(btnElement);
   }

   if(userData.bpsBalance < finalCost) {
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
           bpsBalance: increment(itemData.value),
           bpsLifetimeEarnings: increment(itemData.value)
       });
       await logHistory(recipientDoc.id, `Received BPS Gift: ${itemData.value} BPS from ${senderName}`, "transfer-in");

       // 2. Update Sender
       await updateDoc(userRef, {
           bpsBalance: increment(-finalCost)
       });
       await logHistory(user.uid, `Sent BPS Gift: ${itemData.value} BPS to ${recipientUsername}`, "transfer-out");

       // 3. SLACK NOTIFICATION
       sendSlackMessage(`🎁 *BPS Gift Sent!*\n*From:* ${senderName}\n*To:* ${recipientUsername}\n*Amount:* ${itemData.value} BPS\n*Time:* ${timestampStr}`);

       alert(`🎁 GIFT SENT! ${itemData.value} BPS added to ${recipientUsername}.`);
       return renderBpsShop();
   }

   // --- SPECIALIZED PERK LOGIC ---
   const specializedPerks = ["taxHoliday", "priceLock", "instantInsurance", "lotteryLimitBypass", "jackpotDouble", "premiumTrial", "interestBoost"];
   if (specializedPerks.includes(itemId)) {
       const success = await applyBpsPerk(itemId, finalCost, userData);
       if (!success) return resetBtn(btnElement);
   } else {
       // Standard Coupon Logic
       const newBpsBalance = userData.bpsBalance - finalCost;
       await updateDoc(userRef, { bpsBalance: newBpsBalance });

       const inventoryRef = collection(db, "users", user.uid, "inventory");
       await addDoc(inventoryRef, {
         name: itemData.name,
         type: "coupon", 
         discountValue: itemData.value || 0, 
         acquiredAt: new Date().toISOString(),
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

auth.onAuthStateChanged(user => { if(user) loadBpsShop(); });

setInterval(() => {
 if (currentUserData) {
   renderBpsShop();
 }
}, 10000);

export { loadBpsShop, renderBpsShop };