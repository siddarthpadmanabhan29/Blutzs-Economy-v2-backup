// ---------- insurance.js (ULTRA-MODERN REDESIGN + SLACK RESTORED) ----------
import { db, auth } from "../firebaseConfig.js";
import { 
    doc, updateDoc, increment, runTransaction 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { logHistory } from "../historyManager.js";
import { sendSlackMessage } from "../slackNotifier.js";

// UPDATED PRICING CONFIGURATION
const PRICING = {
    SINGLE_PKG: 35000,
    ALL_IN_FLAT: 290000,
    TOTAL_COUNT: 9
};

const POLICY_MAP = {
    "blutzs_c": "contract_guard", 
    "darkblue_c": "darkblue_c", 
    "crossgo_b": "crossgo_b"
};

// FIX: Pre-built inverse map so toRawKey is O(1) and immune to duplicate-value
// ambiguity that the previous Object.entries().find() approach could silently mishandle.
const POLICY_MAP_INVERSE = Object.fromEntries(
    Object.entries(POLICY_MAP).map(([raw, mapped]) => [mapped, raw])
);

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Convert a raw btn.dataset.pkg key → the mapped DB key */
const toMappedKey = (rawKey) => POLICY_MAP[rawKey] || rawKey;

/** Convert a mapped DB key back → raw btn.dataset.pkg key */
const toRawKey = (mappedKey) => POLICY_MAP_INVERSE[mappedKey] || mappedKey;

const toSortedMappedJSON = (rawKeyIterable) =>
    JSON.stringify([...rawKeyIterable].map(toMappedKey).sort());

const isPendingCancellation = (pendingPkgs) =>
    Array.isArray(pendingPkgs) && pendingPkgs.length === 0;

// ─── Main export ─────────────────────────────────────────────────────────────

export function initInsurance(userData) {
    const pkgButtons   = document.querySelectorAll(".package-option");
    const updateBtn    = document.getElementById("update-insurance-btn");
    const confirmBtn   = document.getElementById("confirm-insurance-payment-btn");
    const cancelBtn    = document.getElementById("cancel-insurance-btn");
    const totalDisplay = document.getElementById("insurance-total-cost");
    const billingStatus= document.getElementById("insurance-billing-status");

    if (!updateBtn) return;

    const activePkgs   = new Set(userData.insurance?.activePackages || []);
    const pendingPkgs  = userData.insurance?.pendingPackages;
    const hasPendingInDB = pendingPkgs !== null && pendingPkgs !== undefined;

    const initialList = hasPendingInDB
        ? pendingPkgs.map(toRawKey)
        : Array.from(activePkgs).map(toRawKey);

    let stagingPackages = new Set(initialList);

    const calculateTotal = (count) =>
        count === PRICING.TOTAL_COUNT ? PRICING.ALL_IN_FLAT : count * PRICING.SINGLE_PKG;

    // ─── UI Refresh ──────────────────────────────────────────────────────────

    const refreshUI = () => {
        let activeCount       = 0;
        let pendingAddCount   = 0;
        let pendingRemoveCount= 0;

        pkgButtons.forEach(btn => {
            const pkg       = btn.dataset.pkg;
            const mappedPkg = toMappedKey(pkg);

            const isActiveInDB  = activePkgs.has(mappedPkg);
            const isStagedInUI  = stagingPackages.has(pkg);

            btn.classList.remove("selected", "active-policy", "pending-add", "pending-remove");

            if (isActiveInDB && isStagedInUI) {
                activeCount++;
                btn.style.cssText = `
                    border: 2px solid #3498db;
                    background: rgba(52, 152, 219, 0.12);
                    box-shadow: 0 0 12px rgba(52, 152, 219, 0.2);
                    opacity: 1; filter: none; text-decoration: none;
                `;
                btn.classList.add("active-policy", "selected");

            } else if (isActiveInDB && !isStagedInUI) {
                pendingRemoveCount++;
                btn.style.cssText = `
                    border: 2px dashed #e74c3c;
                    background: rgba(231, 76, 60, 0.05);
                    opacity: 0.5; filter: grayscale(1);
                    text-decoration: line-through; color: #e74c3c;
                `;
                btn.classList.add("active-policy", "pending-remove");

            } else if (!isActiveInDB && isStagedInUI) {
                pendingAddCount++;
                btn.style.cssText = `
                    border: 2px solid #2ecc71;
                    background: rgba(46, 204, 113, 0.12);
                    box-shadow: 0 0 15px rgba(46, 204, 113, 0.25);
                    opacity: 1; filter: none; text-decoration: none;
                `;
                btn.classList.add("selected", "pending-add");

            } else {
                btn.style.cssText = `
                    border: 1px solid rgba(255,255,255,0.05);
                    background: rgba(255,255,255,0.02);
                    opacity: 0.7; filter: none; text-decoration: none; color: inherit;
                `;
            }
        });

        const total = calculateTotal(stagingPackages.size);
        if (totalDisplay) {
            totalDisplay.textContent = `$${total.toLocaleString()}`;
            totalDisplay.style.color = stagingPackages.size > 0 ? "#fff" : "#444";
        }

        const badgesHTML = `
            <div style="display:flex;gap:6px;justify-content:flex-end;margin-bottom:12px;
                        font-weight:900;font-family:sans-serif;font-size:0.6rem;letter-spacing:1px;">
                <span style="background:#3498db;color:#fff;padding:3px 10px;border-radius:4px;
                             box-shadow:0 2px 8px rgba(52,152,219,0.3);">ACTIVE [${activeCount}]</span>
                ${pendingAddCount > 0
                    ? `<span style="background:#2ecc71;color:#fff;padding:3px 10px;border-radius:4px;
                                   box-shadow:0 2px 8px rgba(46,204,113,0.3);">+${pendingAddCount} NEW</span>`
                    : ''}
                ${pendingRemoveCount > 0
                    ? `<span style="background:#e74c3c;color:#fff;padding:3px 10px;border-radius:4px;
                                   box-shadow:0 2px 8px rgba(231,76,60,0.3);">-${pendingRemoveCount} DROP</span>`
                    : ''}
            </div>`;

        const hasActiveCoverage = activePkgs.size > 0;
        const hasNextBillDate   = !!userData.insurance?.nextBillingDate;
        const isCancelling      = hasPendingInDB && isPendingCancellation(pendingPkgs);

        confirmBtn?.classList.add("hidden");
        updateBtn?.classList.add("hidden");
        cancelBtn?.classList.add("hidden");

        const statusStyle = "padding:12px 15px;border-radius:10px;font-size:0.75rem;line-height:1.4;";

        if (!hasActiveCoverage && !hasNextBillDate) {
            confirmBtn?.classList.remove("hidden");
            billingStatus.innerHTML = `${badgesHTML}
                <div style="${statusStyle} background:rgba(255,255,255,0.03);
                     border:1px solid rgba(255,255,255,0.1);color:#888;">
                    <strong>NO COVERAGE</strong><br>Establish a policy to secure your assets.
                </div>`;

        } else if (isCancelling) {
            confirmBtn?.classList.remove("hidden");
            const date = new Date(userData.insurance.nextBillingDate).toLocaleDateString();
            billingStatus.innerHTML = `${badgesHTML}
                <div style="${statusStyle} background:rgba(231,76,60,0.1);
                     border:1px solid #e74c3c;color:#e74c3c;">
                    <strong>TERMINATION SCHEDULED</strong><br>Coverage ends: ${date}
                </div>`;

        } else if (hasPendingInDB) {
            updateBtn?.classList.remove("hidden");
            cancelBtn?.classList.remove("hidden");
            const date = new Date(userData.insurance.nextBillingDate).toLocaleDateString();
            billingStatus.innerHTML = `${badgesHTML}
                <div style="${statusStyle} background:rgba(241,196,15,0.1);
                     border:1px solid #f1c40f;color:#f1c40f;">
                    <strong>AMENDMENT QUEUED</strong><br>Applies on: ${date}
                </div>`;

        } else {
            updateBtn?.classList.remove("hidden");
            cancelBtn?.classList.remove("hidden");
            const date = new Date(userData.insurance.nextBillingDate).toLocaleDateString();
            billingStatus.innerHTML = `${badgesHTML}
                <div style="${statusStyle} background:rgba(52,152,219,0.1);
                     border:1px solid #3498db;color:#3498db;">
                    <strong>PROTECTION ACTIVE</strong><br>Billing Date: ${date}
                </div>`;
        }

        if (updateBtn) {
            updateBtn.disabled =
                toSortedMappedJSON(initialList) === toSortedMappedJSON(stagingPackages);
        }

        if (confirmBtn) {
            confirmBtn.onclick = isCancelling
                ? handleConfirmCancellation
                : handleInitialActivation;
        }
    };

    // ─── Package toggle ───────────────────────────────────────────────────────

    pkgButtons.forEach(btn => {
        btn.onclick = () => {
            const pkg = btn.dataset.pkg;
            stagingPackages.has(pkg) ? stagingPackages.delete(pkg) : stagingPackages.add(pkg);
            refreshUI();
        };
    });

    // ─── Action handlers ──────────────────────────────────────────────────────

    const handleInitialActivation = async () => {
        const total = calculateTotal(stagingPackages.size);
        if (stagingPackages.size === 0) return alert("Select at least one policy.");
        if (!confirm(`Confirm activation for $${total.toLocaleString()}?`)) return;

        const userRef = doc(db, "users", auth.currentUser.uid);
        try {
            await runTransaction(db, async (transaction) => {
                const userSnap = await transaction.get(userRef);
                const balance = userSnap.data().balance || 0;
                if (balance < total) throw "Insufficient balance.";

                const nextBill = new Date();
                nextBill.setMonth(nextBill.getMonth() + 1);

                const finalPackages = Array.from(stagingPackages).map(toMappedKey);

                transaction.update(userRef, {
                    balance: increment(-total),
                    "insurance.activePackages": finalPackages,
                    "insurance.monthlyPremium": total,
                    "insurance.nextBillingDate": nextBill.toISOString(),
                    "insurance.pendingPackages": null,
                    "insurance.pendingPremium": null,
                    "activePolicies": finalPackages
                });
            });

            sendSlackMessage(`🛡️ *New Insurance Policy:* ${userData.username} activated ${stagingPackages.size} modules for $${total.toLocaleString()}.`);
            await logHistory(auth.currentUser.uid, `Insurance Activated: -$${total.toLocaleString()}`, "membership");
            location.reload();
        } catch (e) { alert(e); }
    };

    const handleScheduleUpdate = async () => {
        const total = calculateTotal(stagingPackages.size);
        if (stagingPackages.size === 0) return alert("Use Cancel button.");
        if (!confirm(`Schedule this plan for next month?`)) return;

        try {
            const finalPackages = Array.from(stagingPackages).map(toMappedKey);
            await updateDoc(doc(db, "users", auth.currentUser.uid), {
                "insurance.pendingPackages": finalPackages,
                "insurance.pendingPremium": total
            });
            sendSlackMessage(`⚙️ *Insurance Update Scheduled:* ${userData.username} modified their plan for next cycle (Projected Premium: $${total.toLocaleString()}).`);
            alert("Plan successfully scheduled!");
            location.reload();
        } catch (e) { alert(e.message); }
    };

    const handleConfirmCancellation = async () => {
        if (!confirm("Revert the scheduled cancellation and keep your current coverage?")) return;
        try {
            await updateDoc(doc(db, "users", auth.currentUser.uid), {
                "insurance.pendingPackages": null,
                "insurance.pendingPremium": null
            });
            sendSlackMessage(`↩️ *Insurance Cancellation Reversed:* ${userData.username} reverted their scheduled termination.`);
            location.reload();
        } catch (e) { alert(e.message); }
    };

    if (updateBtn) updateBtn.onclick = handleScheduleUpdate;

    if (cancelBtn) {
        cancelBtn.onclick = async () => {
            if (!confirm("Stop all coverage at the end of the current cycle?")) return;
            try {
                await updateDoc(doc(db, "users", auth.currentUser.uid), {
                    "insurance.pendingPackages": [],
                    "insurance.pendingPremium": 0
                });
                sendSlackMessage(`🚫 *Insurance Cancellation:* ${userData.username} has scheduled all coverage to terminate at the end of the current cycle.`);
                location.reload();
            } catch (e) { console.error(e); }
        };
    }

    refreshUI();
    processInsuranceCycle(auth.currentUser.uid, userData);
    checkMondayAllowance(auth.currentUser.uid, userData);
}

// ─── Billing cycle processor ──────────────────────────────────────────────────

/**
 * NOTE: This runs client-side on every page load. If two tabs or sessions load
 * simultaneously after the billing date, both could process the cycle. Migrating
 * this to a Firebase Cloud Function with a Firestore transaction is strongly
 * recommended to prevent double-charges in production.
 */
async function processInsuranceCycle(uid, userData) {
    if (!userData.insurance?.nextBillingDate) return;
    const now         = new Date();
    const billingDate = new Date(userData.insurance.nextBillingDate);

    if (now >= billingDate) {
        try {
            const userRef      = doc(db, "users", uid);
            const premium      = userData.insurance.pendingPremium ?? userData.insurance.monthlyPremium;
            const nextPackages = userData.insurance.pendingPackages ?? userData.insurance.activePackages;

            // FIX: Capture the actual transaction outcome in a variable so the
            // Slack notification below reflects what Firestore actually did,
            // rather than the pre-transaction outer variables which could diverge
            // if the transaction retried or the balance check failed mid-flight.
            let didLapse = false;

            await runTransaction(db, async (transaction) => {
                const userSnap    = await transaction.get(userRef);
                const liveBalance = userSnap.data().balance || 0;
                const shouldLapse = !nextPackages || nextPackages.length === 0 || liveBalance < premium;

                // Reset each retry so the final committed state is always accurate.
                didLapse = shouldLapse;

                if (shouldLapse) {
                    transaction.update(userRef, {
                        "insurance.activePackages": [],
                        "activePolicies": [],
                        "insurance.pendingPackages": null,
                        "insurance.pendingPremium": null,
                        "insurance.monthlyPremium": 0,
                        "insurance.nextBillingDate": null
                    });
                } else {
                    const nextCycle = new Date();
                    nextCycle.setMonth(nextCycle.getMonth() + 1);
                    transaction.update(userRef, {
                        balance: increment(-premium),
                        "insurance.activePackages": nextPackages,
                        "activePolicies": nextPackages,
                        "insurance.monthlyPremium": premium,
                        "insurance.pendingPackages": null,
                        "insurance.pendingPremium": null,
                        "insurance.nextBillingDate": nextCycle.toISOString()
                    });
                }
            });

            // Notify based on what the transaction actually committed.
            if (didLapse) {
                sendSlackMessage(`❌ *Insurance Lapsed:* ${userData.username}'s coverage has expired or was terminated due to insufficient funds.`);
            } else {
                sendSlackMessage(`♻️ *Insurance Renewed:* ${userData.username} paid $${premium.toLocaleString()} for the upcoming cycle.`);
                await logHistory(uid, `Insurance Renewed: -$${premium.toLocaleString()}`, "membership");
            }
        } catch (e) { console.error(e); }
    }
}

// ─── Monday BPS allowance ─────────────────────────────────────────────────────

async function checkMondayAllowance(uid, userData) {
    if (!userData.insurance?.activePackages?.includes("darkblue_c")) return;
    const now = new Date();
    if (now.getDay() !== 1) return;
    const todayStr = now.toISOString().split('T')[0];

    // FIX: Use a transaction to guard against two simultaneous page loads on
    // Monday both passing the stale lastBpsDate check and each awarding +5 BPS.
    // The transaction reads the live lastBpsDate from Firestore before writing,
    // so only the first caller actually increments; the second bails out cleanly.
    try {
        const userRef = doc(db, "users", uid);
        await runTransaction(db, async (transaction) => {
            const userSnap     = await transaction.get(userRef);
            const lastBpsDate  = userSnap.data()?.insurance?.lastBpsDate;
            if (lastBpsDate === todayStr) return; // already awarded today
            transaction.update(userRef, {
                bpsBalance: increment(5),
                "insurance.lastBpsDate": todayStr
            });
        });
    } catch (e) { console.error(e); }
}

export { processInsuranceCycle, checkMondayAllowance };