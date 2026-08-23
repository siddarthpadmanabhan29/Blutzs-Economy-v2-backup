// api/aiChat.js
// Secure proxy: frontend sends only the conversation, this function attaches the
// server-only knowledge/instructions file and calls Google AI Studio (Gemini) with the
// API key kept server-side (never exposed to the browser).

import { readFileSync } from "fs";
import { join } from "path";

const MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const MAX_MESSAGES = 20; // cap conversation length sent per request
const MAX_MESSAGE_LENGTH = 2000; // cap characters per message

let cachedGuide = null;
function loadGuide() {
  if (cachedGuide) return cachedGuide;
  cachedGuide = readFileSync(join(process.cwd(), "ai-assistant-guide.md"), "utf8");
  return cachedGuide;
}

export default async function handler(req, res) {
  // ---- CORS HEADERS -----
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { messages } = req.body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages array is required" });
    }

    const trimmed = messages.slice(-MAX_MESSAGES);
    const contents = [];
    for (const msg of trimmed) {
      const role = msg?.role === "assistant" ? "model" : "user";
      const text = String(msg?.content ?? "").slice(0, MAX_MESSAGE_LENGTH).trim();
      if (!text) continue;
      contents.push({ role, parts: [{ text }] });
    }

    if (contents.length === 0) {
      return res.status(400).json({ error: "No valid messages provided" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "AI service is not configured" });
    }

    const guide = loadGuide();

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: guide }] },
          contents,
          generationConfig: { temperature: 0.4, maxOutputTokens: 800 },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini API error:", response.status, errText);
      return res.status(502).json({ error: "AI service request failed" });
    }

    const data = await response.json();
    const reply = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";

    if (!reply) {
      return res.status(502).json({ error: "AI returned an empty response" });
    }

    return res.status(200).json({ reply });
  } catch (error) {
    console.error("aiChat handler error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
