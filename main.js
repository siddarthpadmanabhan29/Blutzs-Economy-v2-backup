// ---------- main.js ----------
console.log("main.js loaded");

// Import Firebase setup first (must come before anything else)
import "./firebaseConfig.js";

// Import app feature modules
import "./auth.js";
import "./dashboard.js";
import "./shop.js";
import "./jobs.js";
import "./inventory.js";
import "./transfer.js";
import "./admin.js";
import "./retirement.js";


// ---------- Global UI Helpers (optional) ----------

// Simple helper for switching screens (login, dashboard, admin, etc.)
export function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}

// Fancy balance updater (used by dashboard, shop, admin, etc.)
export function updateBalanceDisplay(balance, elemId = "user-balance", changeType = null) {
  const el = document.getElementById(elemId);
  if (!el) return;

  el.textContent = `$${Number(balance || 0).toFixed(2)}`;
  el.className = balance > 50 ? "balance-good" : (balance >= 20 ? "balance-warning" : "balance-bad");

  el.classList.remove("balance-flash-gain", "balance-flash-loss", "balance-flash-admin", "balance-flash-transfer");
  switch (changeType) {
    case "gain": el.classList.add("balance-flash-gain"); break;
    case "loss": el.classList.add("balance-flash-loss"); break;
    case "admin": el.classList.add("balance-flash-admin"); break;
    case "transfer": el.classList.add("balance-flash-transfer"); break;
  }
  if (changeType) {
    setTimeout(() => {
      el.classList.remove("balance-flash-gain", "balance-flash-loss", "balance-flash-admin", "balance-flash-transfer");
    }, 1000);
  }
}

// ---------- App Startup ----------
console.log("All modules imported successfully. App is ready.");
