// ---------- historyManager.js ----------
import { db } from "./firebaseConfig.js";
import { collection, addDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/**
 * Logs a history entry for a user
 * @param {string} uid - User UID
 * @param {string} message - Message to log
 * @param {string} type - Type of history (purchase, transfer-in, etc)
 * @param {string} timestamp - Optional ISO timestamp
 */
export async function logHistory(uid, message, type = "usage", timestamp = null) {
  if (!uid) return;
  const historyRef = collection(db, "users", uid, "history_logs");

  try {
    await addDoc(historyRef, {
      message,
      type,
      timestamp: timestamp || new Date().toISOString()
    });
  } catch (err) {
    console.error("Failed to log history:", err);
  }
}
