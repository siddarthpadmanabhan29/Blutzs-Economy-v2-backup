// ---------- aiChat.js ----------
// Frontend AI assistant widget ("Blutz Assistant").
// - Read-only guide: cannot see live user data and never performs actions.
// - Chat history lives only in memory for this page session; closing the panel
//   clears it, so reopening always starts a fresh conversation (no Firestore,
//   no localStorage).
// - Calls a secure serverless proxy (Vercel) that holds the Gemini API key and
//   the knowledge-base markdown server-side, so no secret ever reaches the browser.

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
      "Hi! I'm the **Blutz Assistant** 🤖 — ask me how anything on this site works (loans, subscriptions, BPS, chores, etc). I can't see your personal balance or perform any actions, just guide you."
    )
  );
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
    const response = await fetch(AI_CHAT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: conversation }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.reply) {
      throw new Error(data.error || "The assistant is unavailable right now.");
    }

    conversation.push({ role: "assistant", content: data.reply });
    setTypingIndicator(false);
    appendAssistantMessage(data.reply);
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
