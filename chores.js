import { auth, db } from "./firebaseConfig.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  onSnapshot,
  query,
  runTransaction,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { logHistory } from "./historyManager.js";
import { sendSlackMessage } from "./slackNotifier.js";

// How long a completed/denied chore stays visible in the list before it's hidden client-side.
const CHORE_HISTORY_VISIBLE_DAYS = 1;
// Hard cap on how many chore docs we sync at once, newest first.
const CHORES_QUERY_LIMIT = 200;

let currentUser = null;
let currentUserData = null;
let isAdmin = false;
let choresUnsub = null;
let usersUnsub = null;
let choresCache = [];
let usersCache = [];
let choresLoaded = false;
let choresLoadError = null;
let choresCacheById = new Map();
let choreRemovalTimers = new Map();

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatMoney(value) {
  const amount = Number(value || 0);
  return `$${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatDeadline(value) {
  if (!value) return "No deadline";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "No deadline";
  return date.toLocaleString();
}

function getChoreSortTime(chore) {
  const candidates = [chore.createdAt, chore.reviewedAt, chore.completedAt, chore.submittedAt, chore.acceptedAt, chore.pickedUpAt];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const date = new Date(candidate);
    if (!Number.isNaN(date.getTime())) return date.getTime();
  }

  return 0;
}

function getChoreAssigneeName(chore) {
  return chore.assignedTo ? getUserNameByUid(chore.assignedTo) : "Open for pickup";
}

async function notifyChoreCreated(chore) {
  const createdAt = chore.createdAt ? formatDeadline(chore.createdAt) : "just now";
  const reward = formatMoney(chore.reward);
  const deadline = formatDeadline(chore.deadline);

  if (chore.assignmentMode === "assigned" && chore.assignedTo) {
    const assigneeName = getChoreAssigneeName(chore);
    await sendSlackMessage(
      `🧹 *New assigned chore created:* ${chore.title}\n*Reward:* ${reward}\n*Deadline:* ${deadline}\n*Assigned to:* ${assigneeName}\n*Created:* ${createdAt}`
    );
    return;
  }

  await sendSlackMessage(
    `🧹 *New chore available:* ${chore.title}\n*Reward:* ${reward}\n*Deadline:* ${deadline}\n*Created:* ${createdAt}\n*Pickup:* Open for anyone`
  );
}

async function notifyChoreStatusChange(chore, action, actorName) {
  const actorLabel = actorName || "A user";
  const reward = formatMoney(chore.reward);
  const deadline = formatDeadline(chore.deadline);

  switch (action) {
    case "accept":
      await sendSlackMessage(`✅ *Chore accepted:* ${chore.title}\n*By:* ${actorLabel}\n*Reward:* ${reward}\n*Deadline:* ${deadline}`);
      break;
    case "decline":
      await sendSlackMessage(`⚠️ *Chore declined:* ${chore.title}\n*By:* ${actorLabel}\n*Reward:* ${reward}\n*Deadline:* ${deadline}`);
      break;
    case "done":
      await sendSlackMessage(`📝 *Chore marked complete:* ${chore.title}\n*By:* ${actorLabel}\n*Reward:* ${reward}\n*Deadline:* ${deadline}`);
      break;
    default:
      break;
  }
}

function getStatusLabel(status) {
  switch (status) {
    case "assigned":
      return "Assigned";
    case "in_progress":
      return "In Progress";
    case "pending_review":
      return "Pending Review";
    case "completed":
      return "Completed";
    case "denied":
      return "Denied";
    case "open":
    default:
      return "Open";
  }
}

function getUserNameByUid(uid) {
  const user = usersCache.find((entry) => entry.uid === uid);
  return user?.username || "Unknown user";
}

// Completed/denied chores older than CHORE_HISTORY_VISIBLE_DAYS are hidden from the
// active list so it doesn't grow forever. They still exist in Firestore and in the
// activity log via logHistory — this only affects what shows in "Available Chores".
function isChoreStale(chore) {
  if (chore.status !== "completed" && chore.status !== "denied") return false;

  const resolvedAt = chore.reviewedAt || chore.completedAt || chore.createdAt;
  if (!resolvedAt) return false;

  const resolvedDate = new Date(resolvedAt);
  if (Number.isNaN(resolvedDate.getTime())) return false;

  const cutoffMs = CHORE_HISTORY_VISIBLE_DAYS * 24 * 60 * 60 * 1000;
  return Date.now() - resolvedDate.getTime() > cutoffMs;
}

// Renders the full admin control list (approve/deny/delete/remove-from-display)
// inside the Admin Panel's Chore Management section. Admin-only actions live
// here now instead of being scattered across the shared chores list.
function renderChoreAdminManagement() {
  const manageEl = document.getElementById("chores-admin-manage-list");
  if (!manageEl) return;

  if (!isAdmin) {
    manageEl.innerHTML = "";
    return;
  }

  if (!choresLoaded) {
    manageEl.innerHTML = '<p style="color:#666; font-size:0.75rem; margin:0;">Loading chores...</p>';
    return;
  }

  if (choresLoadError) {
    manageEl.innerHTML = '<p style="color:#e74c3c; font-size:0.75rem; margin:0;">Unable to load chores right now.</p>';
    return;
  }

  const manageableChores = [...choresCache]
    .filter((chore) => !chore.dismissed)
    .sort((a, b) => getChoreSortTime(b) - getChoreSortTime(a));

  manageEl.innerHTML = manageableChores.length
    ? manageableChores.map((chore) => {
        const canReview = chore.status === "pending_review";
        const canDismiss = chore.status === "completed" || chore.status === "denied";

        return `
          <div class="chore-card chore-card--compact" style="background: rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:12px; display:flex; flex-direction:column; gap:8px;">
            <div class="chore-title-row" style="display:flex; justify-content:space-between; gap:8px; align-items:center; flex-wrap:wrap;">
              <strong style="color:#fff; font-size:0.85rem;">${escapeHtml(chore.title)}</strong>
              <span style="font-size:0.65rem; text-transform:uppercase; color:#f1c40f; font-weight:800;">${getStatusLabel(chore.status)}</span>
            </div>
            <div style="font-size:0.75rem; color:#aaa;">Assigned to: ${chore.assignedTo ? escapeHtml(getUserNameByUid(chore.assignedTo)) : "Open for pickup"}</div>
            <div style="font-size:0.75rem; color:#aaa;">Reward: ${formatMoney(chore.reward)} • Deadline: ${formatDeadline(chore.deadline)}</div>
            <div class="chore-actions" style="display:flex; gap:8px; flex-wrap:wrap;">
              ${canReview ? `<button type="button" class="btn-primary" data-action="approve" data-id="${chore.id}" style="padding:6px 10px; font-size:0.7rem;">Approve</button>` : ""}
              ${canReview ? `<button type="button" class="btn-danger" data-action="deny" data-id="${chore.id}" style="padding:6px 10px; font-size:0.7rem;">Deny</button>` : ""}
              ${canDismiss ? `<button type="button" class="btn-secondary" data-action="dismiss" data-id="${chore.id}" style="padding:6px 10px; font-size:0.7rem;">Remove from Display</button>` : ""}
              <button type="button" class="btn-danger" data-action="delete" data-id="${chore.id}" style="padding:6px 10px; font-size:0.7rem; opacity:0.85;">🗑️ Delete</button>
            </div>
          </div>
        `;
      }).join("")
    : '<p style="color:#666; font-size:0.75rem; margin:0;">No chores to manage.</p>';
}

function upsertChoreCache(choreData) {
  if (!choreData?.id) return;

  const existingTimer = choreRemovalTimers.get(choreData.id);
  if (existingTimer) {
    clearTimeout(existingTimer);
    choreRemovalTimers.delete(choreData.id);
  }

  choresCacheById.set(choreData.id, choreData);
  choresCache = [...choresCacheById.values()];
}

function scheduleChoreRemoval(choreId) {
  if (!choreId) return;

  const existingTimer = choreRemovalTimers.get(choreId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    choresCacheById.delete(choreId);
    choreRemovalTimers.delete(choreId);
    choresCache = [...choresCacheById.values()];
    renderChores();
  }, 1500);

  choreRemovalTimers.set(choreId, timer);
}

function renderChores() {
  const listEl = document.getElementById("chores-list");
  const adminReviewEl = document.getElementById("chores-admin-review-list");
  const statsEl = document.getElementById("chores-stats");
  const leaderboardEl = document.getElementById("chores-leaderboard");
  const badgeEl = document.getElementById("chores-status-badge");
  const adminSectionEl = document.getElementById("chores-admin-section");
  const adminInfoEl = document.getElementById("chores-admin-info");

  if (!listEl || !statsEl || !leaderboardEl) return;

  if (adminSectionEl) {
    adminSectionEl.classList.toggle("hidden", !isAdmin);
  }
  if (adminInfoEl) {
    adminInfoEl.textContent = isAdmin ? "Admin controls enabled" : "Admin access required to create chores";
  }

  const pendingReview = choresCache.filter((chore) => chore.status === "pending_review");
  const myActiveChores = choresCache.filter((chore) => {
    if (!currentUser) return false;
    if (isChoreStale(chore)) return false;
    if (chore.dismissed) return false;
    return true;
  });

  const stats = {
    completed: Number(currentUserData?.choresCompleted || 0),
    points: Number(currentUserData?.chorePoints || 0),
    declines: Number(currentUserData?.choreDeclines || 0),
    pending: choresCache.filter((chore) => chore.status === "pending_review" && chore.assignedTo === currentUser?.uid).length
  };

  if (badgeEl) {
    badgeEl.textContent = `${choresCache.length} total chores`;
  }

  statsEl.innerHTML = `
    <div style="display:grid; gap:10px; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));">
      <div style="background: var(--input-bg); border: 1px solid var(--border-color); border-radius: 10px; padding: 12px;">
        <div style="font-size:0.65rem; color:#888; text-transform:uppercase; font-weight:800; letter-spacing:1px;">Completed</div>
        <div style="font-size:1.25rem; font-weight:800; color:#2ecc71; margin-top:4px;">${stats.completed}</div>
      </div>
      <div style="background: var(--input-bg); border: 1px solid var(--border-color); border-radius: 10px; padding: 12px;">
        <div style="font-size:0.65rem; color:#888; text-transform:uppercase; font-weight:800; letter-spacing:1px;">Chore Points</div>
        <div style="font-size:1.25rem; font-weight:800; color:#f1c40f; margin-top:4px;">${stats.points}</div>
      </div>
      <div style="background: var(--input-bg); border: 1px solid var(--border-color); border-radius: 10px; padding: 12px;">
        <div style="font-size:0.65rem; color:#888; text-transform:uppercase; font-weight:800; letter-spacing:1px;">Declines</div>
        <div style="font-size:1.25rem; font-weight:800; color:#e74c3c; margin-top:4px;">${stats.declines}</div>
      </div>
      <div style="background: var(--input-bg); border: 1px solid var(--border-color); border-radius: 10px; padding: 12px;">
        <div style="font-size:0.65rem; color:#888; text-transform:uppercase; font-weight:800; letter-spacing:1px;">Pending Review</div>
        <div style="font-size:1.25rem; font-weight:800; color:#3498db; margin-top:4px;">${stats.pending}</div>
      </div>
    </div>
  `;

  const leaderboardRows = [...usersCache]
    .sort((a, b) => (Number(b.chorePoints || 0) - Number(a.chorePoints || 0)) || (Number(b.choresCompleted || 0) - Number(a.choresCompleted || 0)))
    .slice(0, 8);

  leaderboardEl.innerHTML = leaderboardRows.length
    ? leaderboardRows.map((user, index) => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid rgba(255,255,255,0.05);">
          <div>
            <div style="font-weight:800; color:var(--text-main);">#${index + 1} ${escapeHtml(user.username || "Unknown")}</div>
            <div style="font-size:0.75rem; color:var(--text-muted);">${Number(user.choresCompleted || 0)} chores • ${Number(user.chorePoints || 0)} points</div>
          </div>
          <div style="font-weight:800; color:#f1c40f;">${Number(user.chorePoints || 0)} pts</div>
        </div>
      `).join("")
    : '<p style="color:#666; font-size:0.8rem; margin:0;">No chore activity yet.</p>';

  if (adminReviewEl) {
    adminReviewEl.innerHTML = pendingReview.length
      ? pendingReview.map((chore) => `
          <div class="chore-card chore-card--compact" style="background: var(--input-bg); border:1px solid var(--border-color); border-radius:10px; padding:12px; display:flex; flex-direction:column; gap:8px;">
            <div class="chore-title-row" style="display:flex; justify-content:space-between; gap:8px; align-items:center; flex-wrap:wrap;">
              <strong style="color:var(--text-main);">${escapeHtml(chore.title)}</strong>
              <span style="font-size:0.7rem; text-transform:uppercase; color:#f1c40f; font-weight:800;">${getStatusLabel(chore.status)}</span>
            </div>
            <div style="font-size:0.8rem; color:var(--text-muted);">Assigned to: ${escapeHtml(getUserNameByUid(chore.assignedTo))}</div>
            <div style="font-size:0.8rem; color:var(--text-muted);">Reward: ${formatMoney(chore.reward)} • Deadline: ${formatDeadline(chore.deadline)}</div>
            <span style="font-size:0.72rem; color:var(--text-muted);">Awaiting admin review</span>
          </div>
        `).join("")
      : '<p style="color:#666; font-size:0.8rem; margin:0;">No chores awaiting review.</p>';
  }

  if (listEl) {
    if (!myActiveChores.length) {
      listEl.innerHTML = '<p style="color:#666; font-size:0.8rem; margin:0;">No chores available right now.</p>';
      return;
    }

    listEl.innerHTML = myActiveChores
      .sort((a, b) => new Date(a.deadline || 0) - new Date(b.deadline || 0))
      .map((chore) => {
        const isAssignedToMe = currentUser && chore.assignedTo === currentUser.uid;
        const isMine = currentUser && chore.createdBy === currentUser.uid;
        const canPickUp = chore.assignmentMode === "free" && !chore.assignedTo && chore.status === "open";
        const canAccept = isAssignedToMe && chore.status === "assigned";
        const canDecline = isAssignedToMe && chore.status === "assigned";
        const canDone = isAssignedToMe && chore.status === "in_progress";

        return `
          <div class="chore-card" style="background: var(--input-bg); border:1px solid var(--border-color); border-radius:12px; padding:14px; display:flex; flex-direction:column; gap:10px; margin-bottom:12px;">
            <div class="chore-title-row" style="display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap; align-items:center;">
              <div>
                <div style="font-weight:800; color:var(--text-main);">${escapeHtml(chore.title)}</div>
                <div class="chore-subtitle" style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">${escapeHtml(chore.assignmentMode === "free" ? "Free pick up" : "Assigned chore")}</div>
              </div>
              <span style="font-size:0.7rem; text-transform:uppercase; color:#f1c40f; font-weight:800;">${getStatusLabel(chore.status)}</span>
            </div>
            <div class="chore-meta-grid" style="display:grid; gap:6px; font-size:0.82rem; color:var(--text-muted);">
              <div>Reward: ${formatMoney(chore.reward)}</div>
              <div>Deadline: ${formatDeadline(chore.deadline)}</div>
              <div>Owner: ${escapeHtml(getUserNameByUid(chore.createdBy) || "Admin")}</div>
              <div>Assigned to: ${chore.assignedTo ? escapeHtml(getUserNameByUid(chore.assignedTo)) : "Open for pickup"}</div>
            </div>
            <div class="chore-actions" style="display:flex; gap:8px; flex-wrap:wrap;">
              ${canAccept ? `<button type="button" class="btn-primary" data-action="accept" data-id="${chore.id}" style="padding:8px 12px; font-size:0.75rem;">Accept</button>` : ""}
              ${canDecline ? `<button type="button" class="btn-danger" data-action="decline" data-id="${chore.id}" style="padding:8px 12px; font-size:0.75rem;">Decline</button>` : ""}
              ${canPickUp ? `<button type="button" class="btn-primary" data-action="pickup" data-id="${chore.id}" style="padding:8px 12px; font-size:0.75rem;">Pick Up</button>` : ""}
              ${canDone ? `<button type="button" class="btn-primary" data-action="done" data-id="${chore.id}" style="padding:8px 12px; font-size:0.75rem;">Mark Done</button>` : ""}
              ${isMine && chore.status !== "completed" && chore.status !== "denied" ? `<span style="font-size:0.72rem; color:var(--text-muted); align-self:center;">Created by you</span>` : ""}
            </div>
          </div>
        `;
      }).join("");
  }

  renderChoreAdminManagement();
}

async function createChore(event) {
  event.preventDefault();
  if (!currentUser || !isAdmin) return;

  const form = document.getElementById("chore-form");
  if (!form) return;

  const title = document.getElementById("chore-title").value.trim();
  const reward = Number(document.getElementById("chore-reward").value);
  const deadline = document.getElementById("chore-deadline").value;
  const assignmentMode = document.getElementById("chore-assignment-mode").value;
  const assignToUsername = document.getElementById("chore-assign-to").value.trim();

  if (!title || !deadline || Number.isNaN(reward) || reward <= 0) {
    alert("Please fill in the chore title, reward, and deadline.");
    return;
  }

  let assignedTo = null;
  if (assignmentMode === "assigned") {
    if (!assignToUsername) {
      alert("Please enter a username when assigning this chore.");
      return;
    }
    const userQuery = query(collection(db, "users"), where("usernameLower", "==", assignToUsername.toLowerCase().replace(/\s/g, "")));
    const userSnap = await getDocs(userQuery);
    if (userSnap.empty) {
      alert("That username was not found.");
      return;
    }
    assignedTo = userSnap.docs[0].id;
  }

  const choreData = {
    title,
    reward,
    deadline: new Date(deadline).toISOString(),
    assignmentMode,
    allowFreePickup: assignmentMode === "free",
    assignedTo,
    status: assignmentMode === "assigned" ? "assigned" : "open",
    createdAt: new Date().toISOString(),
    createdBy: currentUser.uid,
    createdByName: currentUserData?.username || "Admin"
  };

  await addDoc(collection(db, "chores"), choreData);
  await notifyChoreCreated(choreData);
  form.reset();
  await logHistory(currentUser.uid, `Created chore: ${title}`, "chore");
  alert("Chore created successfully.");
}

async function handleChoreAction(event) {
  event.preventDefault();
  const button = event.target.closest("button[data-action]");
  if (!button || !currentUser) return;

  const action = button.getAttribute("data-action");
  const choreId = button.getAttribute("data-id");
  if (!choreId) return;

  const choreRef = doc(db, "chores", choreId);
  const choreSnap = await getDoc(choreRef);
  if (!choreSnap.exists()) return;

  const chore = choreSnap.data();
  const now = new Date().toISOString();
  const isOwnerOfAssignment = chore.assignedTo === currentUser.uid;

  try {
    if (action === "accept") {
      if (!isOwnerOfAssignment || chore.status !== "assigned") return;
      await updateDoc(choreRef, { status: "in_progress", acceptedAt: now });
      await notifyChoreStatusChange(chore, "accept", currentUserData?.username || currentUser?.displayName || "A user");
      await logHistory(currentUser.uid, `Accepted chore: ${chore.title}`, "chore", now);

    } else if (action === "decline") {
      if (!isOwnerOfAssignment || chore.status !== "assigned") return;

      await updateDoc(choreRef, {
        status: "open",
        assignedTo: null,
        assignmentMode: "free", // reset so the chore becomes pickable again, otherwise it gets stuck forever
        declinedAt: now
      });

      // Don't let chorePoints drop below zero
      const userRef = doc(db, "users", currentUser.uid);
      const userSnap = await getDoc(userRef);
      const existingPoints = Number(userSnap.exists() ? userSnap.data().chorePoints || 0 : 0);
      await updateDoc(userRef, {
        choreDeclines: increment(1),
        chorePoints: existingPoints > 0 ? increment(-1) : 0
      });

      await notifyChoreStatusChange(chore, "decline", currentUserData?.username || currentUser?.displayName || "A user");
      await logHistory(currentUser.uid, `Declined chore: ${chore.title}`, "chore", now);

    } else if (action === "pickup") {
      if (chore.assignmentMode !== "free" || chore.assignedTo || chore.status !== "open") return;
      await updateDoc(choreRef, { status: "in_progress", assignedTo: currentUser.uid, pickedUpAt: now });
      await logHistory(currentUser.uid, `Picked up chore: ${chore.title}`, "chore", now);

    } else if (action === "done") {
      if (!isOwnerOfAssignment || chore.status !== "in_progress") return;
      await updateDoc(choreRef, { status: "pending_review", completedBy: currentUser.uid, submittedAt: now });
      await notifyChoreStatusChange(chore, "done", currentUserData?.username || currentUser?.displayName || "A user");
      await logHistory(currentUser.uid, `Marked chore done: ${chore.title}`, "chore", now);

    } else if (action === "approve") {
      if (!isAdmin) return;
      const targetUid = chore.assignedTo;
      const currentReward = Number(chore.reward || 0);

      await updateDoc(choreRef, {
        status: "completed",
        reviewedAt: now,
        reviewedBy: currentUser.uid,
        reviewedByName: currentUserData?.username || "Admin"
      });

      if (targetUid) {
        const targetRef = doc(db, "users", targetUid);

          // Transaction avoids a race condition where two near-simultaneous
          // approvals could both read stale chorePoints and mis-fire the
          // every-10th-chore bonus.
          await runTransaction(db, async (tx) => {
            const targetSnap = await tx.get(targetRef);
            const priorPoints = Number(targetSnap.exists() ? targetSnap.data().chorePoints || 0 : 0);
            const priorBalance = Number(targetSnap.exists() ? targetSnap.data().balance || 0 : 0);
            const priorCompleted = Number(targetSnap.exists() ? targetSnap.data().choresCompleted || 0 : 0);

            const newPoints = priorPoints + 1;
            const bonusAmount = newPoints % 10 === 0 ? 5000 : 0;

            tx.update(targetRef, {
              balance: priorBalance + currentReward + bonusAmount,
              chorePoints: newPoints,
              choresCompleted: priorCompleted + 1,
              ...(bonusAmount > 0 ? { lastChoreBonusAt: now } : {})
            });
          });

          // Read back the updated user doc to compute what was actually paid
          const afterSnap = await getDoc(targetRef);
          const newPoints = Number(afterSnap.exists() ? afterSnap.data().chorePoints || 0 : 0);
          const bonusAmount = newPoints % 10 === 0 ? 5000 : 0;
          const paidMsg = `Chore approved and paid: ${chore.title} — Received $${currentReward.toLocaleString()}${bonusAmount ? ` + $${bonusAmount.toLocaleString()} bonus` : ""}`;

          await logHistory(targetUid, paidMsg, "chore", now);
        }

    } else if (action === "deny") {
      if (!isAdmin) return;
      await updateDoc(choreRef, { status: "denied", reviewedAt: now, reviewedBy: currentUser.uid, reviewedByName: currentUserData?.username || "Admin" });
      const deniedUid = chore.assignedTo || currentUser.uid;
      await logHistory(deniedUid, `Chore denied: ${chore.title} — Not approved by admin`, "chore", now);

    } else if (action === "delete") {
      if (!isAdmin) return;
      const confirmed = window.confirm(`Permanently delete "${chore.title}"? This cannot be undone.`);
      if (!confirmed) return;
      await deleteDoc(choreRef);
      await logHistory(currentUser.uid, `Deleted chore: ${chore.title}`, "chore", now);

    } else if (action === "dismiss") {
      if (!isAdmin) return;
      if (chore.status !== "completed" && chore.status !== "denied") return;
      await updateDoc(choreRef, { dismissed: true, dismissedAt: now, dismissedBy: currentUser.uid });
      await logHistory(currentUser.uid, `Removed chore from display: ${chore.title}`, "chore", now);
    }
  } catch (error) {
    console.error("Chore action failed:", error);
    alert("The chore action could not be completed.");
  }
}

function initializeChoresUI() {
  const form = document.getElementById("chore-form");
  const listEl = document.getElementById("chores-list");
  const reviewEl = document.getElementById("chores-admin-review-list");
  const tabEl = document.getElementById("tab-chores");
  const manageListEl = document.getElementById("chores-admin-manage-list");

  if (form && !form.dataset.bound) {
    form.addEventListener("submit", createChore);
    form.dataset.bound = "true";
  }

  if (tabEl && !tabEl.dataset.bound) {
    tabEl.addEventListener("click", handleChoreAction);
    tabEl.dataset.bound = "true";
  }

  if (manageListEl && !manageListEl.dataset.bound) {
    manageListEl.addEventListener("click", handleChoreAction);
    manageListEl.dataset.bound = "true";
  }

  if (listEl && !listEl.dataset.bound) {
    listEl.dataset.bound = "true";
  }

  if (reviewEl && !reviewEl.dataset.bound) {
    reviewEl.dataset.bound = "true";
  }
}

function subscribeToChores() {
  if (choresUnsub) return;
  const choresQuery = query(collection(db, "chores"));
  choresUnsub = onSnapshot(choresQuery, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      const choreData = { id: change.doc.id, ...change.doc.data() };

      if (change.type === "removed") {
        scheduleChoreRemoval(change.doc.id);
        return;
      }

      upsertChoreCache(choreData);
    });

    choresLoaded = true;
    choresLoadError = null;
    choresCache = [...choresCacheById.values()];
    choresLoaded = true;
    choresLoadError = null;
    renderChores();
  }, (error) => {
    console.error("Failed to subscribe to chores:", error);
    choresLoaded = true;
    choresLoadError = error;
    renderChores();
  });
}

function subscribeToUsers() {
  if (usersUnsub) return;
  usersUnsub = onSnapshot(collection(db, "users"), (snapshot) => {
    usersCache = snapshot.docs.map((docSnap) => ({ uid: docSnap.id, ...docSnap.data() }));
    renderChores();
  });
}

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (!user) {
    currentUserData = null;
    isAdmin = false;
    choresCache = [];
    usersCache = [];
    choresLoaded = false;
    choresLoadError = null;
    choresCacheById.clear();
    for (const timer of choreRemovalTimers.values()) {
      clearTimeout(timer);
    }
    choreRemovalTimers.clear();
    renderChores();
    return;
  }

  initializeChoresUI();
  subscribeToChores();
  subscribeToUsers();

  const userRef = doc(db, "users", user.uid);
  onSnapshot(userRef, (snap) => {
    currentUserData = snap.exists() ? snap.data() : {};
    isAdmin = Boolean(currentUserData?.isAdmin);
    renderChores();
  });
});

initializeChoresUI();
subscribeToChores();
subscribeToUsers();