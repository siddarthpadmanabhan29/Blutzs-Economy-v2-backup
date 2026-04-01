// ---------- bpsShop.js (QUOTA OPTIMIZED + SYSTEM UI INTEGRATED) ----------
console.log("bpsShop.js loaded");
import { db, auth } from "./firebaseConfig.js";
import { 
 doc, getDoc, updateDoc, collection, getDocs, arrayUnion, addDoc 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

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
 * Renders UI. Can accept external user data from dashboard.js
 * to stay updated without any extra reads.
 */
function renderBpsShop(externalUserData = null) {
 if (!bpsContainer) return;
 
 if (externalUserData) currentUserData = externalUserData;
 
 // Apply grid styling directly to container to ensure consistency
 bpsContainer.style.display = "grid";
 bpsContainer.style.gridTemplateColumns = "repeat(auto-fill, minmax(220px, 1fr))";
 bpsContainer.style.gap = "20px";
 bpsContainer.style.marginTop = "15px";

 bpsContainer.innerHTML = "";

 if (currentBpsItems.length === 0) {
   bpsContainer.innerHTML = "<p style='color:gray; font-style:italic; grid-column: 1/-1; text-align:center;'>No specialty coupons currently available.</p>";
   return;
 }

 const userBPS = Number(currentUserData?.bpsBalance || 0);
 const hasInsuranceDiscount = currentUserData?.insurance?.activePackages?.includes("crossgo_c");
 
 // --- Check Expiration (Local Calculation) ---
 const now = new Date();
 const expirationDate = currentUserData?.expirationDate ? new Date(currentUserData.expirationDate) : null;
 const isExpired = expirationDate && expirationDate < now;

 currentBpsItems.forEach(item => {
   const finalCost = getEffectiveCost(item.cost);
   const affordable = userBPS >= finalCost;
   const isDisabled = !affordable || isExpired;

   let btnText = affordable ? "Purchase" : "Need Tokens";
   if (isExpired) btnText = "ID Expired";

   const div = document.createElement("div");
   div.classList.add("shop-item", "bps-item");
   
   // --- IMPROVED STYLING WITH HOVER EFFECTS ---
   div.style.cssText = `
       background: var(--card-bg);
       border: 1px solid var(--contract-border);
       border-radius: 14px;
       padding: 18px;
       display: flex;
       flex-direction: column;
       justify-content: space-between;
       transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
       opacity: ${isDisabled ? '0.75' : '1'};
       position: relative;
       overflow: hidden;
       box-shadow: 0 4px 6px rgba(0,0,0,0.1);
   `;

   // Add Hover interactivity via JS listeners
   if (!isDisabled) {
       div.onmouseenter = () => {
           div.style.transform = "translateY(-5px)";
           div.style.borderColor = "#8e44ad";
           div.style.boxShadow = "0 8px 20px rgba(142, 68, 173, 0.2)";
       };
       div.onmouseleave = () => {
           div.style.transform = "translateY(0)";
           div.style.borderColor = "var(--contract-border)";
           div.style.boxShadow = "0 4px 6px rgba(0,0,0,0.1)";
       };
   }

   // Visual indicator if insurance is saving them money
   const priceHTML = hasInsuranceDiscount 
     ? `
       <div style="margin: 10px 0;">
           <span style="text-decoration: line-through; color: #7f8c8d; font-size: 0.8rem; opacity: 0.8;">${item.cost} BPS</span>
           <div style="color: #a29bfe; font-weight: 900; font-size: 1.3rem; letter-spacing: -0.5px;">${finalCost} <span style="font-size: 0.7rem; opacity: 0.8;">BPS</span></div>
           <div style="display: inline-block; font-size: 0.6rem; color: #2ecc71; font-weight: 800; text-transform: uppercase; margin-top: 4px; background: rgba(46, 204, 113, 0.1); padding: 2px 6px; border-radius: 4px;">🛡️ Insurance -10%</div>
       </div>`
     : `
       <div style="margin: 10px 0;">
           <div style="color: #a29bfe; font-weight: 900; font-size: 1.3rem; letter-spacing: -0.5px;">${item.cost} <span style="font-size: 0.7rem; opacity: 0.8;">BPS</span></div>
       </div>`;

   div.innerHTML = `
     <div style="position: relative; z-index: 2;">
       <h4 style="margin:0; font-size: 1rem; font-weight: 700; color: #fff; line-height: 1.2;">${item.name}</h4>
       ${priceHTML}
     </div>
     <button class="buy-bps-btn" data-id="${item.id}" ${isDisabled ? "disabled" : ""}
         style="
            width: 100%; 
            padding: 10px; 
            border-radius: 8px; 
            border: none; 
            background: ${isDisabled ? '#2c3e50' : 'linear-gradient(135deg, #8e44ad, #6c5ce7)'}; 
            color: white; 
            font-weight: 800; 
            text-transform: uppercase;
            font-size: 0.75rem;
            letter-spacing: 0.5px;
            cursor: ${isDisabled ? 'not-allowed' : 'pointer'};
            transition: 0.2s;
            box-shadow: ${isDisabled ? 'none' : '0 4px 10px rgba(142, 68, 173, 0.3)'};
         ">
       ${btnText}
     </button>
     <!-- Background Decorative Element -->
     <div style="position: absolute; top: -20px; right: -20px; width: 80px; height: 80px; background: rgba(142, 68, 173, 0.05); border-radius: 50%; z-index: 1;"></div>
   `;
   bpsContainer.appendChild(div);
 });

 attachBpsListeners();
}

function attachBpsListeners() {
 document.querySelectorAll(".buy-bps-btn").forEach(btn => {
   btn.addEventListener("click", async () => {
       btn.disabled = true;
       btn.style.opacity = "0.7";
       btn.textContent = "Processing...";
       await buyBpsItem(btn.dataset.id, btn);
   });
 });
}

async function buyBpsItem(itemId, btnElement) {
 const user = auth.currentUser;
 if (!user) return;

 const userRef = doc(db, "users", user.uid);
 const itemRef = doc(db, "bpsShop", itemId);
 const inventoryRef = collection(db, "users", user.uid, "inventory");

 try {
   // Accurate data fetch for the transaction
   const [userSnap, itemSnap] = await Promise.all([getDoc(userRef), getDoc(itemRef)]);
   const userData = userSnap.data();
   const itemData = itemSnap.data();

   // Re-check insurance locally using the fresh snap
   const hasInsuranceDiscount = userData?.insurance?.activePackages?.includes("crossgo_c");
   const finalCost = hasInsuranceDiscount ? Math.floor(itemData.cost * 0.9) : itemData.cost;

   const now = new Date();
   const expirationDate = userData.expirationDate ? new Date(userData.expirationDate) : null;
   if (expirationDate && expirationDate < now) {
       alert("⛔ Your ID is expired! Please renew to buy coupons.");
       return resetBtn(btnElement);
   }

   if(userData.bpsBalance < finalCost) {
       alert("Not enough BPS Tokens!");
       return resetBtn(btnElement);
   }

   const newBpsBalance = userData.bpsBalance - finalCost;

   await updateDoc(userRef, {
     bpsBalance: newBpsBalance,
     // Logic for logging history remains consistent with your system
   });

   await addDoc(inventoryRef, {
     name: itemData.name,
     type: "coupon", 
     discountValue: itemData.value, 
     value: 0, 
     acquiredAt: new Date().toISOString(),
     isFree: false 
   });

   alert(`Bought ${itemData.name}! Check your inventory.`);
   
   // Update local state and refresh UI
   if (currentUserData) currentUserData.bpsBalance = newBpsBalance;
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

// Initialize
auth.onAuthStateChanged(user => { if(user) loadBpsShop(); });

// Heartbeat Timer for visual ID check
setInterval(() => {
 if (currentUserData) {
   renderBpsShop();
 }
}, 10000);

export { loadBpsShop, renderBpsShop };