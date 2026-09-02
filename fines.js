import { db, auth } from "./firebaseConfig.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

export function initFineSystem() {
    auth.onAuthStateChanged((user) => {
        if (!user) return;

        onSnapshot(doc(db, "users", user.uid), async (snap) => {
            if (!snap.exists()) return;
        });
    });
}