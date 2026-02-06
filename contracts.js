import { db, auth } from "./firebaseConfig.js";
import { 
    collection, query, where, onSnapshot, doc, updateDoc, deleteDoc, getDoc, addDoc 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { logHistory } from "./historyManager.js";

const contractSection = document.getElementById("user-contract-display");
const adminRosterContainer = document.getElementById("admin-active-contracts-list");

let activeContractListener = null;
let activeAdminListener = null;

/**
 * USER DASHBOARD LOGIC
 */
export function renderUserContract(userUID, userData) {
    if (!contractSection) return;
    listenForContractOffers(userUID, userData);
}

export function listenForContractOffers(userUID, userData) {
    if (!contractSection) return;
    if (activeContractListener) {
        activeContractListener();
        activeContractListener = null;
    }

    const q = query(collection(db, "contracts"), where("playerUID", "==", userUID));

    activeContractListener = onSnapshot(q, (snap) => {
        contractSection.innerHTML = "";
        if (snap.empty) {
            contractSection.innerHTML = `<p style="color: gray; font-style: italic;">No active contract or pending offers.</p>`;
            return;
        }
        snap.forEach((contractDoc) => {
            const data = contractDoc.data();
            const docId = contractDoc.id;
            if (data.status === "offered") renderOffer(docId, data);
            else if (data.status === "active") renderActiveContract(docId, data, userData);
            else if (data.status === "extension-offered") renderExtensionOffer(docId, data, userData);
        });
    });
}

/**
 * OFFER VIEW
 */
function renderOffer(docId, data) {
    const div = document.createElement("div");
    div.className = "contract-card offer-view";
    div.style.cssText = "padding: 25px; border-radius: 12px; border: 2px dashed #3498db; background: var(--card-bg, #1a1a1a); color: var(--text-color, #fff);";

    const sBonus = data.signingBonus || 0;
    const terms = data.terms || {};
    const seasons = terms.seasons || 1;
    const gPay = terms.guaranteedPay || 0;
    const bPay = terms.nonGuaranteedPay || 0;
    const seasonBase = gPay + bPay;
    const careerWorth = (seasonBase * seasons) + sBonus;

    div.innerHTML = `
        <h4 style="color: #3498db; margin: 0 0 15px 0; text-transform: uppercase;">📋 NEW OFFER: ${data.team || 'LEAGUE'}</h4>
        <div style="border: 1px solid #3498db; padding: 15px; border-radius: 8px; margin-bottom: 20px; text-align: center;">
            <span style="font-size: 0.7rem; font-weight: 800; color: #3498db; display: block; text-transform: uppercase;">Estimated Total Career Value</span>
            <strong style="font-size: 1.8rem; color: #2ecc71;">$${careerWorth.toLocaleString()}</strong>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 20px;">
            <div style="background: var(--input-bg, rgba(255,255,255,0.03)); padding:10px; border-radius:8px; border:1px solid var(--border-color, #333);">
                <span class="contract-label" style="color: var(--text-muted, #888);">TERM</span>
                <strong style="color: var(--text-color, #fff);">${seasons} Seasons</strong>
            </div>
            <div style="background: var(--input-bg, rgba(255,255,255,0.03)); padding:10px; border-radius:8px; border:1px solid var(--border-color, #333);">
                <span class="contract-label" style="color: var(--text-muted, #888);">SIGNING BONUS</span>
                <strong style="color:#f1c40f;">$${sBonus.toLocaleString()}</strong>
            </div>
            <div style="background: var(--input-bg, rgba(255,255,255,0.03)); padding:10px; border-radius:8px; border:1px solid var(--border-color, #333);">
                <span class="contract-label" style="color: var(--text-muted, #888);">PER SEASON</span>
                <strong style="color:#2ecc71;">$${seasonBase.toLocaleString()}</strong>
                <div style="font-size: 0.85rem; color: var(--text-color, #fff); font-weight: 800; margin-top: 6px; background: rgba(0,0,0,0.1); padding: 4px; border-radius: 4px; border: 1px solid var(--border-color, #333); text-align: center;">
                    $${gPay.toLocaleString()} G. + $${bPay.toLocaleString()} B.
                </div>
            </div>
        </div>
        <div style="display: flex; gap: 10px;">
            <button onclick="respondToContract('${docId}', 'active')" class="btn-primary" style="flex: 2; font-weight: 900; height: 50px;">SIGN FOR $${careerWorth.toLocaleString()}</button>
            <button onclick="respondToContract('${docId}', 'rejected')" class="btn-danger" style="flex: 1; font-weight: 900; height: 50px;">DECLINE</button>
        </div>
    `;
    contractSection.appendChild(div);
}

/**
 * ACTIVE VIEW (PLAYER SIDE)
 */
function renderActiveContract(docId, data, userData) {
    const div = document.createElement("div");
    div.className = "contract-card active-view";
    div.style.cssText = "padding: 20px; border-radius: 12px; margin-bottom: 15px; background: var(--card-bg, #1a1a1a); border: 1px solid var(--border-color, #333); color: var(--text-color, #fff);";

    const terms = data.terms || {};
    const seasonsRemaining = terms.seasons || 0;
    const initialSeasons = terms.initialSeasons || seasonsRemaining || 1;
    const gPay = terms.guaranteedPay || 0;
    const bPay = terms.nonGuaranteedPay || 0;
    const sBonus = data.signingBonus || 0;
    
    // Tracked values with safety defaults to prevent NaN
    const paidGuaranteed = Number(data.paidGuaranteed) || 0;
    const paidBonuses = Number(data.paidBonuses) || 0;
    const seasonPaidG = Number(data.seasonPaidG) || 0;
    const seasonPaidB = Number(data.seasonPaidB) || 0;

    const totalWorth = ((gPay + bPay) * initialSeasons) + sBonus;
    const totalProgress = Math.min(100, Math.max(0, Math.round(((initialSeasons - seasonsRemaining) / initialSeasons) * 100)));
    
    const currentSeasonNum = Math.floor(initialSeasons - seasonsRemaining) + 1;
    const currentSeasonTimePassed = 1 - (seasonsRemaining % 1 || (seasonsRemaining > 0 ? 0 : 1));
    const seasonProgressPercent = Math.round(currentSeasonTimePassed * 100);

    let statusBadge = '';
    if (data.tradeStatus === 'looking') {
        statusBadge = `<div style="background: #f39c12; color: white; padding: 10px; border-radius: 6px; font-size: 0.8rem; margin-bottom: 15px; font-weight: 900; text-align: center; text-transform: uppercase;">🔍 Team is actively looking for trade partners</div>`;
    } else if (userData?.releasePending || userData?.tradePending) {
        const type = userData.releasePending ? 'Release' : 'Trade';
        statusBadge = `<div style="background: #e74c3c; color: white; padding: 10px; border-radius: 6px; font-size: 0.8rem; margin-bottom: 15px; font-weight: 900; text-align: center; text-transform: uppercase; animation: pulse-red 2s infinite;">⏳ ${type} Request Pending <button onclick="cancelContractRequest()" style="margin-left:10px; background:white; color:#e74c3c; border:none; padding:2px 8px; border-radius:4px; font-size:0.6rem; cursor:pointer;">CANCEL</button></div>`;
    }

    div.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px;">
            <div>
                <h4 style="margin:0; text-transform:uppercase; font-size:1.1rem; display:flex; align-items:center; gap:8px;">
                    <span style="background:#2ecc71; color:white; padding:2px 5px; border-radius:4px; font-size:0.7rem;">✓</span> ${data.team || 'PLAYER'}
                </h4>
                <div style="font-size:0.65rem; color: var(--text-muted, #666); font-weight:bold;">OFFICIAL PLAYER CONTRACT</div>
            </div>
            <div style="text-align:right;">
                <div style="font-size:0.6rem; color:#f1c40f; font-weight:800; text-transform:uppercase;">Total Contract Worth</div>
                <div style="font-size:1.4rem; font-weight:900; color:#2ecc71;">$${totalWorth.toLocaleString()}</div>
                <div style="font-size:0.6rem; color: var(--text-muted, #888);">Over ${initialSeasons} Seasons</div>
            </div>
        </div>

        ${statusBadge}

        <div style="border-left:3px solid #f1c40f; padding:10px; background:rgba(241, 196, 15, 0.05); border-radius:6px; margin-bottom:15px; display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:0.65rem; font-weight:800; color:#f1c40f; text-transform:uppercase;">💰 Signing Bonus</span>
            <strong style="color: var(--text-color, #eee);">$${sBonus.toLocaleString()}</strong>
        </div>

        <div style="border-top:1px solid var(--border-color, #333); padding-top:15px; margin-bottom:15px;">
            <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                <span style="font-size:0.6rem; font-weight:800; color:#3498db; text-transform:uppercase;">All Seasons Progress</span>
                <span style="font-size:0.65rem; color:#3498db; font-weight:900;">${seasonsRemaining.toFixed(2)} Seasons Left</span>
            </div>
            <div style="width:100%; height:8px; background: var(--input-bg, #222); border-radius:4px; overflow:hidden; margin-bottom:10px;">
                <div style="width:${totalProgress}%; height:100%; background:#3498db; transition: width 1s;"></div>
            </div>
            <div style="display:flex; flex-direction:column; gap:5px; font-size:0.8rem;">
                 <div style="display:flex; justify-content:space-between;"><span>🛡️ Guaranteed Received:</span><strong>$${paidGuaranteed.toLocaleString()} / $${(gPay * initialSeasons).toLocaleString()}</strong></div>
                 <div style="display:flex; justify-content:space-between;"><span>🏀 Bonuses Received:</span><strong>$${paidBonuses.toLocaleString()} / $${(bPay * initialSeasons).toLocaleString()}</strong></div>
            </div>
        </div>

        <div style="border-top:1px solid var(--border-color, #333); padding-top:15px; margin-bottom:15px;">
            <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                <span style="font-size:0.6rem; font-weight:800; color:#2ecc71; text-transform:uppercase;">Season ${currentSeasonNum} Progress</span>
                <span style="font-size:0.65rem; color:#2ecc71; font-weight:900;">${(seasonsRemaining % 1 || 1).toFixed(2)} LEFT</span>
            </div>
            <div style="width:100%; height:8px; background: var(--input-bg, #222); border-radius:4px; overflow:hidden; margin-bottom:10px;">
                <div style="width:${seasonProgressPercent}%; height:100%; background:#2ecc71; transition: width 1s;"></div>
            </div>
            <div style="display:flex; flex-direction:column; gap:5px; font-size:0.8rem;">
                 <div style="display:flex; justify-content:space-between;"><span>🛡️ Season Base Received:</span><strong>$${seasonPaidG.toLocaleString()} / $${gPay.toLocaleString()}</strong></div>
                 <div style="display:flex; justify-content:space-between;"><span>🏀 Season Bonus Received:</span><strong>$${seasonPaidB.toLocaleString()} / $${bPay.toLocaleString()}</strong></div>
            </div>
        </div>

        <div style="margin-bottom:20px;">
            <span style="display:block; font-size:0.6rem; color: var(--text-muted, #888); font-weight:800; text-transform:uppercase; margin-bottom:5px;">Agreed Incentives:</span>
            <div style="background: var(--input-bg, rgba(255,255,255,0.02)); padding:10px; border-radius:6px; font-size:0.75rem; color: var(--text-muted, #999); border: 1px solid var(--border-color, transparent);">
                ${terms.incentives || "No specific clauses."}
            </div>
        </div>

        <div style="display: flex; gap: 10px;">
            <button id="request-trade-btn" class="btn-secondary" style="flex:1; font-weight:800; height: 40px; border-radius: 8px;">REQUEST TRADE</button>
            <button id="request-release-btn" class="btn-danger" style="flex:1; font-weight:800; height: 40px; border-radius: 8px;">REQUEST RELEASE</button>
        </div>
    `;
    contractSection.appendChild(div);
}

/**
 * EXTENSION OFFER VIEW
 */
function renderExtensionOffer(docId, data, userData) {
    renderActiveContract(docId, data, userData);
    const ext = data.extensionTerms || {};
    const div = document.createElement("div");
    div.className = "contract-card extension-offer-view";
    div.style.cssText = "padding: 20px; border-radius: 12px; border: 3px solid #9b59b6; background: var(--card-bg, #1a1a1a); color: var(--text-color, #fff); margin-top: 15px; animation: slideDown 0.4s ease-out;";

    div.innerHTML = `
        <h4 style="color: #9b59b6; margin: 0 0 10px 0; text-transform: uppercase;">💜 EXTENSION OFFER FROM ${data.team}</h4>
        <p style="font-size: 0.85rem; color: var(--text-muted, #aaa); margin-bottom: 15px;">The team is offering to extend your current deal by <strong>${ext.years} seasons</strong>.</p>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 20px;">
             <div style="background: rgba(155, 89, 182, 0.1); padding: 10px; border-radius: 8px; border: 1px solid #9b59b6;">
                <span style="font-size: 0.6rem; display: block; color: #9b59b6; font-weight: 800;">NEW YEARLY BASE</span>
                <strong style="font-size: 1.1rem; color: #2ecc71;">$${(ext.newGuaranteedPerSeason || 0).toLocaleString()}</strong>
            </div>
            <div style="background: rgba(155, 89, 182, 0.1); padding: 10px; border-radius: 8px; border: 1px solid #9b59b6;">
                <span style="font-size: 0.6rem; display: block; color: #9b59b6; font-weight: 800;">NEW YEARLY BONUS</span>
                <strong style="font-size: 1.1rem; color: #f1c40f;">$${(ext.newBonusPerSeason || 0).toLocaleString()}</strong>
            </div>
        </div>
        <div style="display: flex; gap: 10px;">
            <button onclick="respondToExtension('${docId}', 'accept')" class="btn-primary" style="flex: 2; background: #9b59b6; border-color: #9b59b6; font-weight: 900;">ACCEPT EXTENSION</button>
            <button onclick="respondToExtension('${docId}', 'decline')" class="btn-danger" style="flex: 1; font-weight: 900;">DECLINE</button>
        </div>
    `;
    contractSection.appendChild(div);
}

/**
 * ADMIN ROSTER - LIVE LISTENER PER CARD
 */
export function listenForAdminRoster() {
    if (!adminRosterContainer) return;
    if (activeAdminListener) activeAdminListener();
    
    const q = query(collection(db, "contracts"), where("status", "==", "active"));

    activeAdminListener = onSnapshot(q, (snap) => {
        adminRosterContainer.innerHTML = "";
        if (snap.empty) {
            adminRosterContainer.innerHTML = `<p style="color: gray; text-align: center;">No active players.</p>`;
            return;
        }

        snap.forEach((contractDoc) => {
            const data = contractDoc.data();
            const docId = contractDoc.id;
            const terms = data.terms || {};
            const cycleTargetG = (terms.guaranteedPay || 0) / 6;
            const cycleTargetB = (terms.nonGuaranteedPay || 0) / 6;

            const div = document.createElement("div");
            div.className = "contract-card";
            div.style.cssText = "padding: 20px; border-radius: 12px; margin-bottom: 20px; background: var(--card-bg, #1a1a1a); border: 1px solid var(--border-color, #333); color: var(--text-color, #fff);";

            div.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                    <strong style="color: #3498db; font-size: 1.3rem;">${data.playerName || 'Player'}</strong>
                    <span style="background: rgba(52, 152, 219, 0.2); color: #3498db; padding: 4px 8px; border-radius: 6px; font-size: 0.65rem; font-weight: 800;">${terms.seasons?.toFixed(2)} SEASONS LEFT</span>
                </div>
                <div style="font-size: 0.75rem; color: var(--text-muted, #888); margin-bottom: 15px;">Team: ${data.team} | Total Deal: $${((terms.guaranteedPay + terms.nonGuaranteedPay) * (terms.initialSeasons || terms.seasons)).toLocaleString()}</div>
                
                <div id="admin-alert-area-${data.playerUID}"></div>

                <div style="background: var(--input-bg, rgba(0,0,0,0.3)); padding: 12px; border-radius: 8px; margin-bottom: 15px; border: 1px solid var(--border-color, transparent);">
                    <div style="font-size: 0.6rem; color: #888; margin-bottom: 10px; display: flex; justify-content: space-between;">
                        <span>Target G: $${cycleTargetG.toLocaleString()}</span>
                        <span>Target B: $${cycleTargetB.toLocaleString()}</span>
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px;">
                        <input type="number" id="pay-g-${docId}" placeholder="Pay G ($)" style="background: #111; border:1px solid #444; color: white; padding:8px; border-radius:6px; font-size: 0.75rem;">
                        <input type="number" id="pay-b-${docId}" placeholder="Pay B ($)" style="background: #111; border:1px solid #444; color: white; padding:8px; border-radius:6px; font-size: 0.75rem;">
                    </div>
                    <button onclick="adminActionContract('${docId}', 'payInstallment')" style="width: 100%; background:#2ecc71; color:white; border:none; border-radius:6px; font-weight:bold; padding: 10px; cursor:pointer;">PROCESS SPLIT PAYMENT</button>
                </div>

                <div style="display: flex; gap: 8px;">
                    <button onclick="adminActionContract('${docId}', 'cut')" style="flex:1; background:#e74c3c; color:white; border:none; padding:10px; border-radius:6px; font-weight:bold; font-size:0.7rem; cursor:pointer;">CUT</button>
                    <button onclick="adminActionContract('${docId}', 'unethicalVoid')" style="flex:1; background:#000; color:white; border:1px solid #333; padding:10px; border-radius:6px; font-weight:bold; font-size:0.7rem; cursor:pointer;">VOID</button>
                    <button onclick="tradePlayer('${docId}')" style="flex:1; background:#f39c12; color:white; border:none; border-radius:6px; padding:10px; font-weight:bold; font-size:0.7rem; cursor:pointer;">TRADE</button>
                    <button onclick="offerExtension('${docId}')" style="flex:1; background:#444; color:white; border:none; padding:10px; border-radius:6px; font-weight:bold; font-size:0.7rem; cursor:pointer;">EXTEND</button>
                </div>
            `;
            adminRosterContainer.appendChild(div);

            const userRef = doc(db, "users", data.playerUID);
            onSnapshot(userRef, (uSnap) => {
                const uData = uSnap.exists() ? uSnap.data() : {};
                const alertContainer = document.getElementById(`admin-alert-area-${data.playerUID}`);
                if (!alertContainer) return;
                if (uData.tradePending || uData.releasePending) {
                    const isTrade = uData.tradePending;
                    alertContainer.innerHTML = `<div style="border: 2px solid #e74c3c; background: rgba(231, 76, 60, 0.05); padding: 12px; border-radius: 8px; margin: 15px 0;"><div style="color: #e74c3c; font-weight: 900; font-size: 0.75rem; margin-bottom: 10px; text-transform: uppercase;">🚨 PLAYER REQUEST: ${isTrade ? 'TRADE' : 'RELEASE'}</div><div style="display: flex; gap: 8px;">${isTrade ? `<button onclick="handleAdminDecision('${docId}', '${data.playerUID}', 'looking')" style="flex:1; background: #f39c12; color:white; border:none; border-radius:6px; padding:10px; font-weight:bold; font-size:0.7rem; cursor:pointer;">LOOKING</button>` : ''}<button onclick="handleAdminDecision('${docId}', '${data.playerUID}', 'approve')" style="flex:1; background: #2ecc71; color:white; border:none; border-radius:6px; padding:10px; font-weight:bold; font-size:0.7rem; cursor:pointer;">APPROVE</button><button onclick="handleAdminDecision('${docId}', '${data.playerUID}', 'reject')" style="flex:1; background: #e74c3c; color:white; border:none; border-radius:6px; padding:10px; font-weight:bold; font-size:0.7rem; cursor:pointer;">REJECT</button></div></div>`;
                } else { alertContainer.innerHTML = ""; }
            });
        });
    });
}

/**
 * ADMIN ACTION LOGIC - SYNCED UPDATES
 */
window.adminActionContract = async (docId, action) => {
    const contractRef = doc(db, "contracts", docId);
    const snap = await getDoc(contractRef);
    if (!snap.exists()) return;
    const data = snap.data();
    const userRef = doc(db, "users", data.playerUID);

    try {
        if (action === "payInstallment") {
            const gInput = document.getElementById(`pay-g-${docId}`);
            const bInput = document.getElementById(`pay-b-${docId}`);

            const gAmount = parseFloat(gInput?.value) || 0;
            const bAmount = parseFloat(bInput?.value) || 0;

            if ((gAmount + bAmount) <= 0) return alert("Enter valid amount.");
            
            const userSnap = await getDoc(userRef);
            const currentBal = Number(userSnap.data()?.balance) || 0;
            const oldSeasons = Number(data.terms?.seasons) || 0;
            const newSeasons = Math.max(0, oldSeasons - (1/6));
            
            // Season crossing logic
            const seasonJustFinished = Math.floor(oldSeasons) > Math.floor(newSeasons) && newSeasons > 0.01;

            // SYNCED TRACKER UPDATE
            const contractUpdates = { 
                "terms.seasons": newSeasons,
                paidGuaranteed: (Number(data.paidGuaranteed) || 0) + gAmount,
                paidBonuses: (Number(data.paidBonuses) || 0) + bAmount,
                seasonPaidG: (Number(data.seasonPaidG) || 0) + gAmount,
                seasonPaidB: (Number(data.seasonPaidB) || 0) + bAmount
            };

            if (seasonJustFinished) {
                contractUpdates.seasonPaidG = 0;
                contractUpdates.seasonPaidB = 0;
            }

            if (newSeasons <= 0.01) {
                await deleteDoc(contractRef);
                await updateDoc(userRef, { 
                    balance: currentBal + gAmount + bAmount, 
                    employmentStatus: "Unemployed",
                    tradePending: false,
                    releasePending: false
                });
                await logHistory(data.playerUID, `🎉 Contract Fulfilled!`, "contract");
            } else {
                await updateDoc(contractRef, contractUpdates);
                await updateDoc(userRef, { balance: currentBal + gAmount + bAmount });
                await logHistory(data.playerUID, `💰 Payout: $${(gAmount + bAmount).toLocaleString()}`, "transfer-in");
            }

            if (gInput) gInput.value = ""; 
            if (bInput) bInput.value = "";
        } else if (action === "cut") {
            if (!confirm(`Are you sure you want to CUT ${data.playerName}?`)) return;
            await deleteDoc(contractRef);
            await updateDoc(userRef, { employmentStatus: "Unemployed", tradePending: false, releasePending: false });
            await logHistory(data.playerUID, `✂️ Contract Terminated.`, "admin");
            alert("✂️ Terminated.");
        } else if (action === "unethicalVoid") {
            if (!confirm(`Are you sure you want to VOID the contract for ${data.playerName}?`)) return;
            await deleteDoc(contractRef);
            await updateDoc(userRef, { employmentStatus: "Unemployed", tradePending: false, releasePending: false });
            await logHistory(data.playerUID, `🚫 Contract Voided.`, "admin");
            alert("🚫 Voided.");
        }
    } catch (err) { console.error("Admin Action Error:", err); }
};

/**
 * PLAYER RESPOND LOGIC
 */
window.respondToContract = async (docId, status) => {
    const user = auth.currentUser;
    if (!user) return;
    try {
        const contractRef = doc(db, "contracts", docId);
        const snap = await getDoc(contractRef);
        if (!snap.exists()) return;
        const data = snap.data();
        if (status === "rejected") {
            await deleteDoc(contractRef);
            await logHistory(user.uid, `❌ Offer Rejected from ${data.team}.`, "contract");
            alert("❌ Offer Declined.");
        } else {
            const userRef = doc(db, "users", user.uid);
            const userSnap = await getDoc(userRef);
            const currentBal = userSnap.data().balance || 0;
            const bonus = data.signingBonus || 0;
            await updateDoc(contractRef, { 
                status: "active",
                playerName: userSnap.data().username || user.email.split('@')[0],
                "terms.initialSeasons": data.terms?.seasons || 1,
                paidGuaranteed: 0, 
                paidBonuses: 0,
                seasonPaidG: 0,
                seasonPaidB: 0
            });
            const updates = { employmentStatus: "Employed" };
            if (bonus > 0) updates.balance = currentBal + bonus;
            await updateDoc(userRef, updates);
            await logHistory(user.uid, `✍️ Joined ${data.team}. Bonus: $${bonus.toLocaleString()}.`, "contract");
            alert(`✍️ Signed!`);
        }
    } catch (err) { console.error(err); }
};

/**
 * FIXED EXTENSION LOGIC
 */
window.respondToExtension = async (docId, choice) => {
    const user = auth.currentUser;
    if (!user) return;
    try {
        const contractRef = doc(db, "contracts", docId);
        const snap = await getDoc(contractRef);
        if (!snap.exists()) return;
        const data = snap.data();
        if (choice === 'accept') {
            const ext = data.extensionTerms;
            
            const extensionYears = Number(ext.years || 0);
            const currentSeasonsLeft = Number(data.terms.seasons || 0);
            const currentInitial = Number(data.terms.initialSeasons || data.terms.seasons || 1);

            const newTotalSeasons = currentSeasonsLeft + extensionYears;
            const newInitialSeasons = currentInitial + extensionYears;

            await updateDoc(contractRef, {
                status: "active",
                "terms.seasons": newTotalSeasons,
                "terms.initialSeasons": newInitialSeasons,
                "terms.guaranteedPay": Number(ext.newGuaranteedPerSeason),
                "terms.nonGuaranteedPay": Number(ext.newBonusPerSeason),
                extensionTerms: null 
            });
            await logHistory(user.uid, `✅ Extension Accepted.`, "contract");
            alert("✅ Extension Accepted!");
        } else {
            await updateDoc(contractRef, { status: "active", extensionTerms: null });
            await logHistory(user.uid, `❌ Extension Rejected.`, "contract");
            alert("Extension Declined.");
        }
    } catch (err) { console.error(err); alert("Failed to respond."); }
};

/**
 * ADMIN DECISION & UTILITIES
 */
window.handleAdminDecision = async (contractId, playerUID, decision) => {
    const userRef = doc(db, "users", playerUID);
    const contractRef = doc(db, "contracts", contractId);
    const userSnap = await getDoc(userRef);
    const userData = userSnap.data();

    if (decision === 'approve') {
        if (userData.releasePending) {
            await deleteDoc(contractRef);
            await updateDoc(userRef, { employmentStatus: "Unemployed", releasePending: false });
            await logHistory(playerUID, "✅ Release Approved.", "contract");
            alert("Player Released.");
        } else if (userData.tradePending) {
            await updateDoc(userRef, { tradePending: false });
            await updateDoc(contractRef, { tradeStatus: null });
            await logHistory(playerUID, "📢 Trade Approved.", "contract");
            alert("Trade request cleared.");
        }
    } else if (decision === 'looking') {
        await updateDoc(contractRef, { tradeStatus: 'looking' });
        await logHistory(playerUID, "🔍 Team is looking for trade partners.", "contract");
        alert("Marked as 'Looking for Trades'.");
    } else {
        await updateDoc(userRef, { tradePending: false, releasePending: false });
        await updateDoc(contractRef, { tradeStatus: null });
        await logHistory(playerUID, "❌ Trade/Release request REJECTED.", "contract");
        alert("Request Rejected.");
    }
};

window.tradePlayer = async (docId) => {
    const newTeam = prompt("Enter the New Team Name:");
    if (!newTeam) return;
    const contractRef = doc(db, "contracts", docId);
    const snap = await getDoc(contractRef);
    if (!snap.exists()) return;
    const data = snap.data();
    try {
        await updateDoc(contractRef, { team: newTeam, tradeStatus: null });
        const userRef = doc(db, "users", data.playerUID);
        await updateDoc(userRef, { tradePending: false });
        await logHistory(data.playerUID, `🤝 Traded to ${newTeam}!`, "contract");
        alert(`📢 Moved to ${newTeam}`);
    } catch (err) { alert("Trade failed."); }
};

window.offerExtension = async (docId) => {
    const years = prompt("Additional seasons?");
    const newG = prompt("New Yearly Guaranteed?");
    const newB = prompt("New Yearly Bonus?");
    if (!years || !newG || !newB) return;
    const snap = await getDoc(doc(db, "contracts", docId));
    const playerUID = snap.data().playerUID;
    await updateDoc(doc(db, "contracts", docId), {
        status: "extension-offered",
        extensionTerms: { 
            years: parseFloat(years),
            newGuaranteedPerSeason: parseFloat(newG),
            newBonusPerSeason: parseFloat(newB),
            newBaseSalary: parseFloat(newG) + parseFloat(newB)
        }
    });
    await logHistory(playerUID, `📑 Extension offered.`, "contract");
    alert("Extension Sent!");
};

window.cancelContractRequest = async () => {
    const user = auth.currentUser;
    if (!user || !confirm("Withdraw your pending request?")) return;
    try {
        await updateDoc(doc(db, "users", user.uid), { tradePending: false, releasePending: false });
        await logHistory(user.uid, "↩️ Request Withdrawn.", "contract");
        alert("✅ Request withdrawn.");
    } catch (err) { console.error(err); }
};