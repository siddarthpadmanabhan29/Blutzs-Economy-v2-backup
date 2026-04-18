import { db } from "../firebaseConfig.js";
import { collection, doc, getDocs, addDoc, updateDoc, query, where } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { logHistory } from "../historyManager.js";
import { getDOMElements, handleUserLookup } from "./adminUtils.js";

export function initContractsUI() {
  const el = getDOMElements();
  
  if (el.adminContractBtn) {
    el.adminContractBtn.addEventListener("click", sendContractOffer);
  }
  
  if (el.adminContractUsername) {
    el.adminContractUsername.addEventListener("input", () => 
      handleUserLookup(el.adminContractUsername, el.adminContractUserInfo, el.adminContractBtn, "contract")
    );
  }
  
  // Setup auto-calculation for base cycle
  if (el.contractGuaranteed && el.contractNonGuaranteed && el.contractBaseCycle) {
    [el.contractGuaranteed, el.contractNonGuaranteed].forEach(input => {
      input?.addEventListener("input", () => {
        const g = parseFloat(el.contractGuaranteed.value) || 0;
        const ng = parseFloat(el.contractNonGuaranteed.value) || 0;
        el.contractBaseCycle.value = `$${(g + ng).toLocaleString()} per season`;
      });
    });
  }
}

async function sendContractOffer() {
  const el = getDOMElements();
  const username = el.adminContractUsername.value.trim().toLowerCase();
  const team = el.contractTeam.value.trim();
  const seasons = parseInt(el.contractSeasons.value);
  const bonus = parseFloat(el.contractSigningBonus.value) || 0;
  const g = parseFloat(el.contractGuaranteed.value) || 0;
  const ng = parseFloat(el.contractNonGuaranteed.value) || 0;

  if (!username || !team || isNaN(seasons) || seasons <= 0) {
    return alert("⚠️ Check inputs (Username, Team, Seasons).");
  }
  if (g <= 0 && ng <= 0 && bonus <= 0) {
    return alert("⚠️ Offer cannot be $0.");
  }

  const totalVal = bonus + ((g + ng) * seasons);
  if (!confirm(`Send offer to ${username} for ${team}? Total: $${totalVal.toLocaleString()}`)) return;

  try {
    const q = query(collection(db, "users"), where("username", "==", username));
    const snap = await getDocs(q);
    if (snap.empty) return alert("❌ Player not found.");
    const playerDoc = snap.docs[0];

    await addDoc(collection(db, "contracts"), {
      playerUID: playerDoc.id,
      team: team,
      status: "offered",
      signingBonus: bonus,
      terms: {
        seasons: seasons,
        initialSeasons: seasons,
        guaranteedPay: g,
        nonGuaranteedPay: ng,
        incentives: el.contractIncentives.value.trim() || "Standard Conduct"
      },
      timestamp: new Date().toISOString()
    });
    await logHistory(playerDoc.id, `New offer from ${team}`, "contract");
    alert(`🏀 Offer sent!`);
    
    // Clear form
    [el.contractTeam, el.contractSeasons, el.contractSigningBonus, el.contractGuaranteed, 
     el.contractNonGuaranteed, el.contractIncentives, el.contractBaseCycle].forEach(input => {
      if(input) input.value = "";
    });
  } catch (err) {
    console.error(err);
    alert("Failed to send offer.");
  }
}

// --- EMPLOYMENT & NEW CONTRACTS ---
export function initEmploymentUI() {
  const el = getDOMElements();
  
  if (el.empSetBtn) {
    el.empSetBtn.addEventListener("click", updateEmploymentStatus);
  }
  
  if (el.empUsernameInput) {
    el.empUsernameInput.addEventListener("input", () => 
      handleUserLookup(el.empUsernameInput, el.empUserInfo, el.empSetBtn, "emp")
    );
  }
}

async function updateEmploymentStatus() {
  const el = getDOMElements();
  const username = el.empUsernameInput.value.trim().toLowerCase();
  const newStatus = el.empStatusSelect.value;
  if (!username) return alert("Enter a username.");
  
  try {
    const q = query(collection(db, "users"), where("username", "==", username));
    const snap = await getDocs(q);
    if (snap.empty) return alert("User not found.");
    const userDoc = snap.docs[0];
    await updateDoc(doc(db, "users", userDoc.id), { employmentStatus: newStatus });
    await logHistory(userDoc.id, `Admin set status to ${newStatus}`, "admin");
    alert(`✅ Status updated!`);
  } catch (err) {
    console.error(err);
    alert("Failed to update status.");
  }
}
