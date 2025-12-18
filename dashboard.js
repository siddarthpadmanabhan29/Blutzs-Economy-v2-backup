// ---------- dashboard.js (FINAL VERSION) ----------
console.log("dashboard.js loaded");

import { auth, db } from "./firebaseConfig.js";
import { 
  onAuthStateChanged, 
  signOut 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
  doc, onSnapshot, updateDoc, collection, query, orderBy, limit 
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

let currentDashboardData = null; // Store data globally for heartbeat timer

// ---------- Auth State Listener ----------
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    dashboard.classList.add("hidden");
    adminPanel.classList.add("hidden");
    currentDashboardData = null;
    return;
  }

  dashboard.classList.remove("hidden");

  // 1. LISTEN TO USER PROFILE (Balance, Name, Status)
  const userRef = doc(db, "users", user.uid);
  onSnapshot(userRef, snap => {
    if (!snap.exists()) return;
    currentDashboardData = snap.data();
    updateDashboardUI(user);
    // Note: We do NOT load history from here anymore!
  });

  // 2. LISTEN TO HISTORY SUBCOLLECTION (Scalable List)
  const historyRef = collection(db, "users", user.uid, "history_logs");
  const q = query(historyRef, orderBy("timestamp", "desc"), limit(30));

  onSnapshot(q, (snapshot) => {
    const historyData = [];
    snapshot.forEach(doc => {
        historyData.push(doc.data());
    });
    loadHistory(historyData);
  });
});

// ---------- UI Update Function ----------
function updateDashboardUI(user) {
  if (!currentDashboardData) return;
  const data = currentDashboardData;

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

  // Real-time Status Logic
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

  // BPS Logic
  const bps = data.bpsBalance || 0;
  const bpsEl = document.getElementById("user-bps");
  if(bpsEl) bpsEl.textContent = `${bps} BPS`;

  // Active Discount Logic
  const discount = data.activeDiscount || 0;
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

// ---------- Load History (Visual Upgrade) ----------
function loadHistory(historyArray) {
  if (!historyTable) return;
  historyTable.innerHTML = "";

  if (!historyArray || historyArray.length === 0) {
    historyTable.innerHTML = `<tr><td style="padding:15px; text-align:center; color:gray;">No history found.</td></tr>`;
    return;
  }

  // 1. FILTER: Remove bad dates
  const validHistory = historyArray.filter(entry => 
    entry.timestamp && !isNaN(new Date(entry.timestamp).getTime())
  );

  // 2. RENDER (Already sorted by Firestore query, but double check doesn't hurt)
  validHistory.forEach(entry => {
    const row = document.createElement("tr");
    
    // --- ICON & COLOR LOGIC ---
    let icon = "📄";
    let bg = "#f8f9fa";
    let border = "#ddd";

    switch(entry.type) {
        case "transfer-in":  icon = "💸"; bg = "#e8f8f5"; border = "#2ecc71"; break; // Green
        case "transfer-out": icon = "📤"; bg = "#fdedec"; border = "#e74c3c"; break; // Red
        case "purchase":     icon = "🛒"; bg = "#fef9e7"; border = "#f1c40f"; break; // Yellow
        case "usage":        icon = "🧪"; bg = "#f4f6f7"; border = "#95a5a6"; break; // Gray
        case "admin":        icon = "🛡️"; bg = "#eaf2f8"; border = "#3498db"; break; // Blue
        case "contract":     icon = "📝"; bg = "#fdf2e9"; border = "#e67e22"; break; // Orange
    }

    // --- RELATIVE TIME LOGIC ---
    const timeString = getRelativeTime(new Date(entry.timestamp));

    row.innerHTML = `
      <td style="padding: 12px; border-bottom: 1px solid #eee;">
        <div style="display: flex; align-items: center; gap: 15px;">
            <div style="
                font-size: 1.5em; 
                background: ${bg}; 
                border: 2px solid ${border}; 
                width: 40px; height: 40px; 
                border-radius: 50%; 
                display: flex; align-items: center; justify-content: center;
            ">${icon}</div>
            
            <div style="display: flex; flex-direction: column;">
                <span style="font-weight: 600; color: #333;">${entry.message}</span>
                <span style="font-size: 0.8em; color: gray;">${timeString}</span>
            </div>
        </div>
      </td>
    `;
    historyTable.appendChild(row);
  });
}

// Helper: Converts date to "5 mins ago"
function getRelativeTime(date) {
  const now = new Date();
  const diff = Math.floor((now - date) / 1000); // Difference in seconds

  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} mins ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  return date.toLocaleDateString(); 
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

// ---------- Profile Renewal Request ----------
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

// ---------- Heartbeat Timer ----------
// Checks every 5 seconds if status changed (e.g. Active -> Expired)
setInterval(() => {
  if (auth.currentUser && currentDashboardData) {
    updateDashboardUI(auth.currentUser);
  }
}, 5000);