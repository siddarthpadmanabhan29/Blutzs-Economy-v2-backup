import { db } from "../firebaseConfig.js";
import { collection, doc, getDoc, getDocs, updateDoc, setDoc, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { logHistory } from "../historyManager.js";
import { sendSlackMessage } from "../slackNotifier.js";
import { PLANS } from "../membership_plans.js";
import { getDOMElements, handleUserLookup } from "./adminUtils.js";

let renewalRequestsListener = null;
let membershipPricingConfig = {};
const membershipPricingRef = doc(db, "settings", "membershipPricing");

function publishMembershipPricing(config) {
  window.dispatchEvent(new CustomEvent("membership-pricing-updated", { detail: config }));
}

export function initMembershipsUI() {
  const el = getDOMElements();

  const planSelect = document.getElementById("admin-membership-price-plan");
  const priceInput = document.getElementById("admin-membership-price");
  const savePriceBtn = document.getElementById("admin-save-membership-price");
  const salePlanSelect = document.getElementById("admin-membership-sale-plan");
  const salePercentInput = document.getElementById("admin-membership-sale-percent");
  const saleDurationInput = document.getElementById("admin-membership-sale-duration");
  const saleUnitSelect = document.getElementById("admin-membership-sale-unit");
  const saveSaleBtn = document.getElementById("admin-save-membership-sale");
  const clearSaleBtn = document.getElementById("admin-clear-membership-sale");
  const pricingStatus = document.getElementById("admin-membership-pricing-status");

  const refreshPriceInput = () => {
    if (planSelect && priceInput) {
      const plan = PLANS[planSelect.value];
      priceInput.value = membershipPricingConfig.prices?.[planSelect.value] ?? plan?.price ?? "";
    }
  };

  onSnapshot(membershipPricingRef, (snap) => {
    membershipPricingConfig = snap.exists() ? snap.data() : {};
    refreshPriceInput();
    if (pricingStatus) {
      const sale = membershipPricingConfig.sale;
      const endsAt = sale?.endsAt ? new Date(sale.endsAt) : null;
      const active = endsAt && new Date() < endsAt && sale.startsAt && new Date() >= new Date(sale.startsAt);
      if (active) {
        const labels = sale.planKeys.map((key) => PLANS[key]?.label || key).join(", ");
        pricingStatus.textContent = `${sale.percentOff}% off ${labels} through ${endsAt.toLocaleString()}`;
        if (clearSaleBtn) clearSaleBtn.disabled = false;
      } else if (endsAt && new Date() < endsAt) {
        pricingStatus.textContent = `Sale scheduled through ${endsAt.toLocaleString()}`;
        if (clearSaleBtn) clearSaleBtn.disabled = false;
      } else {
        pricingStatus.textContent = "No active membership sale.";
        if (clearSaleBtn) clearSaleBtn.disabled = true;
      }
    }
  }, (error) => {
    console.error("Membership pricing listener error:", error);
    if (pricingStatus) pricingStatus.textContent = "Unable to load membership pricing settings.";
  });

  planSelect?.addEventListener("change", refreshPriceInput);
  savePriceBtn?.addEventListener("click", async () => {
    const planKey = planSelect?.value;
    const price = Number(priceInput?.value);
    if (!PLANS[planKey] || planKey === "standard" || !Number.isFinite(price) || price < 0) {
      return alert("Choose a paid plan and enter a valid price of 0 or more.");
    }
    try {
      const snap = await getDoc(membershipPricingRef);
      const latest = snap.exists() ? snap.data() : {};
      const updated = {
        ...latest,
        prices: { ...(latest.prices || {}), [planKey]: Math.round(price) },
        updatedAt: new Date().toISOString()
      };
      await setDoc(membershipPricingRef, updated);
      publishMembershipPricing(updated);
      alert(`${PLANS[planKey].label} price updated. It applies on new signups and the next renewal.`);
    } catch (error) {
      console.error("Membership price update error:", error);
      alert("Unable to update membership price.");
    }
  });

  saveSaleBtn?.addEventListener("click", async () => {
    const percentOff = Number(salePercentInput?.value);
    const duration = Number(saleDurationInput?.value);
    const unit = saleUnitSelect?.value;
    const planKeys = salePlanSelect?.value === "all"
      ? ["basic", "premium", "platinum"]
      : [salePlanSelect?.value];
    if (!Number.isFinite(percentOff) || percentOff <= 0 || percentOff > 100
      || !Number.isInteger(duration) || duration < 1
      || !["days", "months"].includes(unit)) {
      return alert("Enter a discount from 1-100% and a duration of at least one day or month.");
    }
    const startsAt = new Date();
    const endsAt = new Date(startsAt);
    if (unit === "days") endsAt.setDate(endsAt.getDate() + duration);
    else {
      const dayOfMonth = endsAt.getDate();
      endsAt.setDate(1);
      endsAt.setMonth(endsAt.getMonth() + duration);
      const finalDayOfMonth = new Date(endsAt.getFullYear(), endsAt.getMonth() + 1, 0).getDate();
      endsAt.setDate(Math.min(dayOfMonth, finalDayOfMonth));
    }
    try {
      const snap = await getDoc(membershipPricingRef);
      const latest = snap.exists() ? snap.data() : {};
      const updated = {
        ...latest,
        sale: { percentOff, planKeys, duration, durationUnit: unit, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
        updatedAt: startsAt.toISOString()
      };
      await setDoc(membershipPricingRef, updated);
      publishMembershipPricing(updated);
      const priceLines = planKeys.map((key) => {
        const originalPrice = Number(latest.prices?.[key] ?? PLANS[key].price);
        const salePrice = Math.round(originalPrice * (1 - percentOff / 100));
        return `• ${PLANS[key].label}: $${originalPrice.toLocaleString()} → $${salePrice.toLocaleString()} / month`;
      }).join("\n");
      await sendSlackMessage(
        `🏷️ *Membership Flash Sale Started*\n` +
        `*Plans:* ${planKeys.map((key) => PLANS[key].label).join(", ")}\n` +
        `*Discount:* ${percentOff}% off for ${duration} ${unit}\n` +
        `*Active until:* ${endsAt.toLocaleString()}\n` +
        `*Prices:*\n${priceLines}\n` +
        `*Time:* ${startsAt.toLocaleString()}`
      );
      alert(`Membership sale is active through ${endsAt.toLocaleString()}.`);
    } catch (error) {
      console.error("Membership sale update error:", error);
      alert("Unable to start membership sale.");
    }
  });

  clearSaleBtn?.addEventListener("click", async () => {
    if (!confirm("End the current membership sale now?")) return;
    try {
      const snap = await getDoc(membershipPricingRef);
      const latest = snap.exists() ? snap.data() : {};
      const updated = { ...latest, sale: null, updatedAt: new Date().toISOString() };
      await setDoc(membershipPricingRef, updated);
      publishMembershipPricing(updated);
    } catch (error) {
      console.error("Membership sale removal error:", error);
      alert("Unable to end membership sale.");
    }
  });

  refreshPriceInput();
  
  if (el.adminGrantTrialBtn) {
    el.adminGrantTrialBtn.addEventListener("click", grantTrialMembership);
  }
  
  if (el.adminRevokeTrialBtn) {
    el.adminRevokeTrialBtn.addEventListener("click", revokeMembership);
  }
  
  if (el.adminTrialUsername) {
    el.adminTrialUsername.addEventListener("input", () => 
      handleUserLookup(el.adminTrialUsername, el.adminTrialUserInfo, el.adminGrantTrialBtn, "membership")
    );
  }
}

// ---------- Membership & Trial Execution ----------
async function grantTrialMembership() {
  const el = getDOMElements();
  const targetUsername = el.adminTrialUsername.value.trim().toLowerCase();
  const planKey = el.adminTrialPlan.value;
  const duration = parseInt(el.adminTrialDuration.value);
  const unit = el.adminTrialUnit.value;

  if (!targetUsername || isNaN(duration) || duration <= 0) {
    return alert("Please provide a valid username and duration.");
  }

  try {
    const q = query(collection(db, "users"), where("username", "==", targetUsername));
    const snap = await getDocs(q);
    if (snap.empty) return alert("User not found!");

    const targetUserDoc = snap.docs[0];
    const targetUid = targetUserDoc.id;

    let expirationDate = new Date();
    if (unit === "days") {
      expirationDate.setDate(expirationDate.getDate() + duration);
    } else if (unit === "months") {
      expirationDate.setMonth(expirationDate.getMonth() + duration);
    }

    await updateDoc(doc(db, "users", targetUid), {
      membershipLevel: planKey,
      trialExpiration: expirationDate.toISOString(),
      membershipLastPaid: new Date().toISOString()
    });

    await logHistory(targetUid, `Admin granted ${duration} ${unit} of ${planKey} (Trial)`, "admin");

    const timestamp = new Date().toLocaleString();
    sendSlackMessage(
      `🎁 *Admin Grant:* Free Trial issued to *${targetUsername}*.\n` + 
      `🔹 *Plan:* ${planKey.toUpperCase()}\n` + 
      `⏳ *Duration:* ${duration} ${unit}\n` + 
      `🕒 *Time:* ${timestamp}`
    );

    alert(`Successfully granted ${planKey} to ${targetUsername} until ${expirationDate.toLocaleDateString()}.`);
    
    el.adminTrialUsername.value = "";
    el.adminTrialDuration.value = "";
    el.adminTrialUserInfo.textContent = "N/A";
  } catch (err) {
    console.error("Trial Grant Error:", err);
    alert("Failed to grant membership.");
  }
}

async function revokeMembership() {
  const el = getDOMElements();
  const targetUsername = el.adminTrialUsername.value.trim().toLowerCase();
  if (!targetUsername) return alert("Please enter a username to revoke.");

  if (!confirm(`Are you sure you want to revoke ALL membership perks and trials for ${targetUsername}?`)) return;

  try {
    const q = query(collection(db, "users"), where("username", "==", targetUsername));
    const snap = await getDocs(q);
    if (snap.empty) return alert("User not found.");

    const userDoc = snap.docs[0];
    const userRef = doc(db, "users", userDoc.id);

    await updateDoc(userRef, {
      membershipLevel: "standard",
      trialExpiration: null,
      membershipLastPaid: null,
      shopOrderCount: 0
    });

    await logHistory(userDoc.id, "Admin revoked your membership/trial status.", "admin");

    const timestamp = new Date().toLocaleString();
    sendSlackMessage(`🚫 *Admin Revoke:* ${targetUsername}'s membership/trial has been manually revoked by Admin.\n*Time:* ${timestamp}`);

    alert(`Successfully revoked membership for ${targetUsername}.`);
    
    el.adminTrialUsername.value = "";
    el.adminTrialUserInfo.textContent = "N/A";
  } catch (err) {
    console.error("Revoke Error:", err);
    alert("Failed to revoke membership.");
  }
}

// ---------- Renewal Requests ----------
export function loadRenewalRequests() {
  const el = getDOMElements();
  if (!el.renewalRequestsContainer) {
    console.warn("renewalRequestsContainer not found");
    return;
  }
  
  // Set up real-time listener instead of one-time query
  const q = query(collection(db, "users"), where("renewalPending", "==", true));
  
  if (renewalRequestsListener) renewalRequestsListener();
  
  renewalRequestsListener = onSnapshot(q, (snap) => {
    try {
      el.renewalRequestsContainer.innerHTML = "";
      
      if (snap.empty) {
        el.renewalRequestsContainer.innerHTML = "<p style='color: gray; font-style: italic;'>No pending renewal requests.</p>";
        return;
      }
      snap.forEach((docSnap) => {
        const userData = docSnap.data();
        const reqDate = userData.renewalRequestDate ? new Date(userData.renewalRequestDate).toLocaleDateString() : "Unknown";
        const div = document.createElement("div");
        div.className = "renew-request";
        div.style.padding = "15px 0";
        div.style.borderBottom = "1px solid #eee";
        div.innerHTML = `
          <div style="margin-bottom: 5px;">
            <strong style="font-size: 1.2em;">${userData.username}</strong><br>
            <span style="font-size: 0.9em; color: #888;">Requested: ${reqDate}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 15px; margin-top: 10px;">
            <label style="color: #888; font-size: 0.9em;">Expires:</label>
            <input type="date" id="date-${docSnap.id}" style="background: #222; color: #fff; border: 1px solid #444; padding: 8px 12px; border-radius: 5px; flex-grow: 1;">
            <button data-id="${docSnap.id}" class="approve-renew" style="background: #58d68d; color: white; border: none; padding: 10px 20px; border-radius: 8px; font-weight: bold; cursor: pointer;">Approve</button>
            <button data-id="${docSnap.id}" class="deny-renew" style="background: #e74c3c; color: #fff; border: none; padding: 10px 20px; border-radius: 8px; font-weight: bold; cursor: pointer;">Deny</button>
          </div>`;
        el.renewalRequestsContainer.appendChild(div);
      });
      attachRenewalListeners();
    } catch (err) {
      console.error("Renewal listener error:", err);
      el.renewalRequestsContainer.innerHTML = "<p style='color: red;'>Error loading requests.</p>";
    }
  }, (error) => {
    console.error("Renewal snapshot error:", error);
    el.renewalRequestsContainer.innerHTML = "<p style='color: red;'>Error loading requests.</p>";
  });
}

function attachRenewalListeners() {
  document.querySelectorAll(".approve-renew").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const userId = btn.dataset.id;
      const dateInput = document.getElementById(`date-${userId}`);
      if (!dateInput.value) return alert("⚠️ Select an expiration date!");
      const expirationDate = new Date(dateInput.value);
      expirationDate.setHours(23, 59, 59);
      try {
        const userRef = doc(db, "users", userId);
        const userSnap = await getDoc(userRef);
        const username = userSnap.exists() ? userSnap.data().username : "Unknown User";

        await updateDoc(userRef, {
          renewalDate: new Date().toISOString(),
          expirationDate: expirationDate.toISOString(),
          renewalPending: false
        });
        await logHistory(userId, `ID Renewal Approved`, "admin");
        
        const timestamp = new Date().toLocaleString();
        sendSlackMessage(`🪪 *ID Renewal:* Admin approved identity renewal for *${username}*.\n*New Expiration:* ${expirationDate.toLocaleDateString()}\n*Time:* ${timestamp}`);

        alert(`✅ Approved!`);
        loadRenewalRequests();
      } catch (err) {
        alert("Error: " + err.message);
      }
    });
  });
  
  document.querySelectorAll(".deny-renew").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const userId = btn.dataset.id;
      if (!confirm("Deny this request?")) return;
      try {
        await updateDoc(doc(db, "users", userId), { renewalPending: false });
        await logHistory(userId, `ID Renewal Denied`, "admin");
        alert(`❌ Request Denied.`);
        loadRenewalRequests();
      } catch (err) {
        alert("Error: " + err.message);
      }
    });
  });
}