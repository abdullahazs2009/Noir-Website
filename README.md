# NOIR ATHLETICS — NOIR AI (real Gemini assistant)

The chatbot is now a **real, streaming Google Gemini conversational AI** — general-purpose, context-aware, not keyword-based. Home, About, Contact, navigation and design are unchanged apart from the chatbot replacement.

## Files

- `api/chat.js` — Vercel serverless function (official `@google/genai` SDK, streaming, NOIR AI system prompt, validation, per-IP rate limit). Open `yoursite.vercel.app/api/chat` in a browser to see a health check: `{"status":"ok","keyConfigured":true,...}`.
- `noir-chat.js` / `noir-chat.css` — floating bubble on every page + premium chat panel: streaming markdown, code blocks with copy, copy/regenerate/stop, conversation history, starters, timestamps, browser persistence.
- `ai.html` — full-screen chat page (shares the same history).
- `dev-server.py` — local test server: **real Gemini** when `GEMINI_API_KEY` is set, clearly-labelled mock stream when it is not.

Your API key is only read server-side from `GEMINI_API_KEY`. It never appears in frontend code or requests.

## Why you saw "connection to NOIR AI dropped"

Your GitHub repo (`Noir-Website`) contains only the static HTML site — **there is no `/api/chat` function deployed**, so the browser's request hits a dead end (404/501). Static previews (including Qoder's) cannot run Vercel serverless functions. The fix is included here: push these files and add the env var. The chat now also reports this exact cause instead of a generic network error.

## 1. Get a Gemini API key (2 min)

1. Open **https://aistudio.google.com/apikey**, sign in with Google.
2. **Create API key** → copy it (`AIza...`). Keep it secret.

## 2. Deploy to Vercel

1. Copy this whole folder into your GitHub repo `Noir-Website` (replace the old files) and push.
2. On vercel.com open your project → **Settings → Environment Variables → Add**:
   - Name: `GEMINI_API_KEY` — Value: your key — apply to Production, Preview, Development.
   - Optional: `GEMINI_MODEL` (default `gemini-2.5-flash`).
3. **Deployments → Redeploy** (so the function picks up the key).
4. Verify: open `https://YOUR-SITE.vercel.app/api/chat` — you should see `"keyConfigured": true`.

## 3. Test locally

```
cd NOIR_Fitness_Website
set GEMINI_API_KEY=AIza...      (CMD)   |   $env:GEMINI_API_KEY="AIza..."  (PowerShell)
python dev-server.py
```

Open http://localhost:8000. Without the key the bot shows a *Mock mode* notice — with it, every reply is real Gemini.

## 4. Mandatory real-world test (run on the deployed site)

1. "Hello, how are you?"
2. "I'm 60 kg and eat 60g of protein. Is that enough for muscle growth?"
3. "What if I increase it to 100g?"
4. "Explain that in simple English."
5. "Who invented Python?"
6. "Write a simple Python calculator."
7. "What is 25 × 48?"
8. "Correct my grammar: He don't likes going gym."
9. "Tell me a funny joke."
10. "What was my weight earlier?" → must recall **60 kg** (proves real context).

Also test failures: unset key → "temporarily unavailable… add GEMINI_API_KEY"; quota exhausted → friendly rate-limit message; backend down → clear diagnostic with Try again.

## 5. Security & reliability

- Validation (roles, lengths), history trimmed to ~30 messages / 24k chars server-side.
- 12 req/min per IP on the endpoint; UI blocks duplicate sends and offers stop/regenerate.
- No fake AI answers are ever substituted for failed Gemini requests.

## 6. Limitations (honest)

- Chat memory is **this browser only** (localStorage). Cross-device memory needs accounts + a database.
- Rate limiting is per-function-instance (best effort); add Vercel WAF for hard protection.
- No live web data unless you enable Gemini Search grounding.
- No model can guarantee zero hallucinations; the system prompt requires admitting uncertainty.
