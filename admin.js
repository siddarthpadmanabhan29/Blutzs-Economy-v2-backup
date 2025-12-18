// ---------- admin.js (FINAL: Search Bars + Subcollection History) ----------
console.log("admin.js loaded");

import { db, auth } from "./firebaseConfig.js";
import { 
  collection, doc, getDoc, getDocs, addDoc, updateDoc, query, where, onSnapshot
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { showScreen } from "./auth.js"; 
import { logHistory } from "./historyManager.js"; // <--- NEW IMPORT

// ---------- Elements ----------
const adminPanel = document.getElementById("admin-panel");
const backToDashboardBtn = document.getElementById("back-to-dashboard");

// Add Shop Item
const addItemBtn = document.getElementById("add-item-btn");
const newItemName = document.getElementById("new-item-name");
const newItemPrice = document.getElementById("new-item-price");
const newItemImage = document.getElementById("new-item-image"); 

// Give Money Elements
const adminGiveUsername = document.getElementById("admin-give-username");
const adminGiveAmount = document.getElementById("admin-give-amount");
const adminGiveBtn = document.getElementById("admin-give-btn");
const adminUserInfo = document.getElementById("admin-user-info");

// Give BPS Elements 
const adminGiveBpsUsername = document.getElementById("admin-give-bps-username");
const adminGiveBpsAmount = document.getElementById("admin-give-bps-amount");
const adminGiveBpsBtn = document.getElementById("admin-give-bps-btn");
const adminBpsUserInfo = document.getElementById("admin-bps-user-info");

let balanceListener = null; 
let bpsListener = null;     

// Renewal Requests
const renewalRequestsContainer = document.getElementById("renewal-requests");

// ---------- Admin Access Check ----------
export async function checkAdminAccess() {
  const user = auth.currentUser;
  if (!user) return false;

  const userRef = doc(db, "users", user.uid);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) return false;

  const userData = userSnap.data();
  return userData.isAdmin === true;
}

// ---------- Add Shop Item ----------
async function addShopItem() {
  const name = newItemName.value.trim();
  const cost = parseFloat(newItemPrice.value);
  const image = newItemImage.value.trim(); 

  if (!name || isNaN(cost) || cost <= 0) return alert("Enter valid item name and cost.");

  await addDoc(collection(db, "shop"), { name, cost, image });
  alert(`Added item: ${name} ($${cost})`);
  newItemName.value = "";
  newItemPrice.value = "";
  newItemImage.value = "";
}

// ---------- 1. Give Money Logic ----------
adminGiveUsername?.addEventListener("input", async () => {
  handleUserLookup(adminGiveUsername, adminUserInfo, adminGiveBtn, "money");
});

// ---------- 2. Give BPS Logic ----------
adminGiveBpsUsername?.addEventListener("input", async () => {
  handleUserLookup(adminGiveBpsUsername, adminBpsUserInfo, adminGiveBpsBtn, "bps");
});

// Generic User Lookup Helper
async function handleUserLookup(inputEl, infoEl, btnEl, type) {
  const usernameInput = inputEl.value.trim().toLowerCase();

  if (type === "money" && balanceListener) { balanceListener(); balanceListener = null; }
  if (type === "bps" && bpsListener) { bpsListener(); bpsListener = null; }

  if (!usernameInput) {
    infoEl.textContent = "N/A";
    infoEl.style.color = "gray";
    btnEl.disabled = true;
    return;
  }

  const usersRef = collection(db, "users");
  const q = query(usersRef, where("username", "==", usernameInput)); 
  const snap = await getDocs(q);

  if (snap.empty) {
    infoEl.textContent = "Invalid user";
    infoEl.style.color = "red";
    btnEl.disabled = true;
  } else {
    const userDoc = snap.docs[0];
    const userRef = doc(db, "users", userDoc.id);

    btnEl.disabled = false;

    const unsubscribe = onSnapshot(userRef, (docSnap) => {
      if (!docSnap.exists()) return;
      const data = docSnap.data();
      
      if (type === "money") {
        infoEl.textContent = `${data.username} — $${(data.balance || 0).toLocaleString()}`;
        infoEl.style.color = "green";
      } else {
        infoEl.textContent = `${data.username} — ${(data.bpsBalance || 0)} BPS`;
        infoEl.style.color = "#8e44ad"; 
      }
    });

    if (type === "money") balanceListener = unsubscribe;
    else bpsListener = unsubscribe;
  }
}

// ---------- Execute Give Money ----------
async function giveMoney() {
  await executeGive(
    adminGiveUsername, 
    adminGiveAmount, 
    adminUserInfo, 
    "balance", 
    "money"
  );
}

// ---------- Execute Give BPS ----------
async function giveBps() {
  await executeGive(
    adminGiveBpsUsername, 
    adminGiveBpsAmount, 
    adminBpsUserInfo, 
    "bpsBalance", 
    "BPS"
  );
}

// Generic Give Function (UPDATED WITH HISTORY LOG)
async function executeGive(inputEl, amountEl, infoEl, field, typeLabel) {
  try {
    const usernameInput = inputEl.value.trim(); 
    const amount = parseFloat(amountEl.value);

    if (!usernameInput || isNaN(amount) || amount <= 0) {
      return alert("Enter a valid username and amount.");
    }

    const usersRef = collection(db, "users");
    const q = query(usersRef, where("username", "==", usernameInput));
    const snap = await getDocs(q);

    if (snap.empty) return alert("User not found.");

    const userDoc = snap.docs[0];
    const userRef = doc(db, "users", userDoc.id);
    const userData = userDoc.data();
    const userId = userDoc.id;

    const currentVal = Number(userData[field]) || 0;
    const newVal = currentVal + amount;

    // 1. Update The Value (Money or BPS)
    await updateDoc(userRef, {
      [field]: newVal
    });

    // 2. Log History (Subcollection)
    await logHistory(userId, `Admin gave ${amount} ${typeLabel}`, "admin");

    alert(`✅ Gave ${amount} ${typeLabel} to ${userData.username}.`);

    // Reset inputs
    inputEl.value = "";
    amountEl.value = "";
    infoEl.textContent = "N/A";
    infoEl.style.color = "gray";

  } catch (err) {
    console.error(`Give ${typeLabel} failed:`, err);
    alert(`Failed to give ${typeLabel}.`);
  }
}

// ---------- Load Renewal Requests (Custom Expiration) ----------
export async function loadRenewalRequests() {
  const renewalRequestsContainer = document.getElementById("renewal-requests");
  if(!renewalRequestsContainer) return;
  
  renewalRequestsContainer.innerHTML = "Loading requests...";

  const usersRef = collection(db, "users");
  const q = query(usersRef, where("renewalPending", "==", true));
  const snap = await getDocs(q);

  if (snap.empty) {
    renewalRequestsContainer.innerHTML = "<p style='color: gray; font-style: italic;'>No pending renewal requests.</p>";
    return;
  }

  renewalRequestsContainer.innerHTML = "";
  
  snap.forEach((docSnap) => {
    const userData = docSnap.data();
    const reqDate = userData.renewalRequestDate ? new Date(userData.renewalRequestDate).toLocaleDateString() : "Unknown";

    const div = document.createElement("div");
    div.classList.add("renew-request");
    div.style.border = "1px solid #ccc";
    div.style.padding = "10px";
    div.style.marginBottom = "10px";
    div.style.borderRadius = "8px";
    div.style.display = "flex";
    div.style.flexDirection = "column"; 
    div.style.gap = "10px";
    div.style.backgroundColor = "#fff";

    div.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
        <div>
          <strong>${userData.username}</strong><br>
          <span style="font-size: 0.85em; color: gray;">Requested: ${reqDate}</span>
        </div>
      </div>
      
      <div style="display: flex; gap: 10px; align-items: center; width: 100%; border-top: 1px solid #eee; padding-top: 10px;">
        <label style="font-size: 0.9em;">Expires:</label>
        <input type="date" id="date-${docSnap.id}" style="padding: 5px; border-radius: 5px; border: 1px solid #ccc;">
        
        <div style="margin-left: auto; display: flex; gap: 5px;">
          <button data-id="${docSnap.id}" class="btn-primary approve-renew" style="background: #2ecc71; padding: 5px 12px; font-size: 0.9em;">Approve</button>
          <button data-id="${docSnap.id}" class="btn-danger deny-renew" style="background: #e74c3c; padding: 5px 12px; font-size: 0.9em;">Deny</button>
        </div>
      </div>
    `;
    renewalRequestsContainer.appendChild(div);
  });

  attachRenewalListeners();
}

function attachRenewalListeners() {
  // --- APPROVE LOGIC (UPDATED WITH HISTORY LOG) ---
  document.querySelectorAll(".approve-renew").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const userId = btn.dataset.id;
      const dateInput = document.getElementById(`date-${userId}`);
      
      if (!dateInput.value) {
        return alert("⚠️ Please select an expiration date first!");
      }

      const userRef = doc(db, "users", userId);
      const expirationDate = new Date(dateInput.value);
      expirationDate.setHours(23, 59, 59); 

      const now = new Date();

      if (expirationDate < now) {
        return alert("Expiration date must be in the future.");
      }

      try {
        await updateDoc(userRef, {
          renewalDate: now.toISOString(),
          expirationDate: expirationDate.toISOString(),
          renewalPending: false 
        });

        // Log History (Subcollection)
        await logHistory(userId, `ID Renewal Approved (Expires ${expirationDate.toLocaleDateString()})`, "admin");

        alert(`✅ Renewal Approved! Expires on ${expirationDate.toLocaleDateString()}`);
        loadRenewalRequests(); 
      } catch (err) {
        console.error(err);
        alert("Error approving: " + err.message);
      }
    });
  });

  // --- DENY LOGIC (UPDATED WITH HISTORY LOG) ---
  document.querySelectorAll(".deny-renew").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const userId = btn.dataset.id;
      const userRef = doc(db, "users", userId);

      if(!confirm("Are you sure you want to deny this request?")) return;

      try {
        await updateDoc(userRef, { 
            renewalPending: false 
        });
        
        // Log History (Subcollection)
        await logHistory(userId, `ID Renewal Request Denied`, "admin");

        alert("❌ Renewal Denied.");
        loadRenewalRequests(); 
      } catch (err) {
        console.error(err);
        alert("Error denying: " + err.message);
      }
    });
  });
}

// ---------- Navigation & Listeners ----------
if (backToDashboardBtn) {
  backToDashboardBtn.addEventListener("click", () => showScreen("dashboard"));
}

if (addItemBtn) addItemBtn.addEventListener("click", addShopItem);
if (adminGiveBtn) adminGiveBtn.addEventListener("click", giveMoney);
if (adminGiveBpsBtn) adminGiveBpsBtn.addEventListener("click", giveBps);

// ---------- Initialize Admin Panel ----------
// 1. Listen for when the "Admin Panel" button is clicked
const openAdminBtn = document.getElementById("open-admin");
if (openAdminBtn) {
  openAdminBtn.addEventListener("click", () => {
    loadRenewalRequests(); 
  });
}

// 2. Also load if we are already viewing the panel (e.g. dev testing)
if (!document.getElementById("admin-panel").classList.contains("hidden")) {
  loadRenewalRequests();
}