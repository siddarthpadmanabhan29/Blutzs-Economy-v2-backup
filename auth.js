// ---------- auth.js ----------
import { auth, db } from "./firebaseConfig.js";
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// ---------- Admin Username ----------
const ADMIN_USERNAME = "tennismaster29";

// ---------- UI Elements ----------
const loginScreen = document.getElementById("login-screen");
const dashboardScreen = document.getElementById("dashboard");
const loginUsername = document.getElementById("login-username");
const loginPassword = document.getElementById("login-password");
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");

// ---------- Helper: Show Screen ----------
export function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}

// ---------- Helper: Create/Update User Doc ----------
export async function createOrUpdateUserDoc(uid, username) {
  const now = new Date();
  const expiration = new Date(now);
  expiration.setFullYear(now.getFullYear() + 1);

  const userRef = doc(db, "users", uid);
  const snap = await getDoc(userRef);
  const usernameLower = username.toLowerCase();
  const isAdmin = usernameLower === ADMIN_USERNAME.toLowerCase();

  if (!snap.exists()) {
    await setDoc(userRef, {
      username,
      usernameLower,
      balance: 0,
      history: [],
      renewalDate: now.toISOString(),
      expirationDate: expiration.toISOString(),
      renewalPending: false,
      isAdmin
    });
  } else {
    const data = snap.data();
    const updateData = {};
    if (!data.username) updateData.username = username;
    if (!data.usernameLower) updateData.usernameLower = usernameLower;
    if (data.balance === undefined) updateData.balance = 0;
    if (!data.history) updateData.history = [];
    if (!data.renewalDate) updateData.renewalDate = now.toISOString();
    if (!data.expirationDate) updateData.expirationDate = expiration.toISOString();
    if (data.renewalPending === undefined) updateData.renewalPending = false;
    if (data.isAdmin === undefined) updateData.isAdmin = isAdmin;
    if (Object.keys(updateData).length > 0) await updateDoc(userRef, updateData);
  }
}

// ---------- Login / Register ----------
loginBtn.addEventListener("click", async () => {
  const username = loginUsername.value.trim();
  const password = loginPassword.value.trim();
  if (!username || !password) return alert("Enter both fields");

  const email = username + "@demo.com";

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    if (error.code === "auth/user-not-found" || error.code === "auth/wrong-password") {
      // create account if not found
      try {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await createOrUpdateUserDoc(cred.user.uid, username);
      } catch (err) {
        alert("Register failed: " + err.message);
      }
    } else {
      alert("Login failed: " + error.message);
    }
  }
});

// ---------- Logout ----------
logoutBtn.addEventListener("click", async () => {
  await signOut(auth);
  loginUsername.value = "";
  loginPassword.value = "";
  dashboardScreen.classList.add("hidden");
});

// ---------- Auth State Listener ----------
export let currentUser = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    currentUser = null;
    showScreen("login-screen");
    return;
  }

  currentUser = user;
  showScreen("dashboard");

  const username = user.email.split("@")[0];
  await createOrUpdateUserDoc(user.uid, username);
});
