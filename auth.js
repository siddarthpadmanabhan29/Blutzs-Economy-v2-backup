// ---------- auth.js (Complete - Username Lookup with Status Feedback) ----------
import { auth, db } from "./firebaseConfig.js";
import { 
    signInWithEmailAndPassword, 
    signOut, 
    onAuthStateChanged,
    setPersistence,
    browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    doc, 
    getDoc, 
    setDoc, 
    updateDoc, 
    collection, 
    query, 
    where, 
    getDocs 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// ---------- Admin Username ----------
const ADMIN_USERNAME = "tennismaster29";

// ---------- UI Elements ----------
const loginScreen = document.getElementById("login-screen");
const dashboardScreen = document.getElementById("dashboard");
const loginUsername = document.getElementById("login-username");
const loginPassword = document.getElementById("login-password");
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");

// Global flag to prevent spam clicking without hard-disabling
let isAuthenticating = false;

// ---------- Helper: Show Screen ----------
export function showScreen(id) {
    document.querySelectorAll(".screen").forEach(s => s.classList.add("hidden"));
    const screen = document.getElementById(id);
    if (screen) screen.classList.remove("hidden");
}

/**
 * EXPORTED HELPER: Create/Update User Doc
 * Now includes the actual email field for the lookup login
 */
export async function createOrUpdateUserDoc(uid, username, email) {
    const now = new Date();
    const expiration = new Date(now);
    expiration.setFullYear(now.getFullYear() + 1);

    const userRef = doc(db, "users", uid);
    const snap = await getDoc(userRef);
    const usernameLower = username.toLowerCase().replace(/\s/g, '');
    const isAdmin = usernameLower === ADMIN_USERNAME.toLowerCase();

    if (!snap.exists()) {
        // Brand New User Setup
        await setDoc(userRef, {
            username: username, 
            usernameLower: usernameLower,
            email: email, // Added this for lookup login
            balance: 0,
            bpsBalance: 0,
            history: [],
            renewalDate: now.toISOString(),
            expirationDate: expiration.toISOString(),
            renewalPending: false,
            isAdmin: isAdmin,
            employmentStatus: "Unemployed",
            creditScore: 600,
            activeLoan: 0,
            isEconomyPaused: false,
            membershipLevel: "standard",
            shopOrderCount: 0,
            createdAt: now.toISOString()
        });
        console.log(`Firestore document created for ${usernameLower}`);
    } else {
        // Existing User (Update email field if it's missing)
        await updateDoc(userRef, { 
            lastLogin: now.toISOString(),
            email: email // Keep email in sync
        });
        console.log(`Firestore document linked for existing user: ${usernameLower}`);
    }
}

// ---------- Login Flow (Username Lookup + "Authenticating" Feedback) ----------
loginBtn.addEventListener("click", async () => {
    // If we are already in the middle of a request, ignore additional clicks
    if (isAuthenticating) return;

    const inputName = loginUsername.value.trim().toLowerCase().replace(/\s/g, '');
    const password = loginPassword.value;

    if (!inputName || !password) return alert("Enter both fields");

    // Start state
    isAuthenticating = true;
    loginBtn.textContent = "Authenticating...";
    loginBtn.style.opacity = "0.8";

    try {
        // 1. Search Firestore for the email linked to this username
        const usersRef = collection(db, "users");
        const q = query(usersRef, where("usernameLower", "==", inputName));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            throw new Error("Username not found.");
        }

        const userData = querySnapshot.docs[0].data();
        const actualEmail = userData.email;

        if (!actualEmail) {
            throw new Error("No email linked to this account.");
        }

        // 2. Authenticate
        await setPersistence(auth, browserLocalPersistence);
        const cred = await signInWithEmailAndPassword(auth, actualEmail, password);
        
        await updateDoc(doc(db, "users", cred.user.uid), {
            lastLogin: new Date().toISOString()
        });

    } catch (error) {
        if (error.code === "auth/wrong-password" || error.code === "auth/invalid-credential") {
            alert("Incorrect password.");
        } else {
            alert(error.message);
        }
    } finally {
        // Reset state so user can try again if an error occurred
        // If login was successful, the onAuthStateChanged will handle the screen flip
        isAuthenticating = false;
        loginBtn.textContent = "Login";
        loginBtn.style.opacity = "1";
    }
});

// ---------- Logout ----------
logoutBtn.addEventListener("click", async () => {
    try {
        await signOut(auth);
        loginUsername.value = "";
        loginPassword.value = "";
    } catch (err) {
        console.error("Logout Error:", err);
    }
});

// ---------- Auth State Listener ----------
export let currentUser = null;

onAuthStateChanged(auth, (user) => {
    if (!user) {
        currentUser = null;
        showScreen("login-screen");
        if (dashboardScreen) dashboardScreen.classList.add("hidden");
    } else {
        currentUser = user;
        // Ensure reset in case of page refresh/persistence
        isAuthenticating = false;
        loginBtn.textContent = "Login";
        showScreen("dashboard");
    }
});

// Support for "Enter" key login
loginPassword.addEventListener("keypress", (e) => {
    if (e.key === "Enter") loginBtn.click();
});