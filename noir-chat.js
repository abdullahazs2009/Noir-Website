/* NOIR AI — real Gemini-powered conversational assistant.
   Injects the floating chat bubble + premium chat panel on every page.
   Talks to /api/chat (Vercel serverless, GEMINI_API_KEY on the server only). */
(function () {
  "use strict";

  var LS_KEY = "noirChatState.v1";
  var API_URL = "/api/chat";
  var MAX_STORED_CONVS = 20;
  var MAX_MSG_CHARS = 4000;

  var STARTERS = [
    "How much protein do I need for bulking?",
    "Explain progressive overload in simple words",
    "Build me a 4-day training split",
    "Can you help me learn JavaScript?",
    "Tell me a joke",
  ];

  var ICON = {
    cognition: "cognition",
    add: "add",
    history: "history",
    expand: "open_in_full",
    close: "close",
    send: "arrow_forward",
    stop: "stop",
    copy: "content_copy",
    copied: "check_small",
    regen: "refresh",
    trash: "delete",
    back: "arrow_back",
    bolt: "neurology",
  };

  // ---------- state ----------
  var state = loadState();
  var busy = false;
  var abortCtl = null;
  var panelOpen = false;
  var pageMode = document.documentElement.hasAttribute("data-noir-chat-page");
  var els = {};

  function loadState() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (raw) {
        var s = JSON.parse(raw);
        if (s && Array.isArray(s.conversations)) return s;
      }
    } catch (e) {}
    return { conversations: [], activeId: null };
  }
  function saveState() {
    try {
      state.conversations = state.conversations.slice(0, MAX_STORED_CONVS);
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch (e) {}
  }
  function activeConv() {
    var id = state.activeId;
    var c = null;
    for (var i = 0; i < state.conversations.length; i++) {
      if (state.conversations[i].id === id) { c = state.conversations[i]; break; }
    }
    return c;
  }
  function newConv() {
    var c = { id: "c" + Date.now() + Math.random().toString(36).slice(2, 7), title: "New conversation", createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
    state.conversations.unshift(c);
    state.activeId = c.id;
    saveState();
    return c;
  }

  // ---------- helpers ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtTime(ts) {
    var d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  function fmtDate(ts) {
    var d = new Date(ts);
    return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " · " + fmtTime(ts);
  }
  function iconBtn(icon, cls, label, action) {
    return '<button type="button" class="' + cls + '" aria-label="' + esc(label) + '" data-nc-act="' + action + '"><span class="material-symbols-outlined">' + icon + "</span></button>";
  }

  // ---------- markdown ----------
  function inlineMd(text) {
    var out = esc(text);
    out = out.replace(/`([^`\n]+)`/g, function (m, c) { return '<code class="inline">' + c + "</code>"; });
    out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, function (m, t, u) {
      return '<a href="' + u + '" target="_blank" rel="noopener noreferrer nofollow">' + t + "</a>";
    });
    out = out.replace(/(^|[^"'>=\w])(https?:\/\/[^\s<>"')\]]+)/g, function (m, p, u) {
      return p + '<a href="' + u + '" target="_blank" rel="noopener noreferrer nofollow">' + u + "</a>";
    });
    out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    out = out.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
    return out;
  }

  function mdToHtml(src) {
    if (!src) return "";
    var parts = String(src).split(/```/);
    var html = "";
    for (var i = 0; i < parts.length; i++) {
      if (i % 2 === 1) {
        var nl = parts[i].indexOf("\n");
        var lang = nl > -1 ? parts[i].slice(0, nl).trim().replace(/[^a-z0-9+#.-]/gi, "").slice(0, 20) : "";
        var code = nl > -1 ? parts[i].slice(nl + 1) : parts[i];
        if (code.endsWith("\n")) code = code.slice(0, -1);
        html +=
          '<div class="noir-code"><div class="noir-code-hd"><span>' + (esc(lang) || "code") +
          '</span><button type="button" class="noir-code-copy" data-nc-act="copycode"><span class="material-symbols-outlined">' +
          ICON.copy + "</span>Copy</button></div><pre><code>" + esc(code) + "</code></pre></div>";
      } else {
        html += mdBlocks(parts[i]);
      }
    }
    return html;
  }

  function mdBlocks(seg) {
    if (!seg.trim()) return "";
    var lines = seg.replace(/\r\n/g, "\n").split("\n");
    var html = "", para = [], list = null;
    function flushPara() { if (para.length) { html += "<p>" + inlineMd(para.join(" ")) + "</p>"; para = []; } }
    function flushList() { if (list) { html += "<" + list.tag + ">" + list.items.map(function (it) { return "<li>" + inlineMd(it) + "</li>"; }).join("") + "</" + list.tag + ">"; list = null; } }
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      var m;
      if (/^\s*$/.test(ln)) { flushPara(); flushList(); continue; }
      if (/^\s*(---+|\*\*\*+)\s*$/.test(ln)) { flushPara(); flushList(); html += "<hr>"; continue; }
      if ((m = ln.match(/^(#{1,4})\s+(.*)/))) { flushPara(); flushList(); html += "<h" + m[1].length + ">" + inlineMd(m[2]) + "</h" + m[1].length + ">"; continue; }
      if ((m = ln.match(/^\s*>\s?(.*)/))) { flushPara(); flushList(); html += "<blockquote>" + inlineMd(m[1]) + "</blockquote>"; continue; }
      if ((m = ln.match(/^\s*[-*\u2022]\s+(.*)/))) {
        flushPara();
        if (!list || list.tag !== "ul") { flushList(); list = { tag: "ul", items: [] }; }
        list.items.push(m[1]); continue;
      }
      if ((m = ln.match(/^\s*\d+[.)]\s+(.*)/))) {
        flushPara();
        if (!list || list.tag !== "ol") { flushList(); list = { tag: "ol", items: [] }; }
        list.items.push(m[1]); continue;
      }
      flushList();
      para.push(ln.trim());
    }
    flushPara(); flushList();
    return html;
  }

  // ---------- error UX ----------
  function friendlyError(code) {
    switch (code) {
      case "rate_limited": return "You are sending messages very quickly. Please wait about half a minute and try again.";
      case "ai_unavailable": return "NOIR AI is temporarily unavailable — the GEMINI_API_KEY environment variable is not set on this deployment. Add it in Vercel → Settings → Environment Variables and redeploy.";
      case "bad_key": return "The AI service rejected its API key. Check that GEMINI_API_KEY in Vercel matches the key from Google AI Studio.";
      case "network": case "stream_interrupted": return "The connection to NOIR AI dropped. Check your internet connection and try again.";
      case "bad_request": return "That message could not be processed. Please try rephrasing it.";
      case "no_backend": return "The AI backend is not running in this environment. Static previews cannot execute /api/chat — run the site with: python dev-server.py — or deploy it to Vercel with GEMINI_API_KEY set.";
      default: return "NOIR AI hit an unexpected problem generating that reply. Try again in a moment.";
    }
  }

  // ---------- DOM ----------
  function buildUI() {
    var host = document.createElement("div");
    host.innerHTML =
      (pageMode ? "" :
        '<button id="noirChatFab" class="hidden" aria-label="Open NOIR AI chat">' +
        '<span class="noir-fab-ping"></span>' +
        '<span class="material-symbols-outlined" style="font-size:26px">' + ICON.bolt + "</span></button>" +
        '<div id="noirChatBackdrop"></div>') +
      '<div id="noirChatPanel" role="dialog" aria-modal="true" aria-label="NOIR AI chat">' +
      historyDom() + headerDom() + '<div class="noir-body" id="noirChatBody"></div>' + composerDom() +
      "</div>";
    var mount = pageMode ? (document.getElementById("noirChatPage") || document.body) : document.body;
    while (host.firstChild) mount.appendChild(host.firstChild);

    els.panel = document.getElementById("noirChatPanel");
    els.backdrop = document.getElementById("noirChatBackdrop");
    els.fab = document.getElementById("noirChatFab");
    els.body = document.getElementById("noirChatBody");
    els.history = document.getElementById("noirChatHistory");
    els.input = document.getElementById("noirChatInput");
    els.send = document.getElementById("noirChatSend");

    if (!pageMode) {
      els.backdrop.addEventListener("click", closeAiModal);
      setTimeout(function () { els.fab.classList.remove("hidden"); }, 900);
      els.fab.addEventListener("click", openAiModal);
    }
    els.panel.addEventListener("click", onPanelClick);
    els.history.addEventListener("click", onHistoryClick);
    document.getElementById("noirChatForm").addEventListener("submit", function (e) {
      e.preventDefault();
      if (busy && abortCtl) abortCtl.abort();
      else submitFromInput();
    });
    els.input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitFromInput(); }
      autoGrow();
    });
    els.input.addEventListener("input", autoGrow);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && panelOpen) closeAiModal(); });
    window.addEventListener("storage", function (e) {
      if (e.key === LS_KEY && !busy) { state = loadState(); renderConversation(); }
    });

    if (pageMode) {
      els.panel.classList.add("open");
      panelOpen = true;
    }
    renderConversation();
  }

  function headerDom() {
    return (
      '<div class="noir-hd">' +
      '<div class="noir-hd-avatar"><span class="material-symbols-outlined" style="font-size:18px">' + ICON.cognition + '</span><span class="live"></span></div>' +
      '<div class="noir-hd-titles"><span class="noir-hd-title">NOIR AI</span><span class="noir-hd-sub">Powered by Google Gemini &middot; context-aware chat</span></div>' +
      iconBtn(ICON.history, "noir-hd-btn", "Chat history", "history") +
      iconBtn(ICON.add, "noir-hd-btn", "New conversation", "new") +
      (pageMode ? "" : '<a class="noir-hd-btn" href="ai.html" aria-label="Open full-screen chat" style="text-decoration:none"><span class="material-symbols-outlined">' + ICON.expand + "</span></a>") +
      (pageMode ? "" : iconBtn(ICON.close, "noir-hd-btn", "Close chat", "close")) +
      "</div>");
  }

  function historyDom() {
    return (
      '<div class="noir-history" id="noirChatHistory">' +
      '<div class="noir-history-hd"><button type="button" class="noir-hd-btn" data-nc-act="closehistory" aria-label="Back to chat"><span class="material-symbols-outlined">' + ICON.back + "</span></button>" +
      '<span class="t" style="margin-left:8px">Chat History</span>' +
      '<button type="button" class="noir-history-clear" data-nc-act="clearall">Clear all</button></div>' +
      '<div class="noir-history-list" id="noirHistoryList"></div></div>');
  }

  function composerDom() {
    return (
      '<div class="noir-cc"><form class="noir-form" id="noirChatForm">' +
      '<textarea class="noir-input" id="noirChatInput" rows="1" maxlength="' + MAX_MSG_CHARS + '" placeholder="Ask NOIR AI anything..." aria-label="Message"></textarea>' +
      '<button type="submit" class="noir-send" id="noirChatSend" aria-label="Send message"><span class="material-symbols-outlined" style="font-size:18px">' + ICON.send + "</span></button>" +
      "</form>" +
      '<div class="noir-cc-note">NOIR AI runs on Google Gemini &middot; conversations are saved only in this browser</div></div>');
  }

  function autoGrow() {
    var el = els.input;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 130) + "px";
  }

  // ---------- open / close ----------
  function openAiModal() {
    if (pageMode) { location.href = "index.html#ai-chat"; return; }
    panelOpen = true;
    els.backdrop.classList.add("open");
    els.panel.classList.add("open");
    setTimeout(function () { els.input && els.input.focus(); }, 320);
  }
  function closeAiModal() {
    if (pageMode) return;
    panelOpen = false;
    els.backdrop.classList.remove("open");
    els.panel.classList.remove("open");
    els.history.classList.remove("open");
  }
  function openAiWithQuery(q) {
    openAiModal();
    setTimeout(function () { sendMessage(String(q)); }, 340);
  }
  window.openAiModal = openAiModal;
  window.closeAiModal = closeAiModal;
  window.openAiWithQuery = openAiWithQuery;
  window.sendQuickPrompt = openAiWithQuery;
  window.toggleVoiceMock = function (e) { if (e && e.preventDefault) e.preventDefault(); openAiModal(); };

  // ---------- rendering ----------
  function stickBottom(force) {
    var b = els.body;
    if (force || b.scrollHeight - b.scrollTop - b.clientHeight < 90) {
      b.scrollTop = b.scrollHeight;
    }
  }

  function renderConversation() {
    var conv = activeConv();
    els.body.innerHTML = "";
    if (!conv || !conv.messages.length) { renderGreet(); renderHistoryList(); return; }
    for (var i = 0; i < conv.messages.length; i++) renderMessage(conv.messages[i], i, conv.messages.length);
    renderHistoryList();
    stickBottom(true);
  }

  function renderGreet() {
    var g = document.createElement("div");
    g.className = "noir-greet";
    g.innerHTML = '<div class="g">NOIR AI</div><div class="s">Real Gemini-powered assistant. Training, nutrition, code, math, science &mdash; or just a chat. Ask anything, follow-ups included.</div>';
    els.body.appendChild(g);
    var s = document.createElement("div");
    s.className = "noir-starters";
    STARTERS.forEach(function (t) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "noir-starter"; b.textContent = t;
      b.addEventListener("click", function () { sendMessage(t); });
      s.appendChild(b);
    });
    els.body.appendChild(s);
  }

  function renderMessage(msg, idx, total) {
    if (msg.role === "user") {
      var u = document.createElement("div");
      u.className = "noir-msg user";
      u.innerHTML = '<div class="bubble">' + esc(msg.content) + '</div><div class="noir-meta">' + fmtTime(msg.ts) + "</div>";
      els.body.appendChild(u);
      return u;
    }
    var a = document.createElement("div");
    a.className = "noir-msg ai";
    var isLast = idx === total - 1;
    a.innerHTML =
      '<div class="ai-avatar"><span class="material-symbols-outlined">' + ICON.cognition + "</span></div>" +
      '<div class="ai-stack"><div class="bubble"><div class="noir-md">' + mdToHtml(msg.content) + "</div></div>" +
      '<div class="noir-meta">' + fmtTime(msg.ts) + '<span class="noir-acts">' +
      '<button type="button" class="noir-act" data-nc-act="copy" aria-label="Copy response"><span class="material-symbols-outlined">' + ICON.copy + "</span></button>" +
      '<button type="button" class="noir-act" data-nc-act="regen"' + (isLast ? "" : " disabled") + ' aria-label="Regenerate response"><span class="material-symbols-outlined">' + ICON.regen + "</span></button>" +
      "</span></div></div>";
    a._msg = msg;
    els.body.appendChild(a);
    return a;
  }

  function appendStreamingBubble() {
    var a = document.createElement("div");
    a.className = "noir-msg ai";
    a.innerHTML =
      '<div class="ai-avatar"><span class="material-symbols-outlined">' + ICON.cognition + "</span></div>" +
      '<div class="ai-stack"><div class="bubble"><div class="noir-typing"><i></i><i></i><i></i></div></div></div>';
    els.body.appendChild(a);
    stickBottom(true);
    return a;
  }

  function showStreamText(node, text, streaming) {
    var stack = node.querySelector(".ai-stack");
    stack.innerHTML =
      '<div class="bubble"><div class="noir-md' + (streaming ? " noir-caret" : "") + '">' + mdToHtml(text) + "</div></div>";
    stickBottom();
  }

  function finishStreamBubble(node, msg) {
    var stack = node.querySelector(".ai-stack");
    stack.innerHTML =
      '<div class="bubble"><div class="noir-md">' + mdToHtml(msg.content) + '</div></div><div class="noir-meta">' + fmtTime(msg.ts) +
      '<span class="noir-acts">' +
      '<button type="button" class="noir-act" data-nc-act="copy" aria-label="Copy response"><span class="material-symbols-outlined">' + ICON.copy + "</span></button>" +
      '<button type="button" class="noir-act" data-nc-act="regen" aria-label="Regenerate response"><span class="material-symbols-outlined">' + ICON.regen + "</span></button>" +
      "</span></div>";
    node._msg = msg;
  }

  function showError(code) {
    var a = document.createElement("div");
    a.className = "noir-msg ai error";
    a.innerHTML =
      '<div class="ai-avatar"><span class="material-symbols-outlined">' + ICON.cognition + "</span></div>" +
      '<div class="ai-stack"><div class="bubble">' + esc(friendlyError(code)) +
      '<br><button type="button" class="noir-retry" data-nc-act="retry">Try again</button></div></div>';
    els.body.appendChild(a);
    stickBottom(true);
  }

  // ---------- sending ----------
  function setBusy(on) {
    busy = on;
    els.input.disabled = on;
    els.send.classList.toggle("stop", on);
    els.send.setAttribute("aria-label", on ? "Stop generating" : "Send message");
    els.send.querySelector("span").textContent = on ? ICON.stop : ICON.send;
    if (on) els.input.blur(); else els.input.focus();
  }

  function submitFromInput() {
    var v = (els.input.value || "").trim();
    if (!v || busy) return;
    els.input.value = "";
    autoGrow();
    sendMessage(v);
  }

  function sendMessage(text) {
    text = String(text || "").trim().slice(0, MAX_MSG_CHARS);
    if (!text || busy) return;

    var conv = activeConv() || newConv();
    if (conv.title === "New conversation") {
      conv.title = text.length > 42 ? text.slice(0, 42) + "…" : text;
    }
    var msg = { role: "user", content: text, ts: Date.now() };
    conv.messages.push(msg);
    conv.updatedAt = Date.now();
    saveState();

    var g = els.body.querySelector(".noir-greet");
    if (g) g.remove();
    var st = els.body.querySelector(".noir-starters");
    if (st) st.remove();
    renderMessage(msg);
    request(conv.messages.slice());
  }

  function request(history) {
    var node = appendStreamingBubble();
    setBusy(true);
    abortCtl = new AbortController();

    var textBuf = "", dirty = false, lastPaint = 0;
    function paint() {
      var now = Date.now();
      if (!dirty) return;
      if (now - lastPaint < 55) return;
      dirty = false; lastPaint = now;
      if (textBuf) {
        var tp = node.querySelector(".noir-typing");
        if (tp) node.querySelector(".ai-stack").innerHTML = "";
        showStreamText(node, textBuf, true);
      }
    }

    fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history }),
      signal: abortCtl.signal,
    })
      .then(function (res) {
        if (!res.ok) {
          return res.json().catch(function () { return {}; }).then(function (j) {
            throw { ui: true, code: mapStatus(res.status, j && j.error) };
          });
        }
        var reader = res.body.getReader();
        var decoder = new TextDecoder();
        var sseBuf = "";
        var done = false;
        function pump() {
          return reader.read().then(function (r) {
            if (r.done) { done = true; return; }
            sseBuf += decoder.decode(r.value, { stream: true });
            var idx;
            while ((idx = sseBuf.indexOf("\n\n")) > -1) {
              var frame = sseBuf.slice(0, idx).trim();
              sseBuf = sseBuf.slice(idx + 2);
              if (frame.indexOf("data: ") === 0) {
                var payload = frame.slice(6);
                if (payload === "[DONE]") continue;
                try {
                  var obj = JSON.parse(payload);
                  if (obj.t) { textBuf += obj.t; dirty = true; paint(); }
                  if (obj.e) { throw { ui: true, code: obj.e }; }
                } catch (err) { if (err && err.ui) throw err; }
              }
            }
            return pump();
          });
        }
        return pump().then(function () { if (!done) throw { ui: true, code: "stream_interrupted" }; });
      })
      .then(function () { commit(textBuf, node); })
      .catch(function (err) {
        if (err && err.name === "AbortError") {
          if (textBuf) commit(textBuf, node, true);
          else node.remove();
          return;
        }
        node.remove();
        showError(err && err.ui ? err.code : "network");
      })
      .finally(function () {
        setBusy(false);
        abortCtl = null;
      });
  }

  function commit(text, node, stopped) {
    var conv = activeConv();
    if (!conv) return;
    var msg = { role: "assistant", content: text + (stopped ? "\n\n_(generation stopped)_" : ""), ts: Date.now() };
    conv.messages.push(msg);
    conv.updatedAt = Date.now();
    saveState();
    finishStreamBubble(node, msg);
    stickBottom();
  }

  function mapStatus(status, code) {
    if (code === "rate_limited" || status === 429) return "rate_limited";
    if (status === 503) return "ai_unavailable";
    if (status === 400) return "bad_request";
    if (status === 401 || code === "bad_key") return "bad_key";
    if (status === 404 || status === 405 || status === 501) return "no_backend";
    return "ai_error";
  }

  function regenerate() {
    if (busy) return;
    var conv = activeConv();
    if (!conv || !conv.messages.length) return;
    if (conv.messages[conv.messages.length - 1].role === "assistant") {
      conv.messages.pop();
      saveState();
    }
    renderConversation();
    var last = conv.messages[conv.messages.length - 1];
    if (last && last.role === "user") request(conv.messages.slice());
  }

  // ---------- clicks ----------
  function onPanelClick(e) {
    var act = e.target.closest("[data-nc-act]");
    if (!act) return;
    var a = act.getAttribute("data-nc-act");
    if (a === "close") closeAiModal();
    else if (a === "new") { newConv(); renderConversation(); els.input.focus(); }
    else if (a === "history") { renderHistoryList(); els.history.classList.add("open"); }
    else if (a === "closehistory") els.history.classList.remove("open");
    else if (a === "clearall") {
      if (confirm("Delete all saved conversations from this browser?")) {
        state = { conversations: [], activeId: null };
        saveState();
        renderConversation();
      }
    }
    else if (a === "regen") regenerate();
    else if (a === "retry") { var mm = activeConv() && activeConv().messages; if (mm && mm.length) request(mm.slice()); }
    else if (a === "copy") {
      var m = act.closest(".noir-msg")._msg;
      if (m) copyText(m.content, act);
    } else if (a === "copycode") {
      var pre = act.closest(".noir-code").querySelector("code");
      copyText(pre.textContent, act);
    }
  }

  function onHistoryClick(e) {
    var item = e.target.closest("[data-conv]");
    if (!item) return;
    var del = e.target.closest(".hi-del");
    var id = item.getAttribute("data-conv");
    if (del) {
      state.conversations = state.conversations.filter(function (c) { return c.id !== id; });
      if (state.activeId === id) state.activeId = state.conversations.length ? state.conversations[0].id : null;
      saveState();
      renderConversation();
      return;
    }
    if (busy) return;
    state.activeId = id;
    saveState();
    els.history.classList.remove("open");
    renderConversation();
  }

  function renderHistoryList() {
    var list = document.getElementById("noirHistoryList");
    if (!list) return;
    if (!state.conversations.length) {
      list.innerHTML = '<div class="noir-history-empty">No saved conversations yet.<br>Chats are stored in this browser only.</div>';
      return;
    }
    list.innerHTML = state.conversations
      .map(function (c) {
        return (
          '<div class="noir-history-item' + (c.id === state.activeId ? " active" : "") + '" data-conv="' + c.id + '" role="button" tabindex="0">' +
          '<div class="hi-main"><div class="hi-title">' + esc(c.title) + '</div><div class="hi-date">' + fmtDate(c.updatedAt) + " · " + c.messages.length + " messages</div></div>" +
          '<button type="button" class="hi-del" aria-label="Delete conversation"><span class="material-symbols-outlined" style="font-size:17px">' + ICON.trash + "</span></button></div>");
      })
      .join("");
  }

  function copyText(text, btn) {
    function ok() {
      var span = btn.querySelector(".material-symbols-outlined");
      if (!span) return;
      var old = span.textContent;
      span.textContent = ICON.copied;
      setTimeout(function () { span.textContent = old; }, 1400);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok).catch(function () { fallbackCopy(text); ok(); });
    } else { fallbackCopy(text); ok(); }
  }
  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    ta.remove();
  }

  // ---------- wizard bridge (index.html "AI terminal") ----------
  window.noirWizardSubmit = function () {
    var input = document.getElementById("neuralInput");
    if (input && input.value.trim()) {
      var q = input.value.trim();
      input.value = "";
      openAiWithQuery(q);
    }
  };

  // ---------- boot ----------
  if (!state.activeId && state.conversations.length) state.activeId = state.conversations[0].id;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", buildUI);
  else buildUI();
})();
