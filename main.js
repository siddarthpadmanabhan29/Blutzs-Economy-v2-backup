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
// Fancy balance updater (Fixed for formatting and CSS preservation)
export function updateBalanceDisplay(balance, elemId = "user-balance", changeType = null) {
  const el = document.getElementById(elemId);
  if (!el) return;

  // 1. Prepare the display value
  let displayValue = balance;

  // If it's a raw number, format it properly. If it's already a string, leave it alone.
  if (typeof balance === 'number') {
      displayValue = `$${balance.toLocaleString()}`;
  } else if (typeof balance === 'string' && !balance.includes('$')) {
      // If it's a string number but missing the symbol
      displayValue = `$${Number(balance).toLocaleString()}`;
  }

  // 2. Set text content safely (prevents $NaN)
  if (displayValue.includes("NaN")) {
      console.warn("Prevented NaN display in balance update.");
      return; 
  }
  el.textContent = displayValue;

  // 3. Update Status Colors WITHOUT deleting your bold/font classes
  el.classList.remove("balance-good", "balance-warning", "balance-bad");
  
  // Strip formatting to check value for status logic
  const numericValue = typeof balance === 'number' ? balance : Number(String(balance).replace(/[^0-9.-]+/g,""));
  
  if (numericValue > 50) el.classList.add("balance-good");
  else if (numericValue >= 20) el.classList.add("balance-warning");
  else el.classList.add("balance-bad");

  // 4. Handle Flash Animations
  el.classList.remove("balance-flash-gain", "balance-flash-loss", "balance-flash-admin", "balance-flash-transfer");
  if (changeType) {
    el.classList.add(`balance-flash-${changeType}`);
    setTimeout(() => {
      el.classList.remove(`balance-flash-${changeType}`);
    }, 1000);
  }
}

// ---------- App Startup ----------
console.log("All modules imported successfully. App is ready.");
