// ---------- auth.js ----------
import { auth, db } from "./firebaseConfig.js";
import { 
    signInWithEmailAndPassword, 
    signOut, 
    onAuthStateChanged,
    setPersistence,
    browserLocalPersistence,
    sendPasswordResetEmail // ADDED
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
const forgotPasswordLink = document.getElementById("forgot-password-link"); // ADDED

let isAuthenticating = false;

// ---------- Helper: Show Screen ----------
export function showScreen(id) {
    document.querySelectorAll(".screen").forEach(s => s.classList.add("hidden"));
    const screen = document.getElementById(id);
    if (screen) screen.classList.remove("hidden");
}

/**
 * Helper: Look up email by username
 */
async function getEmailFromUsername(username) {
    const inputName = username.trim().toLowerCase().replace(/\s/g, '');
    const usersRef = collection(db, "users");
    const q = query(usersRef, where("usernameLower", "==", inputName));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
        throw new Error("Username not found.");
    }

    const userData = querySnapshot.docs[0].data();
    if (!userData.email) {
        throw new Error("No email linked to this account. Contact an admin.");
    }
    return userData.email;
}

export async function createOrUpdateUserDoc(uid, username, email) {
    const now = new Date();
    const expiration = new Date(now);
    expiration.setFullYear(now.getFullYear() + 1);

    const userRef = doc(db, "users", uid);
    const snap = await getDoc(userRef);
    const usernameLower = username.toLowerCase().replace(/\s/g, '');
    const isAdmin = usernameLower === ADMIN_USERNAME.toLowerCase();

    if (!snap.exists()) {
        await setDoc(userRef, {
            username: username, 
            usernameLower: usernameLower,
            email: email, 
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
    } else {
        await updateDoc(userRef, { 
            lastLogin: now.toISOString(),
            email: email 
        });
    }
}

// ---------- Login Flow ----------
loginBtn.addEventListener("click", async () => {
    if (isAuthenticating) return;

    const username = loginUsername.value;
    const password = loginPassword.value;

    if (!username || !password) return alert("Enter both fields");

    isAuthenticating = true;
    loginBtn.textContent = "Authenticating...";
    loginBtn.style.opacity = "0.8";

    try {
        const actualEmail = await getEmailFromUsername(username);

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
        isAuthenticating = false;
        loginBtn.textContent = "Login";
        loginBtn.style.opacity = "1";
    }
});

// ---------- Forgot Password Flow ----------
forgotPasswordLink?.addEventListener("click", async (e) => {
    e.preventDefault();
    
    const username = loginUsername.value.trim();
    if (!username) {
        return alert("Please enter your username in the login box first so we know which account to reset.");
    }

    if (!confirm(`Send a password reset link for user "${username}"?`)) return;

    try {
        const email = await getEmailFromUsername(username);
        await sendPasswordResetEmail(auth, email);
        alert(`Success! A password reset link has been sent to the email linked to "${username}". Check your inbox (and spam folder).`);
    } catch (error) {
        alert("Error: " + error.message);
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
        isAuthenticating = false;
        loginBtn.textContent = "Login";
        showScreen("dashboard");
    }
});

loginPassword.addEventListener("keypress", (e) => {
    if (e.key === "Enter") loginBtn.click();
});