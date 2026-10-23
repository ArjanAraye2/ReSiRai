// ReSiRai - the SMS inbox screen.
//
// Three jobs: pair a phone (QR), show what arrived, and let the secretary
// confirm the matches the matcher was not sure about. Everything the matcher
// decided stays visible - who it thinks the patient is and why - because a
// picture attached to the wrong record is worse than a message left waiting.
(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  let currentFilter = "0";       // pending by default - the work list
  let selectedPatient = null;    // chosen in the pairing dialog

  const METHOD = {
    1: "با لینک داخل پیام",
    2: "با کد ملی",
    3: "با شمارهٔ فرستنده",
    4: "با نام و خانواده",
    0: "انتخاب دستی"
  };
  const STATE = { 0: "در انتظار تأیید", 1: "متصل شد", 2: "رد شد" };

  // ------------------------------------------------------------
  // Styles, sidebar entry, section shell
  // ------------------------------------------------------------
  function addStyles() {
    if ($("inboxUiStyles")) return;
    const style = document.createElement("style");
    style.id = "inboxUiStyles";
    style.textContent = `
      .inbox-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
      .inbox-filters{display:flex;gap:6px;flex-wrap:wrap}
      .inbox-filter{border:1px solid #c3dae1;background:#fff;color:#0f5165;border-radius:999px;padding:6px 14px;font-size:12.5px;min-height:34px;cursor:pointer}
      .inbox-filter.active{background:#0e7f95;border-color:#0e7f95;color:#fff}
      .inbox-card{border:1px solid #d8e7ec;border-radius:14px;background:#fff;padding:14px 16px;margin-bottom:12px}
      .inbox-card.inbox-pending{border-color:#f0c36d;background:#fffdf6}
      .inbox-meta{display:flex;gap:10px;flex-wrap:wrap;color:#55707e;font-size:12px;margin-bottom:6px}
      .inbox-body{font-size:14px;color:#0d3f4f;white-space:pre-wrap;overflow-wrap:anywhere;margin:6px 0}
      .inbox-verdict{display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:12.5px;margin:8px 0}
      .inbox-chip{border-radius:999px;padding:3px 10px;background:#eef6f9;color:#0f5165;border:1px solid #d8e7ec}
      .inbox-chip.ok{background:#e8f7f0;color:#0e7d55;border-color:#bfe7d7}
      .inbox-chip.wait{background:#fff4e0;color:#a06400;border-color:#f4ddae}
      .inbox-note{color:#55707e;font-size:12.5px}
      .inbox-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
      .inbox-pick{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}
      .inbox-pick input{flex:1;min-width:190px}
      .inbox-results{display:grid;gap:6px;margin-top:8px}
      .inbox-result{text-align:right;border:1px solid #d8e7ec;background:#f8fcfd;border-radius:10px;padding:8px 12px;cursor:pointer;font-size:13px;min-height:40px}
      .inbox-result:hover{border-color:#0e7f95}
      .inbox-links{font-size:12px;color:#0e7f95;overflow-wrap:anywhere;direction:ltr;text-align:left}
      .inbox-empty{color:#55707e;font-size:13.5px;padding:22px 6px;text-align:center}
      .pair-qr{display:flex;flex-direction:column;align-items:center;gap:10px;margin:14px 0}
      .pair-qr svg{width:190px;height:190px;border:1px solid #d8e7ec;border-radius:14px;padding:10px;background:#fff}
      .pair-install-hidden{display:none !important}
      .confirm-dialog{position:relative}
      .dialog-close-x{position:absolute;top:8px;left:10px;width:34px;height:34px;border:1px solid #d8e7ec;background:#fff;color:#55707e;border-radius:50%;font-size:20px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:3}
      .dialog-close-x:hover{background:#fdecea;color:#b42318;border-color:#f3c2c0}
      .pair-dialog{width:min(940px,calc(100vw - 32px));text-align:right}
      .pair-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:12px;align-items:start}
      .pair-grid .guide-box--full{grid-column:1 / -1}
      .guide-box{border:1px solid #d8e7ec;border-radius:12px;background:#f8fcfd;padding:12px 14px;text-align:right}
      .guide-box-title{font-weight:700;color:#0f5165;font-size:14px;margin-bottom:8px}
      .guide-steps{margin:4px 0 0;padding-inline-start:20px;color:#4a6b7d;font-size:12.5px;line-height:2.1}
      .guide-steps li{margin-bottom:5px}
      .guide-steps b{color:#0d3f4f;background:#eef6f9;border-radius:4px;padding:1px 5px;font-weight:700;direction:ltr;display:inline-block}
      .guide-box-title-toggle{cursor:pointer;user-select:none}
      .guide-caret{color:#0e7f95;font-weight:700}
      .pair-dialog .pair-qr{margin:8px 0}
      .pair-dialog .pair-qr svg{width:150px;height:150px;padding:8px}
      @media (max-width:860px){.pair-dialog{width:calc(100vw - 24px)}.pair-grid{grid-template-columns:1fr}}
      .pair-hint{color:#55707e;font-size:13px;line-height:2;text-align:center}
      .pair-payload{direction:ltr;text-align:left;font-family:Consolas,monospace;font-size:11.5px;background:#0a3540;color:#d9eff4;padding:8px 10px;border-radius:8px;overflow-wrap:anywhere}
      .inbox-devices{display:grid;gap:8px;margin-top:10px}
      .inbox-device{display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between;border:1px solid #d8e7ec;border-radius:12px;padding:10px 12px;font-size:13px;background:#fbfefe}
      .inbox-device.off{opacity:.6}
    `;
    document.head.appendChild(style);
  }

  function ensureSidebar() {
    // صفحهٔ مستقلِ «پیامک‌های ورودی» فعلاً در منو نمایش داده نمی‌شود؛
    // کارهای دریافت تصویر داخلِ همان مراجعه انجام می‌شوند (QR/پیست/فوروارد).
    // کدِ صندوق و جفت‌سازی برای آینده می‌ماند.
    return;
  }

  function ensureSection() {
    if ($("inboxSection")) return;
    const main = document.querySelector(".page-container");
    if (!main) return;
    const section = document.createElement("section");
    section.id = "inboxSection";
    section.className = "card hidden shell-page";
    section.innerHTML = `
      <div class="section-header">
        <div>
          <h2>پیامک‌های ورودی</h2>
          <p>پیامک‌های رادیولوژی که از گوشی‌های جفت‌شده می‌آید، با بیمار تطبیق داده می‌شود</p>
        </div>
        <button id="inboxPairButton" type="button">جفت‌سازی گوشی</button>
      </div>

      <div class="inbox-toolbar">
        <div class="inbox-filters">
          <button class="inbox-filter" data-status="0" type="button">در انتظار تأیید</button>
          <button class="inbox-filter" data-status="1" type="button">متصل شده</button>
          <button class="inbox-filter" data-status="2" type="button">رد شده</button>
          <button class="inbox-filter" data-status="" type="button">همه</button>
        </div>
        <button id="inboxRefreshButton" type="button" class="secondary-button">تازه‌سازی</button>
      </div>

      <div id="inboxDevices" class="inbox-devices"></div>

      <div id="inboxList"><div class="inbox-empty">در حال دریافت…</div></div>`;
    main.appendChild(section);
  }

  // ------------------------------------------------------------
  // Paired phones
  // ------------------------------------------------------------
  async function loadDevices() {
    const root = $("inboxDevices");
    if (!root) return;
    try {
      const res = await fetch("/api/pairing");
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "فهرست گوشی‌ها دریافت نشد.");
      root.replaceChildren();
      if (!data.items.length) {
        root.innerHTML = '<div class="inbox-empty">هنوز گوشی‌ای جفت نشده است. برای شروع «جفت‌سازی گوشی» را بزنید.</div>';
        return;
      }
      data.items.forEach(device => {
        const row = document.createElement("div");
        row.className = "inbox-device" + (device.isActive ? "" : " off");
        const info = document.createElement("div");
        info.innerHTML = `<strong>${device.label}</strong>
          <div class="inbox-meta"><span>${device.ownerKind === 2 ? "گوشی بیمار" : "موبایل مطب"}</span>
          <span>آخرین گزارش: ${device.lastSeenDate ? new Date(device.lastSeenDate).toLocaleString("fa-IR") : "—"}</span></div>`;
        row.appendChild(info);
        if (device.isActive) {
          const off = document.createElement("button");
          off.type = "button"; off.className = "secondary-button"; off.textContent = "قطع دسترسی";
          off.onclick = async () => {
            const res = await fetch(`/api/pairing/${device.deviceID}`, { method: "DELETE" });
            if (res.ok) { window.showToast?.("دسترسی گوشی قطع شد."); loadDevices(); }
          };
          row.appendChild(off);
        } else {
          const tag = document.createElement("span");
          tag.className = "inbox-chip"; tag.textContent = "غیرفعال";
          row.appendChild(tag);
        }
        root.appendChild(row);
      });
    } catch (e) {
      root.innerHTML = `<div class="inbox-empty">${e.message || "فهرست گوشی‌ها دریافت نشد."}</div>`;
    }
  }

  // ------------------------------------------------------------
  // The list of received messages
  // ------------------------------------------------------------
  async function loadMessages() {
    const root = $("inboxList");
    if (!root) return;
    root.innerHTML = '<div class="inbox-empty">در حال دریافت…</div>';
    try {
      const query = currentFilter ? `?status=${currentFilter}` : "";
      const res = await fetch(`/api/inbox${query}`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "فهرست پیامک‌ها دریافت نشد.");
      root.replaceChildren();
      if (!data.items.length) {
        root.innerHTML = '<div class="inbox-empty">پیامکی با این وضعیت نیست.</div>';
        return;
      }
      data.items.forEach(item => root.appendChild(renderMessage(item)));
    } catch (e) {
      root.innerHTML = `<div class="inbox-empty">${e.message || "فهرست پیامک‌ها دریافت نشد."}</div>`;
    }
  }

  function renderMessage(item) {
    const card = document.createElement("div");
    card.className = "inbox-card" + (item.status === 0 ? " inbox-pending" : "");

    const meta = document.createElement("div");
    meta.className = "inbox-meta";
    meta.innerHTML = `<span>${item.senderMobile || "فرستنده ناشناس"}</span>
      <span>${new Date(item.receivedDate).toLocaleString("fa-IR")}</span>
      <span>${(item.links || "").split("\n").filter(Boolean).length} لینک</span>`;
    card.appendChild(meta);

    const body = document.createElement("div");
    body.className = "inbox-body";
    body.textContent = item.body;
    card.appendChild(body);

    const verdict = document.createElement("div");
    verdict.className = "inbox-verdict";
    const patientChip = document.createElement("span");
    patientChip.className = "inbox-chip " + (item.patientID ? "ok" : "wait");
    patientChip.textContent = item.patientID
      ? `بیمار: ${item.patientName || ("#" + item.patientID)}`
      : "بیمار مشخص نشده";
    verdict.appendChild(patientChip);

    if (item.matchMethod) {
      const how = document.createElement("span");
      how.className = "inbox-chip";
      how.textContent = METHOD[item.matchMethod] || "روش نامشخص";
      verdict.appendChild(how);
    }

    const state = document.createElement("span");
    state.className = "inbox-chip " + (item.status === 1 ? "ok" : item.status === 0 ? "wait" : "");
    state.textContent = STATE[item.status] || "";
    verdict.appendChild(state);
    card.appendChild(verdict);

    if (item.note) {
      const note = document.createElement("div");
      note.className = "inbox-note";
      note.textContent = item.note;
      card.appendChild(note);
    }
    if (item.importedCount > 0) {
      const count = document.createElement("div");
      count.className = "inbox-note";
      count.textContent = `${item.importedCount} تصویر وارد پرونده شد.`;
      card.appendChild(count);
    }
    if (item.links) {
      const links = document.createElement("div");
      links.className = "inbox-links";
      links.textContent = item.links.split("\n").filter(Boolean).join("\n");
      card.appendChild(links);
    }

    if (item.status === 0) card.appendChild(pendingActions(item));
    return card;
  }

  // The secretary picks the patient: search, choose, confirm. Nothing is
  // attached before that click.
  function pendingActions(item) {
    const wrap = document.createElement("div");
    wrap.className = "inbox-pick";

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "نام یا کد ملی بیمار را بنویسید…";
    const results = document.createElement("div");
    results.className = "inbox-results";

    let timer = null, chosen = null;

    const confirmButton = document.createElement("button");
    confirmButton.type = "button";
    confirmButton.textContent = "تأیید و دریافت تصاویر";
    confirmButton.disabled = true;

    const rejectButton = document.createElement("button");
    rejectButton.type = "button";
    rejectButton.className = "secondary-button";
    rejectButton.textContent = "رد";

    input.addEventListener("input", () => {
      chosen = null;
      confirmButton.disabled = true;
      results.replaceChildren();
      clearTimeout(timer);
      const term = input.value.trim();
      if (term.length < 2) return;
      timer = setTimeout(async () => {
        try {
          const res = await fetch(`/api/patients?search=${encodeURIComponent(term)}&includeInactive=false`);
          const data = await res.json();
          const patients = data.patients || data || [];
          results.replaceChildren();
          patients.slice(0, 5).forEach(p => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "inbox-result";
            btn.textContent = `${p.firstName || ""} ${p.lastName || ""} — ${p.nationalCode || ""}`;
            btn.onclick = () => {
              chosen = p;
              input.value = `${p.firstName || ""} ${p.lastName || ""}`.trim();
              results.replaceChildren();
              confirmButton.disabled = false;
            };
            results.appendChild(btn);
          });
        } catch { /* the empty list already says enough */ }
      }, 250);
    });

    confirmButton.onclick = async () => {
      if (!chosen) return;
      confirmButton.disabled = true;
      confirmButton.textContent = "در حال دریافت…";
      try {
        const res = await fetch(`/api/inbox/${item.messageID}/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ patientID: chosen.patientID })
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || "تأیید انجام نشد.");
        window.showToast?.(data.message || "پیامک به پروندهٔ بیمار متصل شد.");
        loadMessages();
      } catch (e) {
        window.showToast?.(e.message || "تأیید انجام نشد.", "error");
        confirmButton.disabled = false;
        confirmButton.textContent = "تأیید و دریافت تصاویر";
      }
    };

    rejectButton.onclick = async () => {
      const res = await fetch(`/api/inbox/${item.messageID}/reject`, { method: "POST" });
      if (res.ok) { window.showToast?.("پیامک رد شد."); loadMessages(); }
    };

    const inner = document.createElement("div");
    inner.style.display = "contents";
    inner.append(input, confirmButton, rejectButton);
    wrap.appendChild(inner);
    wrap.appendChild(results);
    return wrap;
  }

  // ------------------------------------------------------------
  // راهنمای دقیق آماده‌سازی گوشی، به‌تفکیک برند.
  // نام منوها دقیقاً همان چیزی است که روی گوشی (با زبان انگلیسی) دیده می‌شود.
  // ------------------------------------------------------------
  const PHONE_GUIDES = {
    xiaomi: [
      "<b>Settings</b> ← <b>About phone</b> (اگر نبود: <b>About phone</b> ← <b>All specs</b>)",
      "روی <b>MIUI version</b> — در گوشی‌های جدید <b>HyperOS version</b> — <b>۷ بار</b> پشت‌سرهم بزنید تا پیام <b>You are now a developer!</b> بیاید",
      "<b>Settings</b> ← <b>Additional settings</b> ← <b>Developer options</b><br>(در بعضی مدل‌ها: <b>Settings</b> ← <b>System</b> ← <b>Developer options</b>)",
      "<b>USB debugging</b> را روشن کنید و در پنجرهٔ <b>Allow USB debugging?</b> بزنید <b>Allow</b>",
      "در بعضی مدل‌ها لازم است <b>Install via USB</b> و <b>USB debugging (Security settings)</b> هم روشن شوند (همان‌جا داخل <b>Developer options</b>)",
      "کابل را وصل کنید؛ اعلان <b>Charging this device via USB</b> را از بالا بکشید پایین و <b>File Transfer / MTP</b> را انتخاب کنید",
      "برای اینکه برنامه در پس‌زمینه بسته نشود: <b>Settings</b> ← <b>Apps</b> ← <b>Manage apps</b> ← <b>ReSiRai</b> ← <b>Autostart</b> را روشن کنید و <b>Battery saver</b> را روی <b>No restrictions</b> بگذارید",
      "اگر نصب انجام نشد: <b>Developer options</b> ← <b>MIUI optimization</b> را خاموش کنید و دوباره تلاش کنید"
    ],
    samsung: [
      "<b>Settings</b> ← <b>About phone</b> ← <b>Software information</b>",
      "روی <b>Build number</b> <b>۷ بار</b> پشت‌سرهم بزنید تا <b>You are now a developer!</b> بیاید",
      "<b>Settings</b> ← <b>Developer options</b> (انتهای لیست اصلی تنظیمات)",
      "<b>USB debugging</b> را روشن کنید و <b>OK</b> را بزنید",
      "در صورت نیاز: <b>Default USB configuration</b> ← <b>File transfer</b> یا <b>MTP</b>",
      "کابل را وصل کنید و در اعلان، حالت را روی <b>File Transfer / MTP</b> بگذارید"
    ],
    huawei: [
      "<b>Settings</b> ← <b>About phone</b>؛ روی <b>Build number</b> (یا <b>Version</b>) <b>۷ بار</b> بزنید تا <b>You are now a developer!</b> ظاهر شود",
      "<b>Settings</b> ← <b>System & updates</b> ← <b>Developer options</b><br>(در بعضی مدل‌ها: <b>Settings</b> ← <b>Developer options</b>)",
      "<b>USB debugging</b> را روشن کنید و <b>OK</b> را بزنید",
      "حتماً: <b>Settings</b> ← <b>Apps</b> ← <b>Special access</b> ← <b>Install via USB</b> ← فعال کنید؛ بدون این، نصب از کابل رد نمی‌شود",
      "کابل را وصل و در اعلان <b>Transfer files</b> یا <b>MTP</b> را انتخاب کنید"
    ],
    oppo: [
      "<b>Settings</b> ← <b>About phone</b>؛ روی <b>Version</b> یا <b>Build number</b> <b>۷ بار</b> بزنید تا <b>You are now a developer!</b> بیاید",
      "<b>Settings</b> ← <b>Additional settings</b> ← <b>Developer options</b>",
      "<b>USB debugging</b> را روشن کنید و <b>OK</b> را بزنید",
      "حتماً <b>Install via USB</b> (در بعضی مدل‌ها: <b>Security</b> ← <b>USB installation</b>) را فعال کنید",
      "کابل را وصل کنید و در اعلان، <b>Charging only</b> را به <b>File transfer / MTP</b> تغییر دهید"
    ],
    generic: [
      "<b>Settings</b> ← <b>About phone</b>",
      "روی <b>Build number</b> <b>۷ بار</b> پشت‌سرهم بزنید تا پیام <b>You are now a developer!</b> بیاید",
      "<b>Settings</b> ← <b>System</b> ← <b>Developer options</b><br>(در بعضی برندها <b>Developer options</b> مستقیم در لیست اصلی تنظیمات است)",
      "<b>USB debugging</b> را روشن کنید و <b>Allow</b> / <b>OK</b> را بزنید",
      "کابل را وصل کنید و در اعلان، حالت را روی <b>File Transfer</b> یا <b>MTP</b> بگذارید"
    ],
    iphone: [
      "<b>روی آیفون نصب برنامه ممکن نیست</b> — دنتیکس فقط برای اندروید ساخته شده و اپل به نصب برنامه‌های خارج از فروشگاه خود اجازه نمی‌دهد.",
      "جایگزین ۱ (بدون نصب): از بخش <b>۲ — جفت‌سازی با کیوآرکد</b> استفاده کنید؛ بیمار با دوربین خودِ گوشی (بدون برنامهٔ اضافه) کیوآرکد را اسکن و پیامک را می‌چپاند.",
      "جایگزین ۲: بیمار پیامک رادیولوژیست را به <b>شمارهٔ مطب</b> <b>Forward</b> می‌کند و منشی از پروندهٔ همان Study آن را دریافت می‌کند.",
      "جایگزین ۳: لینک داخل پیامک را در مرورگر Safari باز کنید تا تصاویر دیده شود."
    ]
  };

  function renderPhoneGuide() {
    const select = $("guideBrand");
    const list = $("guideSteps");
    if (!select || !list) return;
    const steps = PHONE_GUIDES[select.value] || PHONE_GUIDES.generic;
    list.replaceChildren();
    steps.forEach(text => {
      const li = document.createElement("li");
      li.innerHTML = text;
      list.appendChild(li);
    });
  }

  // ------------------------------------------------------------
  // Pairing dialog (QR)
  // ------------------------------------------------------------
  function ensurePairDialog() {
    if ($("pairDialog")) return;
    const wrap = document.createElement("div");
    wrap.id = "pairDialog";
    wrap.className = "confirm-overlay hidden";
    wrap.innerHTML = `
      <div class="confirm-dialog pair-dialog">
        <button id="pairCloseX" type="button" class="dialog-close-x" title="بستن" aria-label="بستن">×</button>
        <h3>جفت‌سازی گوشی و نصب برنامه</h3>
        <p class="pair-hint">هر بخش جداگانه است: اول مشخصات گوشی، بعد جفت‌سازی، و در صورت نیاز نصب برنامه.</p>

        <div class="pair-grid">

          <section class="guide-box">
            <div class="guide-box-title">۱ — مشخصات گوشی</div>

            <div class="form-field">
              <label for="pairOwner">نوع گوشی</label>
              <select id="pairOwner">
                <option value="1">موبایل مطب</option>
                <option value="2">گوشی بیمار</option>
              </select>
            </div>

            <div id="pairPatientBox" class="form-field hidden">
              <label for="pairPatientSearch">بیمار</label>
              <input id="pairPatientSearch" type="text" placeholder="نام یا کد ملی بیمار…" />
              <div id="pairPatientResults" class="inbox-results"></div>
            </div>

            <div class="form-field">
              <label for="pairLabel">برچسب</label>
              <input id="pairLabel" type="text" placeholder="موبایل مطب" />
            </div>

            <div class="form-actions">
              <button id="pairCreateButton" type="button">ساخت کیوآرکد</button>
            </div>
          </section>

          <section class="guide-box">
            <div class="guide-box-title">۲ — جفت‌سازی با کیوآرکد</div>
            <p class="pair-hint">روی گوشی، با <b>دوربین معمولی</b> این کد را اسکن کنید تا خودش برنامهٔ ReSiRai باز شود و جفت‌سازی انجام شود؛ یا داخل برنامه از دکمهٔ «جفت‌سازی با ReSiRai» استفاده کنید.</p>
            <div id="pairResult" class="hidden">
              <div class="pair-qr" id="pairQr"></div>
              <div class="pair-payload" id="pairPayload"></div>
            </div>
          </section>

          <section class="guide-box" id="pairInstall">
            <div class="guide-box-title">۳ — دانلود برنامه برای گوشی</div>
            <p class="share-dialog-hint">
              این کیوآرکد را با گوشی اسکن کنید تا فایل نصب دانلود شود،
              سپس <span dir="ltr">Keep ← Open ← Install</span> را بزنید.
            </p>
            <div class="pair-qr" id="downloadQr"></div>
            <div class="pair-payload" id="downloadUrl"></div>
            <div class="form-actions">
              <button id="copyDownloadButton" type="button" class="secondary-button">کپی لینک دانلود</button>
            </div>
          </section>

          <!-- راهنمای آماده‌سازی گوشی، به تفکیک مدل -->
          <section class="guide-box" id="pairGuide">
            <div class="guide-box-title">۴ — آماده‌سازی گوشی برای نصب (به تفکیک مدل)</div>
            <div class="form-field">
              <label for="guideBrand">مدل گوشی</label>
              <select id="guideBrand">
                <option value="xiaomi">شیائومی / ردمی / پوکو (MIUI و HyperOS)</option>
                <option value="samsung">سامسونگ</option>
                <option value="huawei">هوآوی / آنر</option>
                <option value="oppo">اوپو / ویوو / ریلمی</option>
                <option value="generic">سایر گوشی‌های اندروید</option>
                <option value="iphone">آیفون (iPhone)</option>
              </select>
            </div>
            <ol id="guideSteps" class="guide-steps"></ol>
          </section>

          <section id="pairDirectInstall" class="guide-box guide-box--full">
            <div class="guide-box-title">۵ — نصب مستقیم از همین صفحه (کابل یا وای‌فای)</div>
            <p class="share-dialog-hint">
              کافی است گوشی یک‌بار با کابل وصل و «اشکال‌زدایی USB» روشن شده باشد؛ بعد از دکمه‌های زیر همان نصب را انجام می‌دهد.
            </p>
            <div id="installStatus" class="inbox-note">در حال بررسی…</div>
            <div id="installDevices" class="inbox-results"></div>
            <div class="form-actions">
              <button id="installRefresh" type="button" class="secondary-button">بررسی دستگاه‌ها</button>
              <button id="installRun" type="button">نصب برنامه روی گوشی انتخاب‌شده</button>
              <button id="installWireless" type="button" class="secondary-button">فعال‌سازی نصب بی‌سیم (وای‌فای)</button>
            </div>
            <div class="form-actions">
              <input id="installIp" type="text" placeholder="آدرس IP گوشی (مثلاً 192.168.1.50)" style="flex:1;min-width:180px;direction:ltr;text-align:left" />
              <button id="installConnect" type="button" class="secondary-button">اتصال بی‌سیم</button>
            </div>
            <div id="installResult" class="status-message"></div>
          </section>

        </div><!-- پایان بخش‌ها -->

        <div id="pairStatus" class="status-message"></div>

        <div class="form-actions">
          <button id="pairCloseButton" type="button" class="secondary-button">بستن</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    // بخش‌های مرجع (دانلود، راهنما، نصب مستقیم) جمع می‌مانند تا پنجره بدون
    // اسکرول جا شود؛ با کلیک روی عنوان هر بخش باز می‌شود.
    makeCollapsible($("pairInstall"));
    makeCollapsible($("pairGuide"));
    makeCollapsible($("pairDirectInstall"));

    wrap.addEventListener("click", e => { if (e.target === wrap) closePair(); });
    $("pairCloseButton").onclick = closePair;
    $("pairCloseX").onclick = closePair;
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && !$("pairDialog").classList.contains("hidden")) closePair();
    });
    $("pairOwner").onchange = () => {
      const isPatient = $("pairOwner").value === "2";
      $("pairPatientBox").classList.toggle("hidden", !isPatient);
      $("pairLabel").placeholder = isPatient ? "موبایل بیمار" : "موبایل مطب";
      if (!isPatient) selectedPatient = null;
    };
    $("copyDownloadButton").onclick = async () => {
      const url = $("downloadUrl").textContent;
      if (!url) return;
      try {
        await navigator.clipboard.writeText(url);
        $("copyDownloadButton").textContent = "کپی شد";
        setTimeout(() => { $("copyDownloadButton").textContent = "کپی لینک دانلود"; }, 1500);
      } catch { window.prompt("لینک دانلود را کپی کنید:", url); }
    };
    $("pairCreateButton").onclick = createPairing;
    $("pairPatientSearch").addEventListener("input", searchPatientForPairing);

    // راهنمای آماده‌سازی گوشی به‌تفکیک برند
    $("guideBrand").onchange = renderPhoneGuide;
    renderPhoneGuide();

    // نصب مستقیم روی گوشی (از داخل دنتیکس، با کابل یا وای‌فای)
    $("installRefresh").onclick = loadInstallStatus;
    $("installRun").onclick = runInstall;
    $("installWireless").onclick = enableWireless;
    $("installConnect").onclick = connectWireless;
  }

  let selectedSerial = null;

  /**
   * بخش‌های مرجع (دانلود، راهنمای مدل، نصب مستقیم) جمع می‌مانند تا پنجره
   * بدون اسکرول جا شود؛ با کلیک روی عنوان همان بخش باز و بسته می‌شوند.
   */
  function makeCollapsible(card) {
    if (!card || card.dataset.collapsible === "1") return;
    card.dataset.collapsible = "1";

    const title = card.querySelector(".guide-box-title");
    const body = [...card.children].filter(el => el !== title);
    body.forEach(el => el.classList.add("pair-install-hidden"));
    if (!title) return;

    title.classList.add("guide-box-title-toggle");
    const caret = document.createElement("span");
    caret.className = "guide-caret";
    caret.textContent = " ▾";
    title.appendChild(caret);

    title.onclick = () => {
      const isOpen = body.length > 0 && !body[0].classList.contains("pair-install-hidden");
      body.forEach(el => el.classList.toggle("pair-install-hidden", isOpen));
      caret.textContent = isOpen ? " ▾" : " ▴";
      if (!isOpen && card.id === "pairDirectInstall") loadInstallStatus();
      if (!isOpen && card.id === "pairGuide") renderPhoneGuide();
    };
  }

  async function loadInstallStatus() {
    const box = $("installStatus");
    const list = $("installDevices");
    if (!box || !list) return;
    box.classList.remove("error");
    box.textContent = "در حال بررسی…";
    list.replaceChildren();
    try {
      const res = await fetch("/api/install/status", { cache: "no-store" });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.message || "بررسی انجام نشد.");
      if (!d.adbFound) { box.textContent = "ابزار adb روی سرور پیدا نشد (MobileApp:AdbPath را تنظیم کنید)."; box.classList.add("error"); return; }
      if (!d.apkFound) { box.textContent = "فایل نصب پیدا نشد؛ ابتدا برنامهٔ اندروید را بسازید."; box.classList.add("error"); return; }

      box.textContent = `فایل آماده: ${d.apkName} (${Math.round((d.apkSize || 0) / 1048576)} مگابایت)`;
      if (!d.devices || !d.devices.length) {
        list.innerHTML = '<div class="inbox-empty">گوشی‌ای متصل نیست. کابل را وصل و «اشکال‌زدایی USB» را روشن کنید.</div>';
        return;
      }
      selectedSerial = d.devices[0].serial;
      d.devices.forEach((dev, index) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "inbox-result";
        btn.textContent = `${dev.model || dev.serial} — ${dev.serial} (${dev.state})`;
        btn.style.borderColor = index === 0 ? "#0E7F95" : "";
        btn.onclick = () => {
          selectedSerial = dev.serial;
          [...list.children].forEach(c => { c.style.borderColor = ""; });
          btn.style.borderColor = "#0E7F95";
        };
        list.appendChild(btn);
      });
    } catch (e) {
      box.textContent = e.message || "بررسی انجام نشد.";
      box.classList.add("error");
    }
  }

  async function runInstall() {
    const status = $("installResult");
    const button = $("installRun");
    status.classList.remove("error");
    status.textContent = "در حال نصب روی گوشی…";
    button.disabled = true;
    try {
      const res = await fetch("/api/install/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serial: selectedSerial })
      });
      const d = await res.json();
      status.textContent = d.message || d.output || "نتیجه‌ای گزارش نشد.";
      status.classList.toggle("error", !d.success);
      if (d.success) window.showToast?.(d.message || "نصب انجام شد.");
    } catch (e) {
      status.textContent = e.message || "نصب انجام نشد.";
      status.classList.add("error");
    } finally {
      button.disabled = false;
    }
  }

  async function enableWireless() {
    const status = $("installResult");
    const button = $("installWireless");
    status.classList.remove("error");
    status.textContent = "در حال فعال‌سازی اتصال بی‌سیم…";
    button.disabled = true;
    try {
      const res = await fetch("/api/install/wireless-enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serial: selectedSerial })
      });
      const d = await res.json();
      status.textContent = d.message || "انجام شد.";
      status.classList.toggle("error", !d.success);
      if (d.ip) $("installIp").value = d.ip;
    } catch (e) {
      status.textContent = e.message || "فعال‌سازی انجام نشد.";
      status.classList.add("error");
    } finally {
      button.disabled = false;
    }
  }

  async function connectWireless() {
    const status = $("installResult");
    const button = $("installConnect");
    const ip = $("installIp").value.trim();
    if (!ip) { status.textContent = "آدرس IP گوشی را وارد کنید."; status.classList.add("error"); return; }
    status.classList.remove("error");
    status.textContent = "در حال اتصال…";
    button.disabled = true;
    try {
      const res = await fetch("/api/install/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip })
      });
      const d = await res.json();
      status.textContent = d.message || d.output || "انجام شد.";
      status.classList.toggle("error", !d.success);
      if (d.success) { await loadInstallStatus(); const s = $("installStatus"); if (s) s.textContent += " — اتصال برقرار شد."; }
    } catch (e) {
      status.textContent = e.message || "اتصال برقرار نشد.";
      status.classList.add("error");
    } finally {
      button.disabled = false;
    }
  }

  let pairTimer = null;
  function searchPatientForPairing() {
    clearTimeout(pairTimer);
    const term = $("pairPatientSearch").value.trim();
    const box = $("pairPatientResults");
    box.replaceChildren();
    selectedPatient = null;
    if (term.length < 2) return;
    pairTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/patients?search=${encodeURIComponent(term)}&includeInactive=false`);
        const data = await res.json();
        const patients = data.patients || data || [];
        patients.slice(0, 5).forEach(p => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "inbox-result";
          btn.textContent = `${p.firstName || ""} ${p.lastName || ""} — ${p.nationalCode || ""}`;
          btn.onclick = () => {
            selectedPatient = p;
            $("pairPatientSearch").value = `${p.firstName || ""} ${p.lastName || ""}`.trim();
            box.replaceChildren();
          };
          box.appendChild(btn);
        });
      } catch { /* ignore */ }
    }, 250);
  }

  async function createPairing() {
    const ownerKind = Number($("pairOwner").value);
    if (ownerKind === 2 && !selectedPatient) {
      $("pairStatus").textContent = "ابتدا بیمار را از فهرست انتخاب کنید.";
      $("pairStatus").classList.add("error");
      return;
    }
    const status = $("pairStatus");
    status.classList.remove("error");
    status.textContent = "در حال ساخت کیوآرکد…";
    try {
      const res = await fetch("/api/pairing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: $("pairLabel").value,
          ownerKind,
          patientID: ownerKind === 2 ? selectedPatient.patientID : null
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "ساخت کیوآرکد انجام نشد.");

      const qrBox = $("pairQr");
      qrBox.replaceChildren();
      if (typeof qrcode === "function") {
        const code = qrcode(0, "M");
        code.addData(data.qr);
        code.make();
        qrBox.innerHTML = code.createSvgTag({ cellSize: 4, margin: 16, scalable: true, alt: "کیوآرکد جفت‌سازی گوشی" });
      }
      $("pairPayload").textContent = data.qr;
      $("pairResult").classList.remove("hidden");
      status.textContent = "کیوآرکد آماده است؛ آن را روی گوشی اسکن کنید.";

      // لینک دانلود برنامه، برای وقتی که هنوز روی گوشی نصب نشده
      if (data.downloadUrl) {
        $("downloadUrl").textContent = data.downloadUrl;
        const dl = $("downloadQr");
        dl.replaceChildren();
        if (typeof qrcode === "function") {
          const code = qrcode(0, "M");
          code.addData(data.downloadUrl);
          code.make();
          dl.innerHTML = code.createSvgTag({ cellSize: 4, margin: 16, scalable: true, alt: "کیوآرکد دانلود برنامه" });
        }
        $("pairInstall").classList.remove("hidden");
      }

      loadDevices();
    } catch (e) {
      status.textContent = e.message || "ساخت کیوآرکد انجام نشد.";
      status.classList.add("error");
    }
  }

  function closePair() {
    $("pairDialog")?.classList.add("hidden");
    $("pairResult")?.classList.add("hidden");
    $("pairQr")?.replaceChildren();
    $("pairStatus").textContent = "";
    selectedPatient = null;
    if ($("pairPatientSearch")) $("pairPatientSearch").value = "";
    if ($("pairLabel")) $("pairLabel").value = "";
    $("pairPatientResults")?.replaceChildren();
  }

  // ------------------------------------------------------------
  // دریافت تصویر از گوشی بیمار — بدون نصب برنامه روی گوشی بیمار
  // ------------------------------------------------------------
  function ensureReceiveButton() {
    const toolbar = document.querySelector("#patientDetailsSection .details-toolbar");
    if (!toolbar || $("receiveImagesButton")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "receiveImagesButton";
    btn.className = "secondary-button";
    btn.textContent = "دریافت تصویر برای این بیمار";
    btn.onclick = openReceiveDialog;
    toolbar.appendChild(btn);
  }

  function ensureReceiveDialog() {
    if ($("receiveDialog")) return;
    const wrap = document.createElement("div");
    wrap.id = "receiveDialog";
    wrap.className = "confirm-overlay hidden";
    wrap.innerHTML = `
      <div class="confirm-dialog">
        <h3>دریافت تصویر از گوشی بیمار</h3>
        <p class="share-dialog-hint">از بیمار بخواهید این کیوآرکد را با دوربین گوشی‌اش اسکن کند (نیازی به نصب برنامه نیست)،
        بعد متن پیامک رادیولوژی را در صفحه‌ای که باز می‌شود بچپاند. تصاویر خودکار به همین پرونده می‌آید.</p>

        <div class="pair-qr" id="receiveQr"></div>
        <div class="pair-payload" id="receiveUrl"></div>

        <div id="receiveHistory" class="inbox-note"></div>
        <div id="receiveStatus" class="status-message"></div>

        <div class="form-actions">
          <button id="receiveCopyButton" type="button" class="secondary-button">کپی لینک</button>
          <button id="receiveCloseButton" type="button" class="secondary-button">بستن</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener("click", e => { if (e.target === wrap) closeReceiveDialog(); });
    $("receiveCloseButton").onclick = closeReceiveDialog;
    $("receiveCopyButton").onclick = async () => {
      const url = $("receiveUrl").textContent;
      try {
        await navigator.clipboard.writeText(url);
        $("receiveCopyButton").textContent = "کپی شد";
        setTimeout(() => { $("receiveCopyButton").textContent = "کپی لینک"; }, 1500);
      } catch { window.prompt("لینک را کپی کنید:", url); }
    };
  }

  function closeReceiveDialog() {
    $("receiveDialog")?.classList.add("hidden");
    $("receiveQr")?.replaceChildren();
  }

  async function openReceiveDialog() {
    const patient = window.selectedPatient;
    if (!patient) { window.showToast?.("ابتدا پروندهٔ بیمار را باز کنید.", "error"); return; }
    ensureReceiveDialog();

    const status = $("receiveStatus");
    status.classList.remove("error");
    status.textContent = "در حال ساخت لینک…";
    $("receiveHistory").textContent = "";
    $("receiveQr").replaceChildren();
    $("receiveUrl").textContent = "";
    $("receiveDialog").classList.remove("hidden");

    try {
      const res = await fetch(`/api/patients/${patient.patientID}/receive-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiresInDays: 1 })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "ساخت لینک انجام نشد.");

      $("receiveUrl").textContent = data.url;
      if (typeof qrcode === "function") {
        const code = qrcode(0, "M");
        code.addData(data.url);
        code.make();
        $("receiveQr").innerHTML = code.createSvgTag({ cellSize: 4, margin: 16, scalable: true, alt: "کیوآرکد دریافت تصویر" });
      }
      status.textContent = "کیوآرکد آماده است؛ آن را به بیمار نشان دهید.";
      loadReceiveHistory(patient.patientID);
    } catch (e) {
      status.textContent = e.message || "ساخت لینک انجام نشد.";
      status.classList.add("error");
    }
  }

  async function loadReceiveHistory(patientID) {
    try {
      const res = await fetch(`/api/patients/${patientID}/receive-links`);
      const data = await res.json();
      if (!res.ok || !data.success || !data.items.length) return;
      const last = data.items[0];
      $("receiveHistory").textContent =
        `استفاده‌ها: ${last.useCount}  |  آخرین استفاده: ` +
        (last.lastUsedAt ? new Date(last.lastUsedAt).toLocaleString("fa-IR") : "هنوز");
    } catch { /* تاریخچه فرعی است */ }
  }

  // ------------------------------------------------------------
  // پیامک‌های دریافتیِ همین بیمار، داخل پروندهٔ بیمار (سناریوی ۲)
  // ------------------------------------------------------------
  function ensurePatientInbox() {
    const host = document.getElementById("patientDetailsSection");
    if (!host) return;
    if (!$("patientInboxCard")) {
      const card = document.createElement("div");
      card.id = "patientInboxCard";
      card.className = "inbox-card hidden";
      card.innerHTML =
        `<div class="section-header"><div><h3>پیامک‌های رادیولوژی دریافتی</h3>` +
        `<p>پیامک‌هایی که از گوشی مطب یا مرورگر بیمار برای این پرونده آمده است</p></div></div>` +
        `<div id="patientInboxList" class="inbox-note">—</div>`;
      host.appendChild(card);
    }
    refreshPatientInbox();
  }

  async function refreshPatientInbox() {
    const card = $("patientInboxCard");
    const list = $("patientInboxList");
    if (!card || !list) return;
    const patient = window.selectedPatient;
    const open = !!patient && !document.getElementById("patientDetailsSection").classList.contains("hidden");

    // فقط وقتی وضعیت واقعاً عوض شده دست می‌زنیم؛ وگرنه همین رفتار
    // (تغییر متن داخلِ بخشِ مشاهده‌شده) باعث حلقهٔ بی‌نهایت می‌شود.
    const shouldShow = !open && !card.classList.contains("hidden")
        || open && card.classList.contains("hidden");
    if (shouldShow) card.classList.toggle("hidden", !open);
    if (!open) return;

    const wanted = await loadPatientInboxText(patient.patientID);
    if (list.dataset.signature === wanted.signature) return;
    list.dataset.signature = wanted.signature;
    list.textContent = wanted.text;
  }

  async function loadPatientInboxText(patientID) {
    try {
      const res = await fetch("/api/inbox", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "دریافت ناموفق بود.");
      const mine = (data.items || []).filter(x => Number(x.patientID) === Number(patientID));
      if (!mine.length) return { signature: "empty", text: "هنوز پیامک دریافتی‌ای برای این بیمار نیست." };
      const lines = mine.slice(0, 6).map(item =>
        `${new Date(item.receivedDate).toLocaleString("fa-IR")} — ${STATE[item.status] || ""}` +
        (item.importedCount ? ` — ${item.importedCount} تصویر` : "") +
        (item.note ? ` — ${item.note}` : ""));
      return { signature: lines.join("|"), text: lines.join("\n") };
    } catch (e) {
      return { signature: "error", text: e.message || "دریافت ناموفق بود." };
    }
  }

  // ------------------------------------------------------------
  // Wiring
  // ------------------------------------------------------------
  function init() {
    addStyles();
    ensureSidebar();
    ensureSection();
    ensurePairDialog();
    ensureReceiveButton();

    document.querySelectorAll(".inbox-filter").forEach(button => {
      button.classList.toggle("active", button.dataset.status === currentFilter);
      button.addEventListener("click", () => {
        currentFilter = button.dataset.status;
        document.querySelectorAll(".inbox-filter").forEach(x => x.classList.toggle("active", x === button));
        loadMessages();
      });
    });
    $("inboxRefreshButton")?.addEventListener("click", () => { loadDevices(); loadMessages(); });
    $("inboxPairButton")?.addEventListener("click", () => {
      $("pairDialog").classList.remove("hidden");
      loadInstallStatus();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  // دکمهٔ دریافت تصویر و لیست پیامک‌های دریافتی داخل پروندهٔ بیمار ساخته می‌شوند؛
  // مهم است که تغییراتِ خودِ همان کارت دوبارهٔ خودش را تحریک نکند، وگرنه
  // صفحه وارد حلقه می‌شود (این باگ قبلاً دیده شد و دنتیکس را قفل کرد).
  const patientObserver = new MutationObserver(mutations => {
    const card = document.getElementById("patientInboxCard");
    if (card && mutations.every(m => card.contains(m.target) ||
        (m.type === "childList" && [...m.addedNodes, ...m.removedNodes].every(n => n === card || card.contains(n))))) {
      return;
    }
    ensureReceiveButton();
    ensurePatientInbox();
    clearTimeout(window.__resiraiInboxTimer);
    window.__resiraiInboxTimer = setTimeout(refreshPatientInbox, 700);
  });
  const patientHost = document.getElementById("patientDetailsSection");
  if (patientHost) {
    patientObserver.observe(patientHost, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  }
})();
