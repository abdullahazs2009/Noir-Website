# NOIR AI local dev server — serves the static site AND provides /api/chat.
# If GEMINI_API_KEY is set in your environment, it proxies to the REAL Gemini API
# (same behaviour as api/chat.js on Vercel). Otherwise it streams a clearly-labelled
# mock reply so you can test the chat UI without a key.
#
# Usage:  python dev-server.py            (http://localhost:8000)
#         set GEMINI_API_KEY=AIza... first for real answers (CMD),
#         or in PowerShell: $env:GEMINI_API_KEY="AIza..."
import json, os, re, sys, time, urllib.request
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

KEY = os.environ.get("GEMINI_API_KEY", "")
MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{m}:streamGenerateContent?alt=sse&key={k}".format

SYSTEM_PROMPT = open(os.path.join(os.path.dirname(__file__), "api", "chat.js"), encoding="utf-8").read()
SYSTEM_PROMPT = re.search(r"const SYSTEM_PROMPT = `([\s\S]*?)`;", SYSTEM_PROMPT).group(1)

class Handler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args): pass

    def do_GET(self):
        if self.path == "/api/chat":
            self._json(200, {"status": "ok", "service": "noir-ai", "keyConfigured": bool(KEY), "model": MODEL})
            return
        return SimpleHTTPRequestHandler.do_GET(self)

    def _sse(self, payload):
        self.wfile.write(f"data: {json.dumps(payload, ensure_ascii=False)}\n\n".encode())
        self.wfile.flush()

    def _json(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if self.path != "/api/chat":
            self.send_error(404); return
        n = int(self.headers.get("Content-Length", 0))
        try:
            body = json.loads(self.rfile.read(n))
        except Exception:
            self._json(400, {"error": "bad_request"}); return
        msgs = [m for m in body.get("messages", []) if isinstance(m, dict) and m.get("role") in ("user", "assistant") and m.get("content")]
        if not msgs:
            self._json(400, {"error": "bad_request"}); return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            if KEY:
                self._real(msgs)
            else:
                self._mock(msgs)
        except Exception as e:
            print("stream error:", e)

    def _real(self, msgs):
        payload = json.dumps({
            "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
            "contents": [{"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]} for m in msgs],
            "generationConfig": {"temperature": 0.7, "maxOutputTokens": 4096},
        }).encode()
        req = urllib.request.Request(GEMINI_URL(m=MODEL, k=KEY), data=payload, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=120) as resp:
            for line in resp:
                line = line.decode().strip()
                if not line.startswith("data: "): continue
                obj = json.loads(line[6:])
                for cand in obj.get("candidates", []):
                    for part in cand.get("content", {}).get("parts", []):
                        if part.get("text"): self._sse({"t": part["text"]})
        self.wfile.write(b"data: [DONE]\n\n"); self.wfile.flush()

    def _mock(self, msgs):
        text = ("**Mock mode** — GEMINI_API_KEY is not set, so this reply comes from the local dev server, not Gemini.\n\n"
                "Set the key and restart this script for real answers: `set GEMINI_API_KEY=AIza...` then `python dev-server.py`.")
        words = text.split(" ")
        for i, w in enumerate(words):
            self._sse({"t": w + (" " if i < len(words) - 1 else "")})
            time.sleep(0.012)
        self.wfile.write(b"data: [DONE]\n\n"); self.wfile.flush()

if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"NOIR dev server: http://localhost:{port}  ({'REAL Gemini mode' if KEY else 'MOCK mode - set GEMINI_API_KEY for real answers'})")
    srv.serve_forever()
