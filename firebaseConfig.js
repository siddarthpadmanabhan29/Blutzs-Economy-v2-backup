// ---------- firebaseConfig.js ----------
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// ⚙️ Replace with your Firebase project settings
const firebaseConfig = {
  apiKey: "AIzaSyBCEhZWsXu7Bwhfhv110kF1yCG_dfaMWQA",
  authDomain: "blutzs-economy.firebaseapp.com",
  projectId: "blutzs-economy",
  storageBucket: "blutzs-economy.firebasestorage.app",
  messagingSenderId: "179946460985",
  appId: "1:179946460985:web:9df04b226f78b02e2efae8"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Export to other modules
export { app, auth, db };
