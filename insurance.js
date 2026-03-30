import { db, auth } from "./firebaseConfig.js";
import { 
    doc, updateDoc, increment, runTransaction 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { logHistory } from "./historyManager.js";
import { sendSlackMessage } from "./slackNotifier.js";

// UPDATED PRICING CONFIGURATION
const PRICING = {
    SINGLE_PKG: 35000,
    ALL_IN_FLAT: 290000,
    TOTAL_COUNT: 9
};

export function initInsurance(userData) {
    const pkgButtons = document.querySelectorAll(".package-option");
    const updateBtn = document.getElementById("update-insurance-btn");
    const confirmBtn = document.getElementById("confirm-insurance-payment-btn");
    const cancelBtn = document.getElementById("cancel-insurance-btn");
    const totalDisplay = document.getElementById("insurance-total-cost");
    const billingStatus = document.getElementById("insurance-billing-status");

    if (!updateBtn) return;

    const activePkgs = new Set(userData.insurance?.activePackages || []);
    const pendingPkgs = userData.insurance?.pendingPackages; 
    const hasPendingInDB = pendingPkgs !== null && pendingPkgs !== undefined;
    const initialList = hasPendingInDB ? pendingPkgs : Array.from(activePkgs);
    let stagingPackages = new Set(initialList);

    const calculateTotal = (count) => {
        return count === PRICING.TOTAL_COUNT ? PRICING.ALL_IN_FLAT : count * PRICING.SINGLE_PKG;
    };

    const refreshUI = () => {
        pkgButtons.forEach(btn => {
            const pkg = btn.dataset.pkg;
            btn.classList.remove("selected", "active-policy", "pending-add", "pending-remove");
            if (stagingPackages.has(pkg)) btn.classList.add("selected");
            if (activePkgs.has(pkg)) {
                btn.classList.add("active-policy");
                if (!stagingPackages.has(pkg)) btn.classList.add("pending-remove");
            } else if (stagingPackages.has(pkg)) {
                btn.classList.add("pending-add");
            }
        });

        const total = calculateTotal(stagingPackages.size);
        totalDisplay.textContent = `$${total.toLocaleString()}`;

        const hasActiveCoverage = activePkgs.size > 0;
        const hasNextBillDate = !!userData.insurance?.nextBillingDate;
        const isCancelling = hasPendingInDB && pendingPkgs.length === 0;

        confirmBtn?.classList.add("hidden");
        updateBtn?.classList.add("hidden");
        cancelBtn?.classList.add("hidden");

        if (!hasActiveCoverage && !hasNextBillDate) {
            confirmBtn?.classList.remove("hidden");
            billingStatus.innerHTML = `🛡️ <strong>No Policy</strong><br>New policies start immediately upon payment.`;
        } else if (isCancelling) {
            confirmBtn?.classList.remove("hidden");
            const date = new Date(userData.insurance.nextBillingDate).toLocaleDateString();
            billingStatus.innerHTML = `🛡️ <span style="color: #e74c3c;"><strong>Cancellation Scheduled</strong></span><br>Ends: <strong>${date}</strong>`;
        } else if (hasPendingInDB) {
            updateBtn?.classList.remove("hidden");
            cancelBtn?.classList.remove("hidden");
            const date = new Date(userData.insurance.nextBillingDate).toLocaleDateString();
            billingStatus.innerHTML = `🛡️ <strong>Update Queued</strong><br>Changes apply: <strong>${date}</strong>`;
        } else {
            updateBtn?.classList.remove("hidden");
            cancelBtn?.classList.remove("hidden");
            const date = new Date(userData.insurance.nextBillingDate).toLocaleDateString();
            billingStatus.innerHTML = `🛡️ <strong>Policy Active</strong><br>Next Bill: <strong>${date}</strong>`;
        }

        const currentRegistry = JSON.stringify(initialList.sort());
        const stagingRegistry = JSON.stringify(Array.from(stagingPackages).sort());
        if (updateBtn) updateBtn.disabled = (currentRegistry === stagingRegistry);
    };

    pkgButtons.forEach(btn => {
        btn.onclick = () => {
            const pkg = btn.dataset.pkg;
            stagingPackages.has(pkg) ? stagingPackages.delete(pkg) : stagingPackages.add(pkg);
            refreshUI();
        };
    });

    const handleInitialActivation = async () => {
        const total = calculateTotal(stagingPackages.size);
        if (stagingPackages.size === 0) return alert("Select at least one policy.");
        if (!confirm(`Activate Insurance for $${total.toLocaleString()}?`)) return;

        const userRef = doc(db, "users", auth.currentUser.uid);
        try {
            await runTransaction(db, async (transaction) => {
                const userSnap = await transaction.get(userRef);
                const balance = userSnap.data().balance || 0;
                if (balance < total) throw "Insufficient balance.";

                const nextBill = new Date();
                nextBill.setMonth(nextBill.getMonth() + 1);

                transaction.update(userRef, {
                    balance: increment(-total),
                    "insurance.activePackages": Array.from(stagingPackages),
                    "insurance.monthlyPremium": total,
                    "insurance.nextBillingDate": nextBill.toISOString(),
                    "insurance.pendingPackages": null,
                    "insurance.pendingPremium": null
                });
            });
            
            // SLACK: Immediate notification for new activation
            sendSlackMessage(`🛡️ *New Insurance Policy:* ${userData.username} activated ${stagingPackages.size} policies for $${total.toLocaleString()}.`);
            
            await logHistory(auth.currentUser.uid, `Insurance Activated: -$${total.toLocaleString()}`, "membership");
            location.reload();
        } catch (e) { alert(e); }
    };

    const handleScheduleUpdate = async () => {
        const total = calculateTotal(stagingPackages.size);
        if (stagingPackages.size === 0) return alert("Use Cancel button.");
        if (!confirm(`Schedule update for next month?`)) return;

        try {
            await updateDoc(doc(db, "users", auth.currentUser.uid), {
                "insurance.pendingPackages": Array.from(stagingPackages),
                "insurance.pendingPremium": total
            });
            
            // OPTIONAL SLACK: Notification for scheduled updates
            sendSlackMessage(`⚙️ *Insurance Update Scheduled:* ${userData.username} changed their plan for next month (New Total: $${total.toLocaleString()}).`);
            
            alert("Update scheduled!");
            location.reload();
        } catch (e) { alert(e.message); }
    };

    if (confirmBtn) confirmBtn.onclick = handleInitialActivation;
    if (updateBtn) updateBtn.onclick = handleScheduleUpdate;

    if (cancelBtn) {
        cancelBtn.onclick = async () => {
            if (!confirm("Cancel all insurance at end of cycle?")) return;
            try {
                await updateDoc(doc(db, "users", auth.currentUser.uid), {
                    "insurance.pendingPackages": [],
                    "insurance.pendingPremium": 0
                });
                
                // FIXED: Now sends Slack message IMMEDIATELY when they click cancel
                sendSlackMessage(`🚫 *Insurance Cancellation:* ${userData.username} has scheduled their insurance to stop at the end of the current cycle.`);
                
                location.reload();
            } catch (e) { console.error(e); }
        };
    }

    refreshUI();
    processInsuranceCycle(auth.currentUser.uid, userData);
    checkMondayAllowance(auth.currentUser.uid, userData);
}

async function processInsuranceCycle(uid, userData) {
    if (!userData.insurance?.nextBillingDate) return;
    const now = new Date();
    const billingDate = new Date(userData.insurance.nextBillingDate);

    if (now >= billingDate) {
        try {
            const userRef = doc(db, "users", uid);
            const premium = userData.insurance.pendingPremium ?? userData.insurance.monthlyPremium;
            const nextPackages = userData.insurance.pendingPackages ?? userData.insurance.activePackages;

            if (!nextPackages || nextPackages.length === 0 || (userData.balance || 0) < premium) {
                await updateDoc(userRef, {
                    "insurance.activePackages": [],
                    "insurance.pendingPackages": null,
                    "insurance.pendingPremium": null,
                    "insurance.monthlyPremium": 0,
                    "insurance.nextBillingDate": null
                });
                
                sendSlackMessage(`❌ *Insurance Lapsed:* ${userData.username}'s coverage has officially ended.`);
                return;
            }

            const nextCycle = new Date();
            nextCycle.setMonth(nextCycle.getMonth() + 1);

            await updateDoc(userRef, {
                balance: increment(-premium),
                "insurance.activePackages": nextPackages,
                "insurance.monthlyPremium": premium,
                "insurance.pendingPackages": null,
                "insurance.pendingPremium": null,
                "insurance.nextBillingDate": nextCycle.toISOString()
            });

            sendSlackMessage(`♻️ *Insurance Renewed:* ${userData.username} paid $${premium.toLocaleString()} for another month.`);
            await logHistory(uid, `Insurance Renewed: -$${premium.toLocaleString()}`, "membership");
        } catch (e) { console.error(e); }
    }
}

async function checkMondayAllowance(uid, userData) {
    if (!userData.insurance?.activePackages?.includes("darkblue_c")) return;
    const now = new Date();
    if (now.getDay() !== 1) return;
    const todayStr = now.toISOString().split('T')[0];
    if (userData.insurance.lastBpsDate === todayStr) return;
    try {
        await updateDoc(doc(db, "users", uid), {
            bpsBalance: increment(5),
            "insurance.lastBpsDate": todayStr
        });
    } catch (e) { console.error(e); }
}