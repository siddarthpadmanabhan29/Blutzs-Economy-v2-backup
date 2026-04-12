// ---------- inventory.js (INTEGRATED WITH NEW DASHBOARD UI) ----------
console.log("inventory.js loaded");

import { db, auth } from "./firebaseConfig.js";
import { 
 doc, getDoc, updateDoc, onSnapshot, collection, deleteDoc, increment 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { updateBalanceDisplay } from "./main.js";
import { logHistory } from "./historyManager.js";
import { PLANS } from "./membership_plans.js";
import { sendSlackMessage } from "./slackNotifier.js";

const inventoryContainer = document.getElementById("inventory-items");
const inventoryValueEl = document.getElementById("inventory-value");

// QUOTA PROTECTION: Store the unsubscribe function globally
let unsubscribeInventory = null;

function loadInventory() {
 auth.onAuthStateChanged(async (user) => {
   if (unsubscribeInventory) {
     unsubscribeInventory();
     unsubscribeInventory = null;
   }

   if (!user) return;

   const userRef = doc(db, "users", user.uid);
   const invRef = collection(userRef, "inventory");

   unsubscribeInventory = onSnapshot(invRef, (snapshot) => {
     inventoryContainer.innerHTML = "";
     let totalValue = 0;

     if (snapshot.empty) {
       inventoryContainer.innerHTML = `
           <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #888; border: 1px dashed rgba(255,255,255,0.1); border-radius: 12px;">
               <p style="margin:0; font-style: italic;">Your inventory is empty.</p>
           </div>`;
       if (inventoryValueEl) inventoryValueEl.textContent = "Total Value: $0";
       return;
     }

     // Applying Grid Layout for the new UI system
     inventoryContainer.style.display = "grid";
     inventoryContainer.style.gridTemplateColumns = "repeat(auto-fill, minmax(160px, 1fr))";
     inventoryContainer.style.gap = "12px";

     snapshot.forEach((itemDoc) => {
       const item = itemDoc.data();
       totalValue += item.value || 0;

       const isFreeItem = item.isFree === true;
       const isCoupon = item.type === 'coupon';
       const isLotteryBypass = item.type === 'lottery_bypass';
       const isPremiumTrial = item.type === 'premium_trial';
       const isInterestBoost = item.type === 'interest_boost';
       
       const itemCard = document.createElement("div");
       
       // --- DYNAMIC STYLING BASED ON ITEM TYPE ---
       let borderStyle = "1px solid rgba(255,255,255,0.08)";
       let bgStyle = "rgba(255,255,255,0.02)";
       let accentColor = "rgba(255,255,255,0.2)";
       
       if (isCoupon) { 
           borderStyle = "1px dashed #8e44ad"; 
           bgStyle = "rgba(142, 68, 173, 0.05)"; 
           accentColor = "#8e44ad";
       } else if (isLotteryBypass) {
           borderStyle = "1px solid #8e44ad";
           bgStyle = "rgba(142, 68, 173, 0.1)";
           accentColor = "#a29bfe";
       } else if (isPremiumTrial) {
           borderStyle = "1px solid #f1c40f";
           bgStyle = "rgba(241, 196, 15, 0.1)";
           accentColor = "#f1c40f";
       } else if (isInterestBoost) {
           borderStyle = "1px solid #2ecc71";
           bgStyle = "rgba(46, 204, 113, 0.1)";
           accentColor = "#2ecc71";
       } else if (isFreeItem) { 
           borderStyle = "1px solid #2ecc71"; 
           bgStyle = "rgba(46, 204, 113, 0.03)";
           accentColor = "#2ecc71";
       }

       itemCard.style.cssText = `
           background: ${bgStyle};
           border: ${borderStyle};
           padding: 15px;
           border-radius: 12px;
           display: flex;
           flex-direction: column;
           justify-content: space-between;
           transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
           position: relative;
           overflow: hidden;
           box-shadow: 0 4px 6px rgba(0,0,0,0.1);
       `;

       // Interactive Hover Effects via JS
       itemCard.onmouseenter = () => {
           itemCard.style.transform = "translateY(-4px)";
           itemCard.style.backgroundColor = "rgba(255,255,255,0.05)";
           itemCard.style.boxShadow = `0 8px 15px rgba(0,0,0,0.2), 0 0 10px ${accentColor}22`;
           if (isCoupon || isLotteryBypass) itemCard.style.borderColor = "#9b59b6";
           if (isPremiumTrial) itemCard.style.borderColor = "#f39c12";
           if (isInterestBoost) itemCard.style.borderColor = "#27ae60";
       };
       itemCard.onmouseleave = () => {
           itemCard.style.transform = "translateY(0)";
           itemCard.style.backgroundColor = bgStyle;
           itemCard.style.boxShadow = "0 4px 6px rgba(0,0,0,0.1)";
           itemCard.style.borderColor = borderStyle.split(' ')[2] || borderStyle; 
       };

       itemCard.innerHTML = `
         <div style="margin-bottom: 12px; position: relative; z-index: 2;">
           <strong style="display: block; font-size: 0.85rem; color: #fff; margin-bottom: 4px; letter-spacing: 0.3px;">${item.name}</strong>
           ${isFreeItem ? 
               `<span style="color: #2ecc71; font-size: 0.6rem; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; background: rgba(46, 204, 113, 0.1); padding: 2px 6px; border-radius: 4px;">Membership Perk</span>` : 
               (isLotteryBypass ? 
                `<span style="color: #a29bfe; font-size: 0.6rem; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; background: rgba(162, 155, 254, 0.1); padding: 2px 6px; border-radius: 4px;">BPS Specialty</span>` :
                (isPremiumTrial ? 
                  `<span style="color: #f1c40f; font-size: 0.6rem; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; background: rgba(241, 196, 15, 0.1); padding: 2px 6px; border-radius: 4px;">Limited Trial</span>` :
                  (isInterestBoost ? 
                    `<span style="color: #2ecc71; font-size: 0.6rem; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; background: rgba(46, 204, 113, 0.1); padding: 2px 6px; border-radius: 4px;">Growth Token</span>` :
                    `<span style="color: #2ecc71; font-size: 0.8rem; font-weight: 800; font-family: monospace;">$${(item.value || 0).toLocaleString()}</span>`)))
           }
         </div>
         <div style="display: flex; gap: 8px; position: relative; z-index: 2;">
           <button class="use-item btn-primary" data-id="${itemDoc.id}" style="flex: 1; font-size: 0.7rem; padding: 6px 0; font-weight: 800; height: 32px; border-radius: 6px; text-transform: uppercase; cursor: pointer; transition: 0.2s;">Use</button>
           ${(!isFreeItem && !isLotteryBypass && !isPremiumTrial && !isInterestBoost) ? 
               `<button class="sell-item btn-secondary" data-id="${itemDoc.id}" style="flex: 1; font-size: 0.7rem; padding: 6px 0; background: rgba(231, 76, 60, 0.1); color: #e74c3c; border: 1px solid rgba(231, 76, 60, 0.2); font-weight: 800; height: 32px; border-radius: 6px; text-transform: uppercase; cursor: pointer; transition: 0.2s;">Sell</button>` : 
               ''
           }
         </div>
         <div style="position: absolute; bottom: -10px; right: -10px; width: 40px; height: 40px; background: ${accentColor}; opacity: 0.05; border-radius: 50%;"></div>
       `;
       inventoryContainer.appendChild(itemCard);
     });

     if (inventoryValueEl) {
         inventoryValueEl.innerHTML = `Total Value: <strong style="color: #2ecc71; margin-left: 5px; font-size: 1.1rem; text-shadow: 0 0 10px rgba(46, 204, 113, 0.2);">$${totalValue.toLocaleString()}</strong>`;
     }
     attachInventoryListeners();
   }, (error) => {
     console.error("Inventory Error:", error);
     inventoryContainer.innerHTML = "<p style='color:red'>Error loading inventory.</p>";
   });
 });
}

function attachInventoryListeners() {
 document.querySelectorAll(".use-item").forEach((btn) => {
   btn.addEventListener("click", (e) => useItem(btn.dataset.id, e.target));
 });

 document.querySelectorAll(".sell-item").forEach((btn) => {
   btn.addEventListener("click", (e) => sellItem(btn.dataset.id, e.target));
 });
}

// ---------- Use Item Logic ----------
async function useItem(itemId, btnElement) {
 const user = auth.currentUser;
 if (!user) return;

 if(btnElement) {
   btnElement.disabled = true;
   btnElement.textContent = "Processing";
   btnElement.style.opacity = "0.7";
 }

 const userRef = doc(db, "users", user.uid);
 const itemRef = doc(db, "users", user.uid, "inventory", itemId);

 try {
   const [userSnap, itemSnap] = await Promise.all([getDoc(userRef), getDoc(itemRef)]);
   
   if (!userSnap.exists() || !itemSnap.exists()) {
     alert("Item not found.");
     return; 
   }
   
   const userData = userSnap.data();
   const itemData = itemSnap.data();
   const tier = userData.membershipLevel || 'standard';
   const plan = PLANS[tier];
   const buyerName = userData.displayName || userData.username || 'Unknown user';

   // --- SPECIAL LOGIC: INTEREST BOOST ---
   if (itemData.type === "interest_boost") {
       const boostExpiry = new Date();
       boostExpiry.setDate(boostExpiry.getDate() + 30);

       await updateDoc(userRef, {
           "activeBoosts.interestBoostExpiry": boostExpiry.toISOString()
       });

       await logHistory(user.uid, "Activated +1% Interest Boost (30 Days)", "usage");
       await deleteDoc(itemRef);
       alert("📈 Interest Boost Activated! Your retirement fund will grow faster for the next 30 days.");
       sendSlackMessage(`💰 *Boost Activated!* \n*User:* ${buyerName} \n*Perk:* +1% Retirement Interest`);
       return;
   }

   // --- SPECIAL LOGIC: PREMIUM TRIAL ---
   if (itemData.type === "premium_trial") {
       const trialExpiry = new Date();
       trialExpiry.setDate(trialExpiry.getDate() + 7);

       await updateDoc(userRef, {
           membershipLevel: "premium",
           trialExpiration: trialExpiry.toISOString(),
           isRewardsActive: true
       });

       await logHistory(user.uid, "Activated 7-Day Premium Trial", "usage");
       await deleteDoc(itemRef);
       alert("✨ Welcome to Premium! You have 7 days of full access.");
       sendSlackMessage(`🚀 *Trial Activated!* \n*User:* ${buyerName} \n*Tier:* Premium (7 Days)`);
       return;
   }

   // --- SPECIAL LOGIC: LOTTERY BYPASS ---
   if (itemData.type === "lottery_bypass") {
       await updateDoc(userRef, { hasLotteryBypass: true });
       await logHistory(user.uid, `Activated Lottery Bypass`, "usage");
       await deleteDoc(itemRef);
       alert("🎟️ Bypass Activated! You can now buy one extra ticket in the Lottery.");
       sendSlackMessage(`🎯 *Item Used!* \n*User:* ${buyerName} \n*Item:* Lottery Bypass`);
       return;
   }

   // --- COUPON LOGIC ---
   if (itemData.type === "coupon") {
     await updateDoc(userRef, { activeDiscount: itemData.discountValue });
     await logHistory(user.uid, `Activated Coupon: ${itemData.name}`, "usage");
     await deleteDoc(itemRef);
     alert(`✅ Coupon Activated!`);
     sendSlackMessage(`🎯 *Item Used!* \n*User:* ${buyerName} \n*Item:* ${itemData.name} \n*Type:* Coupon`);
     return; 
   }

   const updates = {};
   let cashbackMsg = "";

   if (itemData.type !== "coupon" && itemData.type !== "lottery_bypass" && itemData.type !== "premium_trial" && itemData.type !== "interest_boost") {
       if (plan.cashback > 0) {
           const purchasePriceEstimate = itemData.value * 2;
           const cashbackAmount = Math.floor(purchasePriceEstimate * plan.cashback);
           if (cashbackAmount > 0) {
               updates.balance = increment(cashbackAmount);
               cashbackMsg = ` (Received $${cashbackAmount.toLocaleString()} Cashback!)`;
           }
       }
       if (plan.shopFreeFreq > 0 && itemData.isFree !== true) {
           updates.shopOrderCount = increment(1);
       }
   }

   if (Object.keys(updates).length > 0) {
       await updateDoc(userRef, updates);
       if (updates.balance) {
           const currentBalance = Number(userData.balance || 0);
           const cashbackVal = Math.floor((itemData.value * 2) * plan.cashback);
           const newTotal = currentBalance + cashbackVal;
           
           const formattedBalance = `$${newTotal.toLocaleString()}`;
           updateBalanceDisplay(formattedBalance, "user-balance", "gain");
       }
   }

   await logHistory(user.uid, `Used ${itemData.name}${cashbackMsg}`, "usage");
   await deleteDoc(itemRef);
   alert(`You used ${itemData.name}!${cashbackMsg}`);
   sendSlackMessage(`🎯 *Item Used!* \n*User:* ${buyerName} \n*Item:* ${itemData.name} \n*Type:* Regular`);

 } catch(e) {
   console.error(e);
   alert("Error: " + e.message);
   if(btnElement) {
     btnElement.disabled = false;
     btnElement.textContent = "Use";
     btnElement.style.opacity = "1";
   }
 }
}

// ---------- Sell Item Logic ----------
async function sellItem(itemId, btnElement) {
 const user = auth.currentUser;
 if (!user) return;

 if(btnElement) {
   btnElement.disabled = true;
   btnElement.textContent = "Selling";
   btnElement.style.opacity = "0.7";
 }

 const userRef = doc(db, "users", user.uid);
 const itemRef = doc(db, "users", user.uid, "inventory", itemId);

 try {
   const [userSnap, itemSnap] = await Promise.all([getDoc(userRef), getDoc(itemRef)]);
   if (!userSnap.exists() || !itemSnap.exists()) return;

   const userData = userSnap.data();
   const item = itemSnap.data();

   if (item.isFree === true || item.type === "lottery_bypass" || item.type === "premium_trial" || item.type === "interest_boost") {
       alert("⛔ Specialized items cannot be sold.");
       if(btnElement) {
           btnElement.disabled = true;
           btnElement.textContent = "🎁";
       }
       return;
   }

   const newBalance = (Number(userData.balance) || 0) + (Number(item.value) || 0);
   await updateDoc(userRef, { balance: newBalance });
   await logHistory(user.uid, `Sold ${item.name} for $${item.value}`, "transfer-in");
   await deleteDoc(itemRef);

   const formattedBalance = `$${newBalance.toLocaleString()}`;
   updateBalanceDisplay(formattedBalance, "user-balance", "gain");

   const sellerName = userData.displayName || userData.username || 'Unknown user';
   sendSlackMessage(`💰 *Item Sold!* \n*User:* ${sellerName} \n*Item:* ${item.name} \n*Amount:* $${item.value}`);

 } catch(e) {
   alert("Error: " + e.message);
   if(btnElement) {
     btnElement.disabled = false;
     btnElement.textContent = "Sell";
     btnElement.style.opacity = "1";
   }
 }
}

loadInventory();
export { loadInventory };