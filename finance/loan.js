// ---------- loan.js ----------
import { db, auth } from "../firebaseConfig.js";
import { doc, updateDoc, increment, getDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { logHistory } from "../historyManager.js";

/**
 * getCreditStatus
 * Helper to determine tier based on score.
 * Logic: 0-499 Risky, 500-649 Fair, 650-749 Good, 750-850 Elite
 */
export function getCreditStatus(score) {
    if (score >= 750) return { label: "Elite", color: "#f1c40f", max: 1000000 }; 
    if (score >= 650) return { label: "Good", color: "#2ecc71", max: 500000 };  
    if (score >= 500) return { label: "Fair", color: "#3498db", max: 100000 };  
    return { label: "Risky", color: "#e74c3c", max: 50000 }; 
}

/**
 * applyInterest
 * Logic: 5% interest charged every 24 hours.
 * Penalty: -150 Credit Score if monthly deadline is missed.
 * Insurance: Blutzs Package B provides a 1-day grace period.
 */
export async function applyInterest(uid, userData) {
    if (!userData.activeLoan || userData.activeLoan <= 0) return;

    const now = new Date();
    const lastInterestDate = userData.lastInterestApplied ? new Date(userData.lastInterestApplied) : new Date(userData.loanStartDate);
    const deadline = new Date(userData.loanDeadline);

    // Update UI elements for due date
    const dueDateEl = document.getElementById("loan-due-date");
    if (dueDateEl) {
        const formattedDeadline = deadline.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
        dueDateEl.textContent = `Due: ${formattedDeadline}`;
    }

    // --- INSURANCE LOGIC: Blutzs Package B (1 Day Grace Period) ---
    const hasGracePeriod = userData.insurance?.activePackages?.includes("blutzs_b");
    const effectiveDeadline = new Date(deadline);
    if (hasGracePeriod) {
        effectiveDeadline.setDate(effectiveDeadline.getDate() + 1);
    }

    const diffInMs = now - lastInterestDate;
    const msInDay = 24 * 60 * 60 * 1000;
    const daysElapsed = Math.floor(diffInMs / msInDay);

    if (daysElapsed > 0) {
        const interestPerDay = userData.activeLoan * 0.05;
        const totalInterestToAdd = interestPerDay * daysElapsed;
        
        await updateDoc(doc(db, "users", uid), {
            activeLoan: increment(totalInterestToAdd),
            lastInterestApplied: now.toISOString()
        });
        console.log(`System: Applied ${daysElapsed} days of interest.`);
    }

    if (now > effectiveDeadline && !userData.isEconomyPaused) {
        const currentScore = userData.creditScore || 600;
        await updateDoc(doc(db, "users", uid), { 
            isEconomyPaused: true,
            creditScore: currentScore - 150 
        });
        alert("🚨 LOAN OVERDUE: Economy paused. -150 Credit Score penalty applied.");
    }
}

/**
 * takeOutLoan
 * Tiered borrowing logic. 
 */
export async function takeOutLoan(amount) {
    const user = auth.currentUser;
    if (!user) return;

    const userRef = doc(db, "users", user.uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) return;
    const data = snap.data();

    // 1. Basic Validations
    if (data.activeLoan > 0) return alert("You already have an active loan.");
    if (data.isEconomyPaused) return alert("You cannot take a loan while your economy is paused.");

    // 2. Precise Anti-Spam Cooldown (24 Hours)
    const now = new Date();
    const lastRepay = data.lastRepaymentDate ? new Date(data.lastRepaymentDate) : null;
    
    if (lastRepay) {
        const cooldownMs = 24 * 60 * 60 * 1000;
        const timePassed = now - lastRepay;

        if (timePassed < cooldownMs) {
            const msLeft = cooldownMs - timePassed;
            const hours = Math.floor(msLeft / (1000 * 60 * 60));
            const minutes = Math.floor((msLeft % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((msLeft % (1000 * 60)) / 1000);
            return alert(`Cooling Period Active: Please wait ${hours}h ${minutes}m ${seconds}s before borrowing again.`);
        }
    }

    // 3. Credit Tier Validation
    const currentScore = data.creditScore || 600;
    const status = getCreditStatus(currentScore);

    if (amount > status.max) {
        return alert(`Denied. Your ${status.label} status only allows loans up to $${status.max.toLocaleString()}.`);
    }

    // 30-day fixed window deadline
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + 30);

    try {
        await updateDoc(userRef, {
            balance: increment(amount),
            activeLoan: amount,
            loanStartDate: now.toISOString(),
            lastInterestApplied: now.toISOString(),
            loanDeadline: deadline.toISOString(),
            creditScore: currentScore - 15 
        });

        await logHistory(user.uid, `🏦 Took $${amount.toLocaleString()} loan (${status.label} Tier)`, "admin", now.toISOString());
        const formattedDate = deadline.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
        alert(`Loan approved! Your payment is due on ${formattedDate}. Score dipped (-15) for taking on debt.`);
    } catch (error) {
        console.error("Loan Error:", error);
    }
}

/**
 * repayLoan
 * Logic: Clears debt and boosts score.
 */
export async function repayLoan() {
    const user = auth.currentUser;
    if (!user) return;

    const userRef = doc(db, "users", user.uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) return;
    const data = snap.data();

    const debt = data.activeLoan || 0;
    const balance = data.balance || 0;
    const currentScore = data.creditScore || 600;

    if (debt <= 0) return alert("No active debt to pay.");
    if (balance < debt) return alert("Insufficient funds to cover the debt.");

    const now = new Date();
    const loanStart = new Date(data.loanStartDate);
    const deadline = new Date(data.loanDeadline);
    
    // --- INSURANCE LOGIC: Blutzs Package B (Grace Period Reward Protection) ---
    const hasGracePeriod = data.insurance?.activePackages?.includes("blutzs_b");
    const effectiveDeadline = new Date(deadline);
    if (hasGracePeriod) {
        effectiveDeadline.setDate(effectiveDeadline.getDate() + 1);
    }

    const msHeld = now - loanStart;
    const hoursHeld = msHeld / (1000 * 60 * 60);
    const isOnTime = now <= effectiveDeadline;

    let reward = 0;
    if (hoursHeld >= 1) {
        reward = isOnTime ? 30 : 5;
    }

    try {
        await updateDoc(userRef, {
            balance: increment(-debt),
            activeLoan: 0,
            isEconomyPaused: false,
            creditScore: currentScore + reward,
            lastInterestApplied: null,
            lastRepaymentDate: now.toISOString() 
        });

        await logHistory(user.uid, `✅ Repaid loan of $${debt.toLocaleString()}`, "transfer-out", now.toISOString());
        
        if (hoursHeld < 1) {
            alert("Loan repaid, but no credit boost was earned because the loan was held for less than 1 hour.");
        } else {
            let feedback = isOnTime ? `Loan fully repaid on time! Credit score +${reward}.` : `Loan repaid late. Score +${reward}.`;
            if (hasGracePeriod && now > deadline && now <= effectiveDeadline) {
                feedback = `🛡️ Insurance Grace Period Applied! Loan counted as On-Time. Credit score +${reward}.`;
            }
            alert(feedback);
        }
    } catch (error) {
        console.error("Repayment Error:", error);
        alert("Failed to repay loan.");
    }
}