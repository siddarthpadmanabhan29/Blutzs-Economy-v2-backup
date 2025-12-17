// ---------- dashboard.js ----------
import { auth, db } from "./firebaseConfig.js";
import { 
  onAuthStateChanged, 
  signOut 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
  doc, getDoc, updateDoc, onSnapshot 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// ---------- UI Elements ----------
const dashboard = document.getElementById("dashboard");
const adminPanel = document.getElementById("admin-panel");
const userName = document.getElementById("user-name");
const userBalance = document.getElementById("user-balance");
const logoutBtn = document.getElementById("logout-btn");
const openAdminBtn = document.getElementById("open-admin");
const backToDashboardBtn = document.getElementById("back-to-dashboard");

// Profile section
const profileUsername = document.getElementById("profile-username");
const profileUid = document.getElementById("profile-uid");
const profileRenewal = document.getElementById("profile-renewal");
const profileExpiration = document.getElementById("profile-expiration");
const renewalStatus = document.getElementById("renewal-status");
const renewBtn = document.getElementById("renew-btn");

// History table
const historyTable = document.getElementById("history-table");

// ---------- Auth State Listener ----------
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    dashboard.classList.add("hidden");
    adminPanel.classList.add("hidden");
    return;
  }

  dashboard.classList.remove("hidden");

  const userRef = doc(db, "users", user.uid);

  // Listen to live updates for user doc
  onSnapshot(userRef, snap => {
    if (!snap.exists()) return;
    const data = snap.data();
    updateDashboardUI(user, data);

    // Load history in real time
    loadHistory(data.history || []);
  });
});

// ---------- UI Update Function ----------
function updateDashboardUI(user, data) {
  const balance = Number(data.balance) || 0;
  userName.textContent = data.username || user.email.split("@")[0];
  userBalance.textContent = `$${balance.toLocaleString()}`;

  // Profile section
  profileUsername.textContent = data.username || user.email.split("@")[0];
  profileUid.textContent = user.uid.slice(0, 8);

  const now = new Date();
  const renewalDate = data.renewalDate ? new Date(data.renewalDate) : null;
  const expirationDate = data.expirationDate ? new Date(data.expirationDate) : null;

  profileRenewal.textContent = renewalDate ? renewalDate.toLocaleDateString() : "N/A";
  profileExpiration.textContent = expirationDate ? expirationDate.toLocaleDateString() : "N/A";

  if (data.renewalPending) {
    renewalStatus.textContent = "Pending Approval";
    renewalStatus.style.color = "orange";
  } else if (expirationDate && expirationDate < now) {
    renewalStatus.textContent = "Expired";
    renewalStatus.style.color = "red";
  } else {
    renewalStatus.textContent = "Active";
    renewalStatus.style.color = "green";
  }

  if (data.isAdmin) {
    openAdminBtn.classList.remove("hidden");
  } else {
    openAdminBtn.classList.add("hidden");
  }

  // New BPS Logic
  const bps = data.bpsBalance || 0;
  const discount = data.activeDiscount || 0;
  
  // Assuming you add an element with id="user-bps" in index.html
  const bpsEl = document.getElementById("user-bps");
  if(bpsEl) bpsEl.textContent = `${bps} BPS`;

  // Optional: Show active discount indicator
  const discountEl = document.getElementById("active-discount-indicator");
  if(discountEl) {
    if(discount > 0) {
      discountEl.textContent = `🔥 ${discount * 100}% Discount Active!`;
      discountEl.classList.remove("hidden");
    } else {
      discountEl.classList.add("hidden");
    }
  }
}

// ---------- Load History (Latest 20 Entries) ----------
// ---------- dashboard.js (Inside loadHistory) ----------

// ---------- Load History (Latest 20 Entries) ----------
function loadHistory(historyArray) {
  if (!historyTable) return;

  historyTable.innerHTML = "";

  if (!historyArray || historyArray.length === 0) {
    historyTable.innerHTML = `<tr><td>No history yet.</td></tr>`;
    return;
  }

  // 1. FILTER: Remove entries with missing or invalid dates
  const validHistory = historyArray.filter(entry => {
    return entry.timestamp && !isNaN(new Date(entry.timestamp).getTime());
  });

  // 2. SORT: Now safe to sort by newest first
  const recentHistory = validHistory
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 20);

  recentHistory.forEach(entry => {
    const row = document.createElement("tr");

    
    let color = "black";
    if (entry.type === "transfer-in" || entry.type === "transfer") color = "green";
    else if (entry.type === "transfer-out") color = "red";
    else if (entry.type === "purchase") color = "orange";
    else if (entry.type === "admin") color = "blue";
    else if (entry.type === "usage") color = "magenta";

    row.innerHTML = `
      <td style="color: ${color}; font-weight: 500;">${entry.message}</td>
      <td style="text-align:right; color: gray; font-size:0.9em;">
        ${new Date(entry.timestamp).toLocaleString()}
      </td>
    `;
    historyTable.appendChild(row);
  });
}

// ---------- Navigation ----------
openAdminBtn?.addEventListener("click", () => {
  dashboard.classList.add("hidden");
  adminPanel.classList.remove("hidden");
});

backToDashboardBtn?.addEventListener("click", () => {
  adminPanel.classList.add("hidden");
  dashboard.classList.remove("hidden");
});

// ---------- Logout ----------
logoutBtn?.addEventListener("click", async () => {
  await signOut(auth);
  dashboard.classList.add("hidden");
  adminPanel.classList.add("hidden");
});

// ---------- Profile Renewal ----------
renewBtn?.addEventListener("click", async () => {
  if (!auth.currentUser) return;

  const userRef = doc(db, "users", auth.currentUser.uid);

  try {
    await updateDoc(userRef, { 
      renewalPending: true, 
      renewalRequestDate: new Date().toISOString() 
    });
    alert("Renewal request sent. Waiting for admin approval.");
  } catch (err) {
    console.error("Renewal request failed:", err);
    alert("Could not send renewal request: " + err.message);
  }
});

// ---------- Admin Approval Function ----------
export async function approveRenewal(userRef) {
  const now = new Date();
  const expiration = new Date(now);
  expiration.setMonth(now.getMonth() + 3);

  await updateDoc(userRef, {
    renewalDate: now.toISOString(),
    expirationDate: expiration.toISOString(),
    renewalPending: false,
    renewalStatus: "Active"
  });

  alert("User renewal approved. New expiration: " + expiration.toLocaleDateString());
}
