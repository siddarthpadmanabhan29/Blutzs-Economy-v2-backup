import { db, auth } from "./firebaseConfig.js";
import { doc, onSnapshot, updateDoc, increment, getDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { sendSlackMessage } from "./slackNotifier.js";

// ---------- Slack Mention Mapping ----------
const SLACK_MENTIONS = {
    "5gvX9n4QYthJre5bvXgSLR3vyB32": "<@U0AAPTL191Q>", // BigArj99
    "FzN6WhykCNTQ0XVYQNeShpkHVos1": "<@U0ABJ6Y9NSU>", // TennisMaster 29
    "JjWCEwZ03nhDj8bb5XwU0ca80qI3": "<@U0AALFBHSCD>"  // Anu728
};

const getMention = (uid, defaultName) => SLACK_MENTIONS[uid] || defaultName;

export function initFineSystem() {
    auth.onAuthStateChanged((user) => {
        if (!user) return;

        const overlay = document.getElementById("fine-lockdown-overlay");
        const amountDisplay = document.getElementById("lockdown-fine-amount");
        const reasonDisplay = document.getElementById("lockdown-fine-reason");
        const dueDisplay = document.getElementById("lockdown-due-date");
        const payBtn = document.getElementById("pay-fine-btn");
        const appealBtn = document.getElementById("appeal-fine-btn");
        const appealStatusMsg = document.getElementById("appeal-status-msg");

        // Listen for Fine Status in the User's document
        onSnapshot(doc(db, "users", user.uid), async (snap) => {
            if (!snap.exists()) return;
            const data = snap.data();

            if (data.activeFine) {
                let fine = data.activeFine;
                const now = new Date();
                const dueDate = new Date(fine.dueDate);
                
                // --- INTEREST LOGIC: Double the fine every 24 hours past due ---
                if (now > dueDate) {
                    const lastInterestDate = new Date(fine.lastInterestDate || fine.dueDate);
                    const hoursPast = (now - lastInterestDate) / (1000 * 60 * 60);

                    if (hoursPast >= 24) {
                        const newAmount = fine.amount * 2;
                        await updateDoc(doc(db, "users", user.uid), {
                            "activeFine.amount": newAmount,
                            "activeFine.lastInterestDate": now.toISOString()
                        });
                        sendSlackMessage(`📈 *FINE INCREASE:* ${getMention(user.uid, data.username)}'s fine has doubled to *$${newAmount.toLocaleString()}* for missing the due date!`);
                        return; // Snapshot will re-trigger with new amount
                    }
                }

                // --- SHOW LOCKDOWN OVERLAY ---
                if (overlay) {
                    overlay.classList.remove("hidden");
                    amountDisplay.textContent = `$${fine.amount.toLocaleString()}`;
                    reasonDisplay.textContent = `Reason: ${fine.reason}`;
                    
                    if (now > dueDate) {
                        dueDisplay.textContent = "⚠️ OVERDUE - DOUBLING DAILY";
                        dueDisplay.style.color = "#e74c3c";
                    } else {
                        dueDisplay.textContent = `Due by: ${dueDate.toLocaleDateString()}`;
                        dueDisplay.style.color = "#f1c40f";
                    }

                    // --- APPEAL UI LOGIC ---
                    if (fine.appealPending) {
                        if (appealBtn) appealBtn.classList.add("hidden");
                        if (payBtn) payBtn.classList.add("hidden");
                        if (appealStatusMsg) appealStatusMsg.classList.remove("hidden");
                    } else {
                        if (appealBtn) appealBtn.classList.remove("hidden");
                        if (payBtn) payBtn.classList.remove("hidden");
                        if (appealStatusMsg) appealStatusMsg.classList.add("hidden");
                    }
                }
            } else {
                if (overlay) overlay.classList.add("hidden");
            }
        });

        // --- HANDLE PAYMENT ---
        if (payBtn) {
            payBtn.onclick = async () => {
                const userRef = doc(db, "users", user.uid);
                const userSnap = await getDoc(userRef);
                const userData = userSnap.data();
                const fineAmount = userData.activeFine.amount;

                if (userData.balance < fineAmount) {
                    return alert("❌ Insufficient Cash! You must have enough to pay the full fine to unlock your dashboard.");
                }

                if (confirm(`Pay $${fineAmount.toLocaleString()} to clear your debt and unlock your dashboard?`)) {
                    try {
                        await updateDoc(userRef, {
                            balance: increment(-fineAmount),
                            activeFine: null // Delete the fine
                        });
                        
                        sendSlackMessage(`🔓 *DEBT CLEARED:* ${getMention(user.uid, userData.username)} has paid their fine of *$${fineAmount.toLocaleString()}* and regained access.`);
                        alert("✅ Fine paid! Dashboard unlocked.");
                    } catch (err) {
                        console.error("Payment failed:", err);
                    }
                }
            };
        }

        // --- HANDLE APPEAL ---
        if (appealBtn) {
            appealBtn.onclick = async () => {
                const appealReason = prompt("Why are you appealing this fine? (Max 100 characters):");
                
                if (appealReason === null) return; // User cancelled prompt
                if (appealReason.trim() === "") return alert("You must provide a reason to appeal.");

                try {
                    const userRef = doc(db, "users", user.uid);
                    await updateDoc(userRef, {
                        "activeFine.appealPending": true,
                        "activeFine.appealReason": appealReason
                    });

                    sendSlackMessage(`👨‍⚖️ *FINE APPEALED:* ${getMention(user.uid, "A user")} has submitted an appeal.\n📝 *Reason:* "${appealReason}"`);
                    alert("Appeal submitted! Your account remains locked until an Admin reviews it.");
                } catch (err) {
                    console.error("Appeal failed:", err);
                    alert("Error submitting appeal.");
                }
            };
        }
    });
}