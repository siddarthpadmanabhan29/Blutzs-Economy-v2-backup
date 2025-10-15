// ---------- admin.js ----------
console.log("admin.js loaded");

import { db, auth } from "./firebaseConfig.js";
import { 
  collection, doc, getDoc, getDocs, addDoc, updateDoc, query, where, arrayUnion, onSnapshot
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { showScreen } from "./main.js";

// ---------- Elements ----------
const adminPanel = document.getElementById("admin-panel");
const backToDashboardBtn = document.getElementById("back-to-dashboard");

// Add Shop Item
const addItemBtn = document.getElementById("add-item-btn");
const newItemName = document.getElementById("new-item-name");
const newItemPrice = document.getElementById("new-item-price");

// Add Job
const addJobBtn = document.getElementById("add-job-btn");
const newJobName = document.getElementById("new-job-name");
const newJobPay = document.getElementById("new-job-pay");

// Give Money
const adminGiveUsername = document.getElementById("admin-give-username");
const adminGiveAmount = document.getElementById("admin-give-amount");
const adminGiveBtn = document.getElementById("admin-give-btn");
const adminUserInfo = document.getElementById("admin-user-info"); // Shows username + balance

let balanceListener = null; // Tracks real-time listener

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

  if (!name || isNaN(cost) || cost <= 0) return alert("Enter valid item name and cost.");

  await addDoc(collection(db, "shop"), { name, cost });
  alert(`Added item: ${name} ($${cost})`);
  newItemName.value = "";
  newItemPrice.value = "";
}

// ---------- Add Job ----------
async function addJob() {
  const name = newJobName.value.trim();
  const pay = parseFloat(newJobPay.value);

  if (!name || isNaN(pay) || pay <= 0) return alert("Enter valid job name and pay.");

  await addDoc(collection(db, "jobs"), { name, pay });
  alert(`Added job: ${name} ($${pay})`);
  newJobName.value = "";
  newJobPay.value = "";
}

// ---------- Show User Info & Real-time Balance ----------
adminGiveUsername.addEventListener("input", async () => {
  const usernameInput = adminGiveUsername.value.trim().toLowerCase();

  // Remove previous listener
  if (balanceListener) {
    balanceListener();
    balanceListener = null;
  }

  if (!usernameInput) {
    adminUserInfo.textContent = "N/A";
    adminUserInfo.style.color = "gray";
    adminGiveBtn.disabled = true;
    return;
  }

  const usersRef = collection(db, "users");
  const q = query(usersRef, where("usernameLower", "==", usernameInput));
  const snap = await getDocs(q);

  if (snap.empty) {
    adminUserInfo.textContent = "Invalid user";
    adminUserInfo.style.color = "red";
    adminGiveBtn.disabled = true;
  } else {
    const userDoc = snap.docs[0];
    const userRef = doc(db, "users", userDoc.id);

    // Enable button
    adminGiveBtn.disabled = false;

    // Real-time listener for balance updates
    balanceListener = onSnapshot(userRef, (docSnap) => {
      if (!docSnap.exists()) {
        adminUserInfo.textContent = "Invalid user";
        adminUserInfo.style.color = "red";
        adminGiveBtn.disabled = true;
        return;
      }

      const userData = docSnap.data();
      const balance = Number(userData.balance) || 0;
      adminUserInfo.textContent = `${userData.username} — $${balance.toLocaleString()}`;
      adminUserInfo.style.color = "green";
    });
  }
});

// ---------- Give Money ----------
async function giveMoney() {
  try {
    const usernameInput = adminGiveUsername.value.trim().toLowerCase();
    const amount = parseFloat(adminGiveAmount.value);

    if (!usernameInput || isNaN(amount) || amount <= 0) {
      return alert("Enter a valid username and amount.");
    }

    const usersRef = collection(db, "users");
    const q = query(usersRef, where("usernameLower", "==", usernameInput));
    const snap = await getDocs(q);

    if (snap.empty) {
      adminUserInfo.textContent = "Invalid user";
      adminUserInfo.style.color = "red";
      return alert("User not found.");
    }

    const userDoc = snap.docs[0];
    const userRef = doc(db, "users", userDoc.id);
    const userData = userDoc.data();

    const newBalance = (Number(userData.balance) || 0) + amount;

    // Update balance + history
    await updateDoc(userRef, {
      balance: newBalance,
      history: arrayUnion({
        message: `Admin gave $${amount}`,
        type: "admin",
        timestamp: new Date().toISOString()
      })
    });

    alert(`✅ Gave $${amount} to ${userData.username}.`);

    // Reset inputs and info
    adminGiveUsername.value = "";
    adminGiveAmount.value = "";
    adminUserInfo.textContent = "N/A";
    adminUserInfo.style.color = "gray";

    // Remove listener after sending
    if (balanceListener) {
      balanceListener();
      balanceListener = null;
    }

  } catch (err) {
    console.error("❌ Give money failed:", err);
    alert("Failed to give money. Check console for details.");
  }
}

// ---------- Load Renewal Requests ----------
export async function loadRenewalRequests() {
  renewalRequestsContainer.innerHTML = "Loading...";

  const usersRef = collection(db, "users");
  const q = query(usersRef, where("renewalPending", "==", true));
  const snap = await getDocs(q);

  if (snap.empty) {
    renewalRequestsContainer.innerHTML = "<p>No pending renewal requests.</p>";
    return;
  }

  renewalRequestsContainer.innerHTML = "";
  snap.forEach((docSnap) => {
    const userData = docSnap.data();
    const div = document.createElement("div");
    div.classList.add("renew-request");

    div.innerHTML = `
      <span><strong>${userData.username}</strong> — Requested on ${new Date(userData.renewalRequestDate).toLocaleDateString()}</span>
      <button data-id="${docSnap.id}" class="approve-renew">Approve</button>
    `;
    renewalRequestsContainer.appendChild(div);
  });

  attachRenewalListeners();
}

// ---------- Approve Renewal ----------
function attachRenewalListeners() {
  document.querySelectorAll(".approve-renew").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const userRef = doc(db, "users", btn.dataset.id);
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) return;

      const userData = userSnap.data();

      const now = new Date();
      const expiration = new Date(now);
      expiration.setMonth(now.getMonth() + 3);

      await updateDoc(userRef, {
        renewalDate: now.toISOString(),
        expirationDate: expiration.toISOString(),
        renewalPending: false,
        renewalStatus: "Active"
      });

      alert(`Renewed ${userData.username}'s account until ${expiration.toDateString()}.`);

      loadRenewalRequests();
    });
  });
}

// ---------- Navigation ----------
if (backToDashboardBtn) {
  backToDashboardBtn.addEventListener("click", () => showScreen("dashboard"));
}

// ---------- Button Listeners ----------
if (addItemBtn) addItemBtn.addEventListener("click", addShopItem);
if (addJobBtn) addJobBtn.addEventListener("click", addJob);
if (adminGiveBtn) adminGiveBtn.addEventListener("click", giveMoney);
