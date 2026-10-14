// NOIR AI — Gemini streaming endpoint (Vercel Node.js serverless function)
// Reads GEMINI_API_KEY from Vercel Environment Variables. Never ships the key to the browser.
import { GoogleGenAI } from "@google/genai";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  // Health check: open /api/chat in a browser to verify the function is live.
  if (req.method === "GET" || req.method === "HEAD") {
    res.status(200).json({
      status: "ok",
      service: "noir-ai",
      keyConfigured: Boolean(process.env.GEMINI_API_KEY),
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "ai_unavailable" });
    return;
  }

  if (!checkRateLimit(req)) {
    res.setHeader("Retry-After", "30");
    res.status(429).json({ error: "rate_limited" });
    return;
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    res.status(400).json({ error: "bad_request" });
    return;
  }

  const messages = sanitizeMessages(body && body.messages);
  if (!messages || messages.length === 0) {
    res.status(400).json({ error: "bad_request" });
    return;
  }

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  const ai = new GoogleGenAI({ apiKey });
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  let stream;
  try {
    stream = await ai.models.generateContentStream({
      model,
      contents,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.7,
        maxOutputTokens: 4096,
      },
    });
  } catch (err) {
    sendFailure(res, err);
    return;
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let emitted = false;
  try {
    for await (const chunk of stream) {
      const text = typeof chunk.text === "function" ? chunk.text() : chunk.text;
      if (text) {
        emitted = true;
        res.write(`data: ${JSON.stringify({ t: text })}\n\n`);
      }
    }
    if (!emitted) {
      res.write(`data: ${JSON.stringify({ t: "I could not generate a reply for that message. Please try rephrasing." })}\n\n`);
    }
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err) {
    console.error("NOIR AI stream error:", err && err.message);
    if (!res.headersSent) {
      sendFailure(res, err);
    } else {
      res.write(`data: ${JSON.stringify({ e: "stream_interrupted" })}\n\n`);
      res.end();
    }
  }
}

const SYSTEM_PROMPT = `You are NOIR AI, an advanced general-purpose conversational assistant integrated into the NOIR ATHLETICS website.

You are powered by Google's Gemini AI technology.

You are friendly, intelligent, knowledgeable, professional and natural.

Although your website focuses on fitness, you can help users with almost any subject, including programming, mathematics, English, grammar, science, education, technology, business and everyday questions.

Never reject a question simply because it is unrelated to fitness.

Understand informal language, slang, spelling mistakes, incomplete sentences and follow-up questions.

Use previous conversation messages to understand follow-up questions and remember details the user shared (like weight or goals).

Adapt your responses to the user's needs. Give short answers to simple questions and detailed, structured explanations when requested or for complicated topics.

Explain difficult subjects in simple language when asked.

For calculations, provide accurate results and show steps when helpful.

For programming questions, provide working examples and explain code clearly.

For fitness and nutrition, provide evidence-informed, age-appropriate guidance and avoid unsafe recommendations.

Be truthful about uncertainty and limitations. Do not invent information or pretend to have internet access or live data when you do not. Never claim to have completed an action unless you actually have.

When a question is unclear, ask a relevant clarification instead of refusing.

Follow appropriate safety boundaries while remaining helpful.

Your goal is a smooth, intelligent and natural conversational experience comparable to modern AI assistants.

Format replies in Markdown (headings, bold, lists, code blocks) so the website can render them nicely.`;

// ---- helpers -------------------------------------------------------------

function sanitizeMessages(raw) {
  if (!Array.isArray(raw)) return null;
  const allowed = [];
  for (const m of raw) {
    if (!m || typeof m.content !== "string") continue;
    if (m.role !== "user" && m.role !== "assistant") continue;
    const content = m.content.trim().slice(0, 8000);
    if (content) allowed.push({ role: m.role, content });
  }
  while (allowed.length && allowed[allowed.length - 1].role === "assistant") allowed.pop();
  const recent = allowed.slice(-30);
  let total = 0;
  while (recent.length && (total += recent[0].content.length) > 24000) recent.shift();
  return recent;
}

// Best-effort limiter: per IP, 12 requests / 60s. (Cold starts reset it; add Vercel WAF for hard protection.)
const hits = new Map();
function checkRateLimit(req) {
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
  const now = Date.now();
  const windowStart = now - 60_000;
  const list = (hits.get(ip) || []).filter((t) => t > windowStart);
  if (list.length >= 12) {
    hits.set(ip, list);
    return false;
  }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (!v.some((t) => t > windowStart)) hits.delete(k);
    }
  }
  return true;
}

function sendFailure(res, err) {
  const status = Number(err && (err.status || err.response?.status)) || 0;
  const text = String(err && (err.message || err));
  let code = "ai_error";
  if (status === 429 || /429|RESOURCE_EXHAUSTED|rate/i.test(text)) code = "rate_limited";
  else if (/API_KEY|api key|permission|PERMISSION_DENIED|401|403/i.test(text)) code = "bad_key";
  else if (/timeout|DEADLINE|ETIMEDOUT|network|fetch failed|ENOTFOUND|ECONNRESET/i.test(text)) code = "network";
  console.error("NOIR AI backend failure:", status, text);
  res.status(code === "rate_limited" ? 429 : 502).json({ error: code });
}
