// ---------- inventory.js (INTEGRATED WITH NEW DASHBOARD UI) ----------
console.log("inventory.js loaded");

import { db, auth } from "../firebaseConfig.js";
import { 
 doc, getDoc, updateDoc, onSnapshot, collection, deleteDoc, increment 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { updateBalanceDisplay } from "../main.js";
import { logHistory } from "../historyManager.js";
import { PLANS } from "../membership_plans.js";
import { sendSlackMessage } from "../slackNotifier.js";
import { getInventoryExpiryInfo } from "../expirationUtils.js";

const inventoryContainer = document.getElementById("inventory-items");
const inventoryValueEl = document.getElementById("inventory-value");
const LOAN_DISCOUNT_TYPE = "loan_discount";

// QUOTA PROTECTION: Store the unsubscribe function globally
let unsubscribeInventory = null;
let activeLoanDiscountModal = null;

function closeLoanDiscountModal() {
  if (activeLoanDiscountModal) {
    activeLoanDiscountModal.remove();
    activeLoanDiscountModal = null;
  }
}

function resetUseButton(btnElement) {
  if (!btnElement) return;
  btnElement.disabled = false;
  btnElement.textContent = "Use";
  btnElement.style.opacity = "1";
}

function getLoanKey(userData) {
  return userData.loanStartDate || "active-loan";
}

function getEligibleLoanOptions(userData) {
  const activeLoan = Number(userData.activeLoan || 0);
  if (activeLoan <= 0) return [];

  const loanKey = getLoanKey(userData);
  if (userData.loanDiscountAppliedForLoanStartDate === loanKey) return [];

  return [{
    loanKey,
    amount: activeLoan,
    startDate: userData.loanStartDate || null,
    deadline: userData.loanDeadline || null
  }];
}

function openLoanDiscountModal({ userRef, userData, itemRef, btnElement }) {
  const eligibleLoans = getEligibleLoanOptions(userData);

  if (eligibleLoans.length === 0) {
    if ((Number(userData.activeLoan || 0)) <= 0) {
      alert("No active loans are available right now. Keep this item in your inventory until you take a loan.");
    } else {
      alert("This loan already has a 10% off discount applied. Take a new loan before using another one.");
    }

    resetUseButton(btnElement);
    return;
  }

  closeLoanDiscountModal();

  const overlay = document.createElement("div");
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.78);
    z-index: 3000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    backdrop-filter: blur(6px);
  `;

  const loanCards = eligibleLoans.map((loan, index) => {
    const deadlineText = loan.deadline ? new Date(loan.deadline).toLocaleDateString() : "No due date";
    const startText = loan.startDate ? new Date(loan.startDate).toLocaleDateString() : "Current loan";

    return `
      <button class="select-loan-option" data-loan-key="${loan.loanKey}"
        style="width: 100%; text-align: left; background: rgba(255,255,255,0.04); border: 1px solid rgba(241,196,15,0.25); color: #fff; border-radius: 10px; padding: 14px; cursor: pointer; transition: 0.2s;">
        <div style="display: flex; justify-content: space-between; gap: 12px; align-items: center;">
          <div>
            <div style="font-size: 0.75rem; color: #f1c40f; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px;">Loan ${index + 1}</div>
            <div style="font-size: 1rem; font-weight: 800; margin-top: 4px;">$${loan.amount.toLocaleString()}</div>
            <div style="font-size: 0.72rem; color: #aaa; margin-top: 4px;">Started: ${startText}</div>
            <div style="font-size: 0.72rem; color: #aaa; margin-top: 2px;">Due: ${deadlineText}</div>
          </div>
          <div style="font-size: 0.7rem; color: #2ecc71; font-weight: 900; text-transform: uppercase;">Apply 10% Off</div>
        </div>
      </button>
    `;
  }).join("");

  overlay.innerHTML = `
    <div style="width: min(520px, 100%); background: linear-gradient(180deg, rgba(18,18,24,0.98), rgba(10,10,14,0.98)); border: 1px solid rgba(241,196,15,0.28); border-radius: 18px; padding: 22px; box-shadow: 0 20px 50px rgba(0,0,0,0.45);">
      <div style="display: flex; justify-content: space-between; align-items: start; gap: 16px; margin-bottom: 16px;">
        <div>
          <h3 style="margin: 0; color: #f1c40f;">🏦 Apply 10% Off Loan</h3>
          <p style="margin: 6px 0 0 0; color: #bbb; font-size: 0.85rem; line-height: 1.4;">Select the active loan you want to discount. Once used on this loan, the item cannot be reused until you take a new loan.</p>
        </div>
        <button id="close-loan-discount-modal" style="background: transparent; border: none; color: #888; font-size: 1.6rem; cursor: pointer; line-height: 1;">×</button>
      </div>
      <div style="display: grid; gap: 10px; margin-bottom: 16px;">
        ${loanCards}
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 10px;">
        <button id="cancel-loan-discount-modal" class="btn-secondary" style="padding: 10px 14px; border-radius: 8px;">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  activeLoanDiscountModal = overlay;

  const teardown = (restoreButton = true) => {
    closeLoanDiscountModal();
    if (restoreButton) resetUseButton(btnElement);
  };
  overlay.querySelector("#close-loan-discount-modal")?.addEventListener("click", () => teardown(true));
  overlay.querySelector("#cancel-loan-discount-modal")?.addEventListener("click", () => teardown(true));
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) teardown(true);
  });

  overlay.querySelectorAll(".select-loan-option").forEach((btn) => {
    btn.addEventListener("mouseenter", () => {
      btn.style.transform = "translateY(-2px)";
      btn.style.borderColor = "rgba(241,196,15,0.55)";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.transform = "translateY(0)";
      btn.style.borderColor = "rgba(241,196,15,0.25)";
    });

    btn.addEventListener("click", async () => {
      const latestSnap = await getDoc(userRef);
      if (!latestSnap.exists()) {
        alert("Your account could not be loaded.");
        teardown(true);
        resetUseButton(btnElement);
        return;
      }

      const latestUserData = latestSnap.data();
      const latestActiveLoan = Number(latestUserData.activeLoan || 0);
      const latestLoanKey = getLoanKey(latestUserData);

      if (latestActiveLoan <= 0) {
        alert("No active loans are available right now. Keep this item in your inventory until you take a loan.");
        teardown(true);
        resetUseButton(btnElement);
        return;
      }

      if (latestUserData.loanDiscountAppliedForLoanStartDate === latestLoanKey) {
        alert("This loan already has a 10% off discount applied. Take a new loan before using another one.");
        teardown(true);
        resetUseButton(btnElement);
        return;
      }

      const newLoanAmount = Math.max(0, Math.floor(latestActiveLoan * 0.9));
      const savings = latestActiveLoan - newLoanAmount;

      try {
        await updateDoc(userRef, {
          activeLoan: newLoanAmount,
          loanDiscountAppliedForLoanStartDate: latestLoanKey,
          loanDiscountAppliedAt: new Date().toISOString()
        });

        await deleteDoc(itemRef);
        await logHistory(auth.currentUser.uid, `Applied 10% loan discount to active loan (-$${savings.toLocaleString()})`, "usage");
        alert(`✅ 10% off applied to your active loan. Saved $${savings.toLocaleString()}.`);
        teardown(false);
      } catch (error) {
        console.error("Loan discount error:", error);
        alert("Failed to apply the loan discount.");
        teardown(true);
        resetUseButton(btnElement);
      }
    });
  });
}

function loadInventory() {
 auth.onAuthStateChanged(async (user) => {
   if (unsubscribeInventory) {
     unsubscribeInventory();
     unsubscribeInventory = null;
   }

   if (!user) return;

   const userRef = doc(db, "users", user.uid);
   const invRef = collection(userRef, "inventory");

   unsubscribeInventory = onSnapshot(invRef, async (snapshot) => {
     inventoryContainer.innerHTML = "";
     let totalValue = 0;
     const expiredItemDeletes = [];

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
       const expiryInfo = getInventoryExpiryInfo(item);

       if (expiryInfo.isExpired) {
         expiredItemDeletes.push(deleteDoc(itemDoc.ref));
         return;
       }

       totalValue += item.value || 0;

       const isFreeItem = item.isFree === true;
       const isCoupon = item.type === 'coupon';
       const isLotteryBypass = item.type === 'lottery_bypass';
       const isPremiumTrial = item.type === 'premium_trial';
       const isInterestBoost = item.type === 'interest_boost';
      const isLoanDiscount = item.type === LOAN_DISCOUNT_TYPE;
       
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
         } else if (isLoanDiscount) {
           borderStyle = "1px solid #f1c40f";
           bgStyle = "rgba(241, 196, 15, 0.08)";
           accentColor = "#f1c40f";
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
             if (isLoanDiscount) itemCard.style.borderColor = "#f1c40f";
       };
       itemCard.onmouseleave = () => {
           itemCard.style.transform = "translateY(0)";
           itemCard.style.backgroundColor = bgStyle;
           itemCard.style.boxShadow = "0 4px 6px rgba(0,0,0,0.1)";
           itemCard.style.borderColor = borderStyle.split(' ')[2] || borderStyle; 
       };

       itemCard.innerHTML = `
         <div style="margin-bottom: 12px; position: relative; z-index: 2;">
           <strong style="display: block; font-size: 0.85rem; color: var(--text-main); margin-bottom: 4px; letter-spacing: 0.3px;">${item.name}</strong>
           <div style="font-size: 0.68rem; color: ${expiryInfo.isExpired ? '#e74c3c' : '#f1c40f'}; font-weight: 800; text-transform: uppercase; letter-spacing: 0.7px; margin-bottom: 4px; line-height: 1.4;">${expiryInfo.expiresLabel} · ${expiryInfo.expiresAtText}</div>
           ${isFreeItem ? 
               `<span style="color: #2ecc71; font-size: 0.6rem; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; background: rgba(46, 204, 113, 0.1); padding: 2px 6px; border-radius: 4px;">Membership Perk</span>` : 
               (isLotteryBypass ? 
                `<span style="color: #a29bfe; font-size: 0.6rem; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; background: rgba(162, 155, 254, 0.1); padding: 2px 6px; border-radius: 4px;">BPS Specialty</span>` :
                (isPremiumTrial ? 
                  `<span style="color: #f1c40f; font-size: 0.6rem; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; background: rgba(241, 196, 15, 0.1); padding: 2px 6px; border-radius: 4px;">Limited Trial</span>` :
                  (isInterestBoost ? 
                    `<span style="color: #2ecc71; font-size: 0.6rem; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; background: rgba(46, 204, 113, 0.1); padding: 2px 6px; border-radius: 4px;">Growth Token</span>` :
                      (isLoanDiscount ?
                        `<span style="color: #f1c40f; font-size: 0.6rem; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; background: rgba(241, 196, 15, 0.1); padding: 2px 6px; border-radius: 4px;">Loan Discount</span>` :
                        `<span style="color: #2ecc71; font-size: 0.8rem; font-weight: 800; font-family: monospace;">$${(item.value || 0).toLocaleString()}</span>`))))
           }
         </div>
         <div style="display: flex; gap: 8px; position: relative; z-index: 2;">
           <button class="use-item btn-primary" data-id="${itemDoc.id}" style="flex: 1; font-size: 0.7rem; padding: 6px 0; font-weight: 800; height: 32px; border-radius: 6px; text-transform: uppercase; cursor: pointer; transition: 0.2s;">Use</button>
             ${(!isFreeItem && !isLotteryBypass && !isPremiumTrial && !isInterestBoost && !isLoanDiscount) ? 
               `<button class="sell-item btn-secondary" data-id="${itemDoc.id}" style="flex: 1; font-size: 0.7rem; padding: 6px 0; background: rgba(231, 76, 60, 0.1); color: #e74c3c; border: 1px solid rgba(231, 76, 60, 0.2); font-weight: 800; height: 32px; border-radius: 6px; text-transform: uppercase; cursor: pointer; transition: 0.2s;">Sell</button>` : 
               ''
           }
         </div>
         <div style="position: absolute; bottom: -10px; right: -10px; width: 40px; height: 40px; background: ${accentColor}; opacity: 0.05; border-radius: 50%;"></div>
       `;
       inventoryContainer.appendChild(itemCard);
     });

     if (expiredItemDeletes.length > 0) {
       await Promise.allSettled(expiredItemDeletes);
     }

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

   // --- SPECIAL LOGIC: LEGACY LOTTERY BYPASS ---
   if (itemData.type === "lottery_bypass") {
       await deleteDoc(itemRef);
       alert("🎟️ This lottery perk is no longer available in the Games system.");
       sendSlackMessage(`🎯 *Item Removed!* \n*User:* ${buyerName} \n*Item:* Legacy Lottery Bypass`);
       return;
   }

     if (itemData.type === LOAN_DISCOUNT_TYPE) {
       openLoanDiscountModal({ userRef, userData, itemRef, btnElement });
       return;
     }

   // --- COUPON LOGIC ---
   if (itemData.type === "coupon") {
     const choice = confirm(
       `How do you want to use this ${itemData.discountValue}% coupon?\n\n` +
       `OK = Use on Regular Shop (activates discount now)\n` +
       `Cancel = Keep in inventory to clip to a Subscription`
     );

     if (!choice) {
       // User chose to keep it for subscription clipping — do nothing, leave in inventory
       if (btnElement) {
         btnElement.disabled = false;
         btnElement.textContent = "Use";
         btnElement.style.opacity = "1";
       }
       return;
     }

     // Activate for regular shop
     await updateDoc(userRef, { activeDiscount: itemData.discountValue / 100 });
     await logHistory(user.uid, `Activated ${itemData.discountValue}% Coupon for regular shop`, "usage");
     await deleteDoc(itemRef);
     alert(`✅ ${itemData.discountValue}% Coupon Activated for your next regular shop purchase!`);
     sendSlackMessage(`🎯 *Item Used!* \n*User:* ${buyerName} \n*Item:* ${itemData.name} \n*Type:* Coupon (Regular Shop)`);
     return; 
   }

   const updates = {};
   let cashbackMsg = "";

     if (itemData.type !== "coupon" && itemData.type !== "lottery_bypass" && itemData.type !== "premium_trial" && itemData.type !== "interest_boost" && itemData.type !== LOAN_DISCOUNT_TYPE) {
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

     if (item.isFree === true || item.type === "lottery_bypass" || item.type === "premium_trial" || item.type === "interest_boost" || item.type === LOAN_DISCOUNT_TYPE) {
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