// ---------- historyManager.js ----------
import { db } from "./firebaseConfig.js";
import { collection, addDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/**
 * Logs an event to the user's history.
 * @param {string} userId - The UID of the user.
 * @param {string} message - The text to display.
 * @param {string} type - 'purchase', 'transfer-in', 'transfer-out', 'usage', 'admin', 'contract'
 */
export async function logHistory(userId, message, type) {
  try {
    // Reference to the new subcollection: users -> [uid] -> history_logs
    const historyRef = collection(db, "users", userId, "history_logs");
    
    await addDoc(historyRef, {
      message: message,
      type: type,
      timestamp: new Date().toISOString()
    });
    
    console.log(`History Logged (Subcollection): [${type}] ${message}`);
  } catch (err) {
    console.error("Failed to log history:", err);
  }
}