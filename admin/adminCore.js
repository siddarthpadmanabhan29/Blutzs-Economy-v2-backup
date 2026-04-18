import { db, auth } from "../firebaseConfig.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// Admin access check
export async function checkAdminAccess() {
  const user = auth.currentUser;
  if (!user) return false;
  const userRef = doc(db, "users", user.uid);
  const userSnap = await getDoc(userRef);
  return userSnap.exists() && userSnap.data().isAdmin === true;
}

// Main admin initialization
export async function initializeAdminPanel(onInitComplete) {
  // Dynamically import all admin modules
  const { initAdminUI } = await import("./adminUtils.js");
  const { listenToEconomyStats, listenForAdminLottery, listenToGlobalTickets, listenForAppeals, listenToAllEscrow, listenForAdminRoster } = await import("./adminLottery.js");
  
  // Initialize all listeners
  initAdminUI();
  listenToEconomyStats();
  listenForAdminLottery();
  listenToGlobalTickets();
  listenForAppeals();
  listenToAllEscrow();
  listenForAdminRoster();
  
  if (onInitComplete) onInitComplete();
}