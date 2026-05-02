// ---------- admin.refactored.js (REFACTORED: Modular Architecture) ----------
console.log("admin.refactored.js loaded");

import { auth } from "./firebaseConfig.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// ========== ADMIN ACCESS CHECK ==========
export async function checkAdminAccess() {
  const user = auth.currentUser;
  if (!user) return false;
  const { db } = await import("./firebaseConfig.js");
  const userRef = doc(db, "users", user.uid);
  const userSnap = await getDoc(userRef);
  return userSnap.exists() && userSnap.data().isAdmin === true;
}

// ========== RE-EXPORT FUNCTIONS FOR BACKWARD COMPATIBILITY ==========
// Re-export lottery functions so dashboard.js can import them
export { listenForAdminLottery, listenToGlobalTickets, listenForAdminRoster } from "./admin/adminLottery.js";

// ========== MAIN ADMIN INITIALIZATION ==========
let adminInitialized = false;

export async function initializeAdminPanel() {
  if (adminInitialized) return;
  adminInitialized = true;

  try {
    const adminPanel = document.getElementById("admin-panel");
    const openAdminBtn = document.getElementById("open-admin");
    
    if (!adminPanel && !openAdminBtn) {
      console.warn("Admin panel elements not found");
      return;
    }

    console.log("🚀 Initializing admin modules...");

    // Dynamic imports to load only what's needed
    const { initAdminUI } = await import("./admin/adminUtils.js");
    const { initEconomyUI, listenToEconomyStats } = await import("./admin/adminEconomy.js");
    const { listenForAdminLottery, listenToGlobalTickets, listenForAdminRoster } = await import("./admin/adminLottery.js");
    const { listenForAppeals, initFinesUI } = await import("./admin/adminFines.js");
    const { listenToAllEscrow } = await import("./admin/adminEscrow.js");
    const { initMembershipsUI, loadRenewalRequests } = await import("./admin/adminMembers.js");
    const { initCosmeticsUI } = await import("./admin/adminCosmetics.js");
    const { initContractsUI, initEmploymentUI } = await import("./admin/adminContracts.js");
    const { initShopUI, initSubscriptionShopUI } = await import("./admin/adminShop.js");

    console.log("✅ All modules imported");

    // Initialize all UI listeners (event bindings)
    initAdminUI();
    initEconomyUI();
    initShopUI();
    initSubscriptionShopUI();
    initMembershipsUI();
    initFinesUI();
    initCosmeticsUI();
    initEmploymentUI();
    initContractsUI();

    console.log("✅ UI listeners initialized");

    // Setup real-time listeners (Firestore subscriptions)
    listenToEconomyStats();
    listenForAppeals();
    listenToAllEscrow();
    loadRenewalRequests();

    console.log("✅ Real-time listeners activated");
    console.log("✅ Admin panel fully initialized!");
  } catch (err) {
    console.error("❌ Failed to initialize admin panel:", err);
    alert("Error initializing admin panel. Check console for details.");
  }
}
