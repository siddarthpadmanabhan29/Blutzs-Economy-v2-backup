// ---------- aiChat.js ----------
// Frontend AI assistant widget ("Blutz Assistant").
// - Read-only: can view the logged-in user's own live account data (balance, BPS,
//   membership, insurance, loan, fine, retirement, credit score, stock portfolio,
//   contracts, recent activity) to answer questions/give advice, but never performs
//   any action (no transfers, purchases, approvals, writes of any kind).
// - Chat history lives only in memory for this page session; closing the panel
//   clears it, so reopening always starts a fresh conversation (no Firestore,
//   no localStorage).
// - Calls a secure serverless proxy (Vercel) that holds the Gemini API key and
//   the knowledge-base markdown server-side, so no secret ever reaches the browser.

import { auth, db } from "./firebaseConfig.js";
import { collection, doc, getDoc, getDocs } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { getCurrentDashboardData, getCachedHistory } from "./dashboard.js";
import { getPortfolioSnapshot } from "./shop/stockMarket.js";
import { getCachedContracts } from "./contracts.js";
import { getCreditStatus } from "./finance/loan.js";
import { getDebtLedger } from "./debtManager.js";

const AI_CHAT_ENDPOINT = "https://slack-webhook-lyart.vercel.app/api/aiChat";
const MAX_INPUT_LENGTH = 1000;

const toggleBtn = document.getElementById("ai-chat-toggle-btn");
const panel = document.getElementById("ai-chat-panel");
const closeBtn = document.getElementById("ai-chat-close-btn");
const messagesEl = document.getElementById("ai-chat-messages");
const form = document.getElementById("ai-chat-form");
const input = document.getElementById("ai-chat-input");
const sendBtn = document.getElementById("ai-chat-send-btn");

let conversation = []; // { role: "user" | "assistant", content: string }
let isSending = false;

/* =========================================================
    SAFE MARKDOWN RENDERING
    Escapes all input first, then re-introduces only a fixed
    set of tags we construct ourselves — the model's reply can
    never inject arbitrary HTML/script.
========================================================= */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInline(str) {
  const stash = [];
  const save = (html) => {
    stash.push(html);
    return `\u0000${stash.length - 1}\u0000`;
  };

  // inline code
  str = str.replace(/`([^`]+)`/g, (_, code) => save(`<code>${code}</code>`));
  // links: only allow http(s) URLs
  str = str.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, text, url) =>
    save(`<a href="${url.replace(/"/g, "%22")}" target="_blank" rel="noopener noreferrer">${text}</a>`)
  );
  // bold
  str = str.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // italics
  str = str.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
  str = str.replace(/(?<!_)_([^_]+)_(?!_)/g, "<em>$1</em>");

  return str.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[Number(i)]);
}

function markdownToSafeHtml(raw) {
  const lines = escapeHtml(raw).split(/\r?\n/);
  let html = "";
  let i = 0;
  let inCode = false;
  let codeBuf = [];
  let listBuf = [];
  let listType = null;
  let paraBuf = [];

  const flushPara = () => {
    if (paraBuf.length) {
      html += `<p>${paraBuf.map(renderInline).join("<br>")}</p>`;
      paraBuf = [];
    }
  };
  const flushList = () => {
    if (listBuf.length) {
      const tag = listType === "ol" ? "ol" : "ul";
      html += `<${tag}>${listBuf.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${tag}>`;
      listBuf = [];
      listType = null;
    }
  };

  const tableSeparator = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (/^```/.test(trimmed)) {
      flushPara();
      flushList();
      if (!inCode) {
        inCode = true;
        codeBuf = [];
      } else {
        html += `<pre><code>${codeBuf.join("\n")}</code></pre>`;
        inCode = false;
      }
      i++;
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      i++;
      continue;
    }

    if (trimmed === "") {
      flushPara();
      flushList();
      i++;
      continue;
    }

    if (trimmed.includes("|") && lines[i + 1] && tableSeparator.test(lines[i + 1])) {
      flushPara();
      flushList();
      const headerCells = trimmed.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().includes("|")) {
        rows.push(lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
        i++;
      }
      html +=
        `<table class="ai-chat-table"><thead><tr>${headerCells.map((c) => `<th>${renderInline(c)}</th>`).join("")}</tr></thead><tbody>` +
        rows.map((r) => `<tr>${r.map((c) => `<td>${renderInline(c)}</td>`).join("")}</tr>`).join("") +
        "</tbody></table>";
      continue;
    }

    const headerMatch = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (headerMatch) {
      flushPara();
      flushList();
      html += `<p><strong>${renderInline(headerMatch[2])}</strong></p>`;
      i++;
      continue;
    }

    if (/^&gt;\s?/.test(trimmed)) {
      flushPara();
      flushList();
      html += `<blockquote>${renderInline(trimmed.replace(/^&gt;\s?/, ""))}</blockquote>`;
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushPara();
      flushList();
      html += "<hr>";
      i++;
      continue;
    }

    const ulMatch = /^[-*]\s+(.*)$/.exec(trimmed);
    if (ulMatch) {
      flushPara();
      if (listType && listType !== "ul") flushList();
      listType = "ul";
      listBuf.push(ulMatch[1]);
      i++;
      continue;
    }

    const olMatch = /^\d+\.\s+(.*)$/.exec(trimmed);
    if (olMatch) {
      flushPara();
      if (listType && listType !== "ol") flushList();
      listType = "ol";
      listBuf.push(olMatch[1]);
      i++;
      continue;
    }

    flushList();
    paraBuf.push(trimmed);
    i++;
  }

  flushPara();
  flushList();
  if (inCode && codeBuf.length) html += `<pre><code>${codeBuf.join("\n")}</code></pre>`;
  return html;
}

/* =========================================================
    UI HELPERS
========================================================= */
function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function appendBubble(role, html, extraClass) {
  const bubble = document.createElement("div");
  bubble.className = `ai-chat-bubble ai-chat-${role}`;
  if (extraClass) bubble.classList.add(extraClass);
  bubble.innerHTML = html;
  messagesEl.appendChild(bubble);
  scrollToBottom();
  return bubble;
}

function appendUserMessage(text) {
  const bubble = document.createElement("div");
  bubble.className = "ai-chat-bubble ai-chat-user";
  bubble.textContent = text; // plain text only, never interpreted as HTML
  messagesEl.appendChild(bubble);
  scrollToBottom();
}

function appendAssistantMessage(text) {
  appendBubble("assistant", markdownToSafeHtml(text));
}

function showWelcome() {
  messagesEl.innerHTML = "";
  appendBubble(
    "assistant",
    markdownToSafeHtml(
      "Hi! I'm the **Blutz Assistant** 🤖 — ask me how anything on this site works (loans, subscriptions, BPS, chores, debt, fines, etc), or ask about your own balance, BPS, membership, insurance, contracts, stock portfolio, recent activity, or debt ledger. I can't perform any actions (no transfers, purchases, approvals, or edits) — just answer questions and give advice."
    )
  );
}

/* =========================================================
    LIVE USER CONTEXT (read-only)
    Reuses data other modules already keep live via onSnapshot,
    so sending a chat message costs 0 extra Firestore reads in
    the common case (only falls back to a single getDoc if the
    dashboard listener hasn't populated its cache yet).
========================================================= */
async function buildUserContext() {
  const user = auth.currentUser;
  if (!user) return null;

  let data = getCurrentDashboardData();
  if (!data) {
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists()) data = snap.data();
    } catch (err) {
      console.warn("aiChat: fallback user fetch failed", err);
    }
  }
  if (!data) return null;

  const creditScore = data.creditScore ?? 600;
  let inventoryItems = [];
  try {
    const inventorySnap = await getDocs(collection(db, "users", user.uid, "inventory"));
    inventoryItems = inventorySnap.docs.map((itemDoc) => ({ id: itemDoc.id, ...itemDoc.data() }));
  } catch (err) {
    console.warn("aiChat: inventory fetch failed", err);
  }

  let choresItems = [];
  try {
    const choresSnap = await getDocs(collection(db, "chores"));
    choresItems = choresSnap.docs.map((choreDoc) => ({ id: choreDoc.id, ...choreDoc.data() }));
  } catch (err) {
    console.warn("aiChat: chores fetch failed", err);
  }

  const stockPortfolio = getPortfolioSnapshot().filter((p) => p.shares > 0);
  const contracts = getCachedContracts().map((c) => ({
    status: c.status,
    terms: c.terms || null,
    signingBonus: c.signingBonus || 0,
  }));
  const debtLedger = getDebtLedger(data);
  const recentActivity = getCachedHistory()
    .slice(0, 15)
    .map((h) => ({ message: h.message, timestamp: h.timestamp }));

  const now = Date.now();
  const inventoryWithExpiry = inventoryItems
    .map((item) => {
      const expiresAt = item.expiresAt ? new Date(item.expiresAt) : null;
      const expiresInMs = expiresAt ? expiresAt.getTime() - now : null;
      return {
        id: item.id,
        name: item.name || null,
        type: item.type || null,
        acquiredAt: item.acquiredAt || null,
        expiresAt: item.expiresAt || null,
        expiresInMs,
        isExpired: Boolean(expiresAt && expiresAt.getTime() <= now),
      };
    })
    .sort((a, b) => (a.expiresInMs ?? Number.POSITIVE_INFINITY) - (b.expiresInMs ?? Number.POSITIVE_INFINITY));

  const expiringInventory = inventoryWithExpiry
    .filter((item) => item.expiresAt)
    .slice(0, 12);

  const expiringSoonCount = inventoryWithExpiry.filter((item) => item.expiresInMs !== null && item.expiresInMs <= 30 * 24 * 60 * 60 * 1000 && item.expiresInMs > 0).length;
  const expiredInventoryCount = inventoryWithExpiry.filter((item) => item.isExpired).length;

  const choreSummary = choresItems.reduce((summary, chore) => {
    const isMine = chore.assignedTo === user.uid;
    const isCreatedByMe = chore.createdBy === user.uid;
    summary.total += 1;
    if (chore.status === "open") summary.open += 1;
    if (chore.status === "assigned") summary.assigned += 1;
    if (chore.status === "in_progress") summary.inProgress += 1;
    if (chore.status === "pending_review") summary.pendingReview += 1;
    if (chore.status === "completed") summary.completed += 1;
    if (isMine) summary.mine += 1;
    if (isCreatedByMe) summary.createdByMe += 1;
    return summary;
  }, { total: 0, open: 0, assigned: 0, inProgress: 0, pendingReview: 0, completed: 0, mine: 0, createdByMe: 0 });

  const activeChores = choresItems
    .filter((chore) => chore.status === "open" || chore.status === "assigned" || chore.status === "in_progress" || chore.status === "pending_review")
    .map((chore) => ({
      id: chore.id,
      title: chore.title || null,
      status: chore.status || null,
      reward: Number(chore.reward || 0),
      deadline: chore.deadline || null,
      assignmentMode: chore.assignmentMode || null,
      assignedTo: chore.assignedTo || null,
      createdBy: chore.createdBy || null,
      isMine: chore.assignedTo === user.uid,
      isCreatedByMe: chore.createdBy === user.uid,
    }))
    .sort((a, b) => new Date(a.deadline || 0) - new Date(b.deadline || 0))
    .slice(0, 12);

  const debtBreakdown = {
    fineDebt: debtLedger.fineDebt ? {
      amount: debtLedger.fineDebt.amount,
      originalAmount: debtLedger.fineDebt.originalAmount,
      coveredAmount: debtLedger.fineDebt.coveredAmount,
      remainingDue: debtLedger.fineDebt.remainingDue,
      insuranceCoverageRate: debtLedger.fineDebt.insuranceCoverageRate,
      insuranceActive: debtLedger.fineDebt.insuranceActive,
      reason: debtLedger.fineDebt.reason,
      dueDate: debtLedger.fineDebt.dueDate,
      appealPending: debtLedger.fineDebt.appealPending,
      appealStatus: debtLedger.fineDebt.appealStatus,
      appealReason: debtLedger.fineDebt.appealReason,
    } : null,
    adminDebts: debtLedger.adminDebts.map((debt) => ({
      id: debt.id,
      amount: debt.amount,
      remaining: debt.remaining,
      reason: debt.reason,
      dueDate: debt.dueDate,
      status: debt.status,
    })),
    totals: {
      fineTotal: debtLedger.fineTotal,
      adminTotal: debtLedger.adminTotal,
      loanTotal: debtLedger.loanTotal,
      totalDebt: debtLedger.totalDebt,
      globalDebt: debtLedger.globalDebt,
    },
  };

  return {
    debtLedger: debtBreakdown,
    username: data.username || user.email?.split("@")[0] || "user",
    balance: data.balance ?? 0,
    bpsBalance: data.bpsBalance ?? 0,
    bpsDecay: {
      expiryAt: data.bpsExpiryAt || null,
      decayStartedAt: data.bpsDecayStartedAt || null,
      atRiskAmount: Math.min(10, Number(data.bpsBalance || 0)),
    },
    membershipLevel: data.membershipLevel || "standard",
    employmentStatus: data.employmentStatus || null,
    creditScore,
    creditTier: getCreditStatus(creditScore)?.label || null,
    insurance: { activePackages: data.insurance?.activePackages || [] },
    loan: data.activeLoan > 0
      ? {
          activeLoan: data.activeLoan,
          originalLoanAmount: data.originalLoanAmount ?? null,
          loanDeadline: data.loanDeadline ?? null,
        }
      : null,
    activeFine: data.activeFine || null,
    retirementSavings: data.retirementSavings ?? 0,
    stockPortfolio,
    inventory: {
      totalItems: inventoryWithExpiry.length,
      expiringSoonCount,
      expiredCount: expiredInventoryCount,
      items: expiringInventory,
    },
    chores: {
      summary: choreSummary,
      active: activeChores,
      guidance: {
        canAnswerGeneralQuestions: true,
        canGiveAdvice: true,
        canExplainStatus: true,
      },
    },
    contracts,
    recentActivity,
  };
}

function setTypingIndicator(show) {
  let indicator = document.getElementById("ai-chat-typing");
  if (show) {
    if (indicator) return;
    indicator = document.createElement("div");
    indicator.id = "ai-chat-typing";
    indicator.className = "ai-chat-bubble ai-chat-assistant ai-chat-typing";
    indicator.innerHTML = "<span></span><span></span><span></span>";
    messagesEl.appendChild(indicator);
    scrollToBottom();
  } else {
    indicator?.remove();
  }
}

/* =========================================================
    OPEN / CLOSE (fresh history every time it's reopened)
========================================================= */
function openChat() {
  panel.classList.remove("hidden");
  toggleBtn.setAttribute("aria-expanded", "true");
  if (conversation.length === 0) showWelcome();
  input.focus();
}

function closeChat() {
  panel.classList.add("hidden");
  toggleBtn.setAttribute("aria-expanded", "false");
  conversation = [];
  messagesEl.innerHTML = "";
}

function toggleChat() {
  if (panel.classList.contains("hidden")) openChat();
  else closeChat();
}

/* =========================================================
    SEND MESSAGE
========================================================= */
async function sendMessage(text) {
  conversation.push({ role: "user", content: text });
  appendUserMessage(text);
  input.value = "";
  isSending = true;
  sendBtn.disabled = true;
  setTypingIndicator(true);

  try {
    const userContext = await buildUserContext();
    const response = await fetch(AI_CHAT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: conversation, userContext }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.reply) {
      throw new Error(data.error || "The assistant is unavailable right now.");
    }

    const replyText = data.truncated ? `${data.reply}\n\n*(cut short — ask "continue" for the rest)*` : data.reply;
    conversation.push({ role: "assistant", content: data.reply });
    setTypingIndicator(false);
    appendAssistantMessage(replyText);
  } catch (err) {
    console.error("AI chat error:", err);
    setTypingIndicator(false);
    appendBubble(
      "assistant",
      markdownToSafeHtml("⚠️ Sorry, I couldn't reach the assistant. Please try again in a moment."),
      "ai-chat-error"
    );
  } finally {
    isSending = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

toggleBtn?.addEventListener("click", toggleChat);
closeBtn?.addEventListener("click", closeChat);

form?.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim().slice(0, MAX_INPUT_LENGTH);
  if (!text || isSending) return;
  sendMessage(text);
});
