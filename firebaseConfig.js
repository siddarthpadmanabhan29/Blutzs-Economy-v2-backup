// ---------- firebaseConfig.js ----------
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBCEhZWsXu7Bwhfhv110kF1yCG_dfaMWQA",
  authDomain: "blutzs-economy.firebaseapp.com",
  projectId: "blutzs-economy",
  storageBucket: "blutzs-economy.firebasestorage.app",
  messagingSenderId: "179946460985",
  appId: "1:179946460985:web:9df04b226f78b02e2efae8"
};

// --- MAIN INSTANCE ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- SECONDARY INSTANCE (For Admin User Management) ---
// This allows you to create/reset users without being logged out of your Admin account
const secondaryApp = initializeApp(firebaseConfig, "Secondary");
const secondaryAuth = getAuth(secondaryApp);

// Export everything including the secondaryAuth
export { app, auth, db, secondaryAuth };