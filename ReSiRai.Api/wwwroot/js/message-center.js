// ReSiRai — مرکز پیام.
// کاربران فقط با «مدیریت» گفتگو می‌کنند؛ مدیر همهٔ گفتگوها را می‌بیند و
// به هر کاربر پاسخ می‌دهد. کپی و پاسخ به هر پیام، خوانده‌نشده، جستجو و
// به‌روزرسانیِ خودکار هم در همین ماژول است.
(() => {
  "use strict";

  const API = "/api/messages";
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const state = {
    isAdmin: false,
    me: 0,
    conversations: [],
    active: null,
    thread: [],
    title: "",
    replyTo: null,
    sending: false,
    timer: null,
    badgeTimer: null,
    lastThreadVersion: "",
    contactTimer: null
  };

  async function api(path, options) {
    const res = await fetch(API + path, { cache: "no-store", ...(options || {}) });
    let data = {};
    try { data = await res.json(); } catch { /* empty */ }
    if (!res.ok || data.success === false) {
      throw new Error(data.message || "درخواست انجام نشد.");
    }
    return data;
  }

  function toast(text, type) {
    if (typeof window.showToast === "function") window.showToast(text, type || "success");
  }

  function faTime(value) {
    const d = new Date(value);
    if (isNaN(d.getTime())) return "";
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString("fa-IR");
  }

  function faDateTime(value) {
    const d = new Date(value);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString("fa-IR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  function short(text, max) {
    const s = String(text || "");
    return s.length > max ? s.slice(0, max) + "…" : s;
  }

  // ---------------------------------------------------------------- layout
  function ensureSection() {
    if ($("messagesSection")) return $("messagesSection");
    const host = document.querySelector(".page-container");
    if (!host) return null;

    const section = document.createElement("section");
    section.id = "messagesSection";
    section.className = "card shell-page hidden";
    section.innerHTML = `
      <div class="section-header msg-page-head">
        <div><h2>مرکز پیام</h2><p id="msgPageHint">گفتگو با مدیریت رسیرای</p></div>
        <div class="msg-head-actions"><button id="msgRefreshButton" type="button" class="secondary-button">به‌روزرسانی</button></div>
      </div>
      <div class="msg-layout">
        <aside class="msg-sidebar">
          <div class="msg-side-head"><strong>گفتگوها</strong><span id="msgConvCount" class="msg-count">۰</span></div>
          <div id="msgAdminSearchWrap" class="msg-admin-search hidden">
            <input id="msgContactSearch" type="search" autocomplete="off" placeholder="جستجوی نام یا کد ملی برای گفتگوی جدید…" />
            <div id="msgContactResults" class="msg-contact-results hidden"></div>
          </div>
          <div id="msgConvList" class="msg-conv-list"></div>
        </aside>
        <section class="msg-main">
          <div id="msgEmpty" class="msg-empty">
            <div class="msg-empty-icon">✉️</div>
            <strong>گفتگویی انتخاب نشده است</strong>
            <span id="msgEmptyHint">از فهرست کنار یک گفتگو را انتخاب کنید.</span>
          </div>
          <div id="msgThreadWrap" class="msg-thread-wrap hidden">
            <header class="msg-thread-head">
              <strong id="msgThreadTitle">—</strong>
              <span id="msgThreadRole" class="msg-role"></span>
            </header>
            <div id="msgThread" class="msg-thread"></div>
            <form id="msgCompose" class="msg-compose" autocomplete="off">
              <div id="msgReplyBar" class="msg-reply-bar hidden"></div>
              <div class="msg-compose-row">
                <textarea id="msgInput" maxlength="2000" rows="2" placeholder="پیام خود را بنویسید…"></textarea>
                <button type="submit" id="msgSendButton">ارسال</button>
              </div>
              <small class="msg-compose-hint">Enter برای ارسال · Shift+Enter برای خطِ تازه</small>
            </form>
          </div>
        </section>
      </div>`;
    host.appendChild(section);

    $("msgRefreshButton").addEventListener("click", () => refreshAll(true));
    $("msgCompose").addEventListener("submit", (e) => { e.preventDefault(); send(); });
    $("msgInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    });
    $("msgThread").addEventListener("click", onThreadClick);
    $("msgContactSearch").addEventListener("input", onContactSearch);
    $("msgContactResults").addEventListener("click", onContactPick);
    document.addEventListener("click", (e) => {
      if (!e.target.closest("#msgAdminSearchWrap")) $("msgContactResults")?.classList.add("hidden");
    });
    return section;
  }

  // ---------------------------------------------------------------- threads
  async function loadThreads(options) {
    const silent = options && options.silent;
    const list = $("msgConvList");
    if (!silent && list && !state.conversations.length) {
      list.replaceChildren(el("div", "msg-side-loading", "در حال دریافت گفتگوها…"));
    }
    const data = await api("/threads");
    state.isAdmin = !!data.isAdmin;
    state.me = Number(data.me) || 0;
    state.conversations = data.conversations || [];
    setUnread(Number(data.unread) || 0);

    const section = $("messagesSection");
    if (section) section.classList.toggle("is-user", !state.isAdmin);
    $("msgAdminSearchWrap")?.classList.toggle("hidden", !state.isAdmin);
    $("msgPageHint").textContent = state.isAdmin
      ? "گفتگو با کاربران — فقط مدیریت می‌تواند پاسخ دهد"
      : "گفتگو با مدیریت رسیرای";
    $("msgEmptyHint").textContent = state.isAdmin
      ? "از فهرست یک گفتگو را انتخاب کنید یا کاربر تازه‌ای را جستجو کنید."
      : "پیام خود را برای مدیریت بنویسید.";
    renderConversations();
  }

  function renderConversations() {
    const list = $("msgConvList");
    if (!list) return;
    list.replaceChildren();
    $("msgConvCount").textContent = state.conversations.length.toLocaleString("fa-IR");

    if (!state.isAdmin) return; // کاربر عادی فهرست ندارد؛ مستقیم گفتگو را می‌بیند

    if (!state.conversations.length) {
      list.appendChild(el("div", "msg-empty", "هنوز گفتگویی نیست. با جستجوی بالا یک کاربر را پیدا کنید."));
      return;
    }

    state.conversations.forEach((c) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "msg-conv" + (state.active === Number(c.userID) ? " is-active" : "");
      const head = el("div", "msg-conv-head");
      const who = el("strong", null, c.label || "کاربر");
      const when = el("span", "msg-conv-when", faTime(c.lastDate));
      head.append(who, when);
      const meta = el("div", "msg-conv-meta");
      const role = el("span", "msg-role", c.roleLabel || "");
      meta.appendChild(role);
      const snippet = el("span", "msg-conv-snippet", short(c.lastMessage, 48));
      meta.appendChild(snippet);
      item.append(head, meta);
      if (Number(c.unread) > 0) {
        item.appendChild(el("span", "msg-unread", Number(c.unread).toLocaleString("fa-IR")));
      }
      item.addEventListener("click", () => openThread(Number(c.userID)));
      list.appendChild(item);
    });
  }

  async function openThread(userID) {
    const section = $("messagesSection");
    if (!section) return;
    state.active = Number(userID);
    state.replyTo = null;
    renderReplyBar();
    $("msgEmpty").classList.add("hidden");
    $("msgThreadWrap").classList.remove("hidden");
    renderConversations();
    await loadThread(false);
  }

  async function loadThread(silent) {
    if (state.active === null) return;
    const q = state.isAdmin ? `?withUserID=${encodeURIComponent(state.active)}` : "";
    let data;
    try {
      data = await api("/thread" + q);
    } catch (e) {
      if (!silent) toast(e.message || "گفتگو دریافت نشد.", "error");
      return;
    }
    state.isAdmin = !!data.isAdmin;
    state.me = Number(data.me) || 0;
    state.title = data.title || (state.isAdmin ? "گفتگو" : "مدیریت رسیرای");
    state.thread = data.messages || [];
    const version = state.thread.length
      ? `${state.thread.length}:${state.thread[state.thread.length - 1].messageID}`
      : "0";
    if (!silent || version !== state.lastThreadVersion) {
      state.lastThreadVersion = version;
      renderThread();
    }
    $("msgThreadTitle").textContent = state.title;
    $("msgThreadRole").textContent = data.roleLabel || (state.isAdmin ? "کاربر" : "مدیریت");
    await refreshBadge();
  }

  function renderThread() {
    const box = $("msgThread");
    if (!box) return;
    const wasAtBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 72;
    box.replaceChildren();
    if (!state.thread.length) {
      box.appendChild(el("div", "msg-thread-empty", "هنوز پیامی در این گفتگو نیست. اولین پیام را بنویسید."));
      return;
    }
    state.thread.forEach((m) => {
      const row = el("div", "msg-row " + (m.mine ? "mine" : "theirs"));
      const bubble = el("div", "msg-bubble");
      const head = el("div", "msg-bubble-head");
      head.appendChild(el("span", "msg-who", m.mine ? "شما" : (m.senderLabel || "مدیریت رسیرای")));
      head.appendChild(el("span", "msg-time", faTime(m.createdDate)));
      bubble.appendChild(head);

      if (m.replyTo) {
        const quote = el("div", "msg-quote");
        quote.appendChild(el("strong", null, m.replyTo.senderLabel || ""));
        quote.appendChild(el("span", null, m.replyTo.body || ""));
        bubble.appendChild(quote);
      }

      bubble.appendChild(el("div", "msg-text", m.body || ""));

      const foot = el("div", "msg-bubble-foot");
      const actions = el("div", "msg-actions");
      const copy = el("button", "msg-act", "کپی");
      copy.type = "button";
      copy.dataset.copy = m.body || "";
      const reply = el("button", "msg-act", "پاسخ");
      reply.type = "button";
      reply.dataset.reply = String(m.messageID);
      reply.dataset.sender = m.senderLabel || "";
      reply.dataset.body = m.body || "";
      actions.append(copy, reply);
      foot.appendChild(actions);
      if (m.mine) {
        const seen = el("span", "msg-seen", m.read ? "✓✓" : "✓");
        seen.title = m.read ? "خوانده شد" : "ارسال شد";
        foot.appendChild(seen);
      }
      bubble.appendChild(foot);
      row.appendChild(bubble);
      box.appendChild(row);
    });
    if (wasAtBottom) box.scrollTop = box.scrollHeight;
  }

  // ---------------------------------------------------------------- compose
  async function send() {
    if (state.sending || state.active === null) return;
    const input = $("msgInput");
    const text = (input.value || "").trim();
    if (!text) { toast("متن پیام را بنویسید.", "error"); input.focus(); return; }

    const button = $("msgSendButton");
    state.sending = true;
    button.disabled = true;
    button.textContent = "در حال ارسال…";
    try {
      const body = {
        toUserID: state.isAdmin ? state.active : null,
        body: text,
        replyToMessageID: state.replyTo ? state.replyTo.id : null
      };
      await api("", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      input.value = "";
      state.replyTo = null;
      renderReplyBar();
      await loadThread(false);
      await loadThreads({ silent: true });
      boxToBottom();
      input.focus();
    } catch (e) {
      toast(e.message || "ارسال پیام انجام نشد.", "error");
    } finally {
      state.sending = false;
      button.disabled = false;
      button.textContent = "ارسال";
    }
  }

  function boxToBottom() {
    const box = $("msgThread");
    if (box) box.scrollTop = box.scrollHeight;
  }

  function onThreadClick(e) {
    const copy = e.target.closest("[data-copy]");
    if (copy) { copyText(copy.dataset.copy || ""); return; }
    const reply = e.target.closest("[data-reply]");
    if (reply) {
      state.replyTo = {
        id: Number(reply.dataset.reply),
        sender: reply.dataset.sender || "",
        body: reply.dataset.body || ""
      };
      renderReplyBar();
      $("msgInput")?.focus();
    }
  }

  function renderReplyBar() {
    const bar = $("msgReplyBar");
    if (!bar) return;
    bar.replaceChildren();
    if (!state.replyTo) { bar.classList.add("hidden"); return; }
    bar.classList.remove("hidden");
    const body = el("div", "msg-reply-body");
    body.appendChild(el("strong", null, "پاسخ به " + (state.replyTo.sender || "پیام")));
    body.appendChild(el("div", "msg-reply-text", short(state.replyTo.body, 120)));
    const cancel = el("button", "msg-reply-cancel", "×");
    cancel.type = "button";
    cancel.title = "لغو پاسخ";
    cancel.addEventListener("click", () => { state.replyTo = null; renderReplyBar(); });
    bar.append(body, cancel);
  }

  function copyText(text) {
    const fallback = () => {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); toast("کپی شد ✓"); }
      catch { toast("کپی ممکن نشد.", "error"); }
      ta.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => toast("کپی شد ✓")).catch(fallback);
    } else fallback();
  }

  // ---------------------------------------------------------------- contacts
  function onContactSearch() {
    clearTimeout(state.contactTimer);
    const term = ($("msgContactSearch").value || "").trim();
    const box = $("msgContactResults");
    if (term.length < 2) { box.classList.add("hidden"); box.replaceChildren(); return; }
    state.contactTimer = setTimeout(() => searchContacts(term), 250);
  }

  async function searchContacts(term) {
    const box = $("msgContactResults");
    if (!box) return;
    box.classList.remove("hidden");
    box.replaceChildren(el("div", "msg-contact-loading", "در حال جستجو…"));
    try {
      const data = await api("/contacts?search=" + encodeURIComponent(term));
      box.replaceChildren();
      const contacts = data.contacts || [];
      if (!contacts.length) {
        box.appendChild(el("div", "msg-contact-empty", "کاربری با این مشخصات پیدا نشد."));
        return;
      }
      contacts.forEach((c) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "msg-contact";
        btn.dataset.userId = String(c.userID);
        btn.appendChild(el("strong", null, c.label));
        btn.appendChild(el("small", null, `${c.roleLabel}${c.nationalCode ? " · " + c.nationalCode : ""}`));
        box.appendChild(btn);
      });
    } catch (e) {
      box.replaceChildren(el("div", "msg-contact-empty", e.message || "جستجو انجام نشد."));
    }
  }

  function onContactPick(e) {
    const btn = e.target.closest(".msg-contact");
    if (!btn) return;
    const id = Number(btn.dataset.userId);
    $("msgContactResults").classList.add("hidden");
    $("msgContactSearch").value = "";
    if (id > 0) openThread(id);
  }

  // ---------------------------------------------------------------- unread / refresh
  function setUnread(count) {
    const badge = $("messagesUnreadBadge");
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count > 99 ? "۹۹+" : count.toLocaleString("fa-IR");
      badge.classList.remove("hidden");
    } else {
      badge.textContent = "";
      badge.classList.add("hidden");
    }
  }

  async function refreshBadge() {
    try {
      const data = await api("/unread");
      setUnread(Number(data.unread) || 0);
    } catch { /* مهمان/قطعِ شبکه */ }
  }

  async function refreshAll(showToast) {
    try {
      await loadThreads({});
      if (state.active !== null) await loadThread(false);
      await refreshBadge();
      if (showToast) toast("به‌روز شد.");
    } catch (e) { if (showToast) toast(e.message || "به‌روزرسانی انجام نشد.", "error"); }
  }

  function startPolling() {
    if (state.timer) return;
    state.timer = setInterval(async () => {
      const section = $("messagesSection");
      if (!section || section.classList.contains("hidden") || document.hidden || state.sending) return;
      const input = $("msgInput");
      if (input && input.value.trim()) return; // وسطِ تایپ مزاحم نشو
      try {
        await loadThreads({ silent: true });
        if (state.active !== null) await loadThread(true);
        await refreshBadge();
      } catch { /* بعدی */ }
    }, 15000);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshAll(false);
    });
  }

  function startBadgePolling() {
    if (state.badgeTimer) return;
    state.badgeTimer = setInterval(refreshBadge, 30000);
    refreshBadge();
  }

  async function open() {
    const section = ensureSection();
    if (!section) return;
    section.classList.remove("hidden");
    window.scrollTo(0, 0);
    startPolling();
    await refreshAll(false);
    if (!state.isAdmin) await openThread(0);
    else if (state.active !== null) await openThread(state.active);
  }

  window.addEventListener("resirai-auth-changed", (e) => {
    if (e.detail) { startBadgePolling(); refreshBadge(); }
  });
  if (window.reSiRaiCurrentUser) startBadgePolling();

  ensureSection();
  window.ReSiRaiMessages = { open, refreshBadge };
})();
