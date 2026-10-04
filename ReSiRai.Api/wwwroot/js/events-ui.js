// ============================================================
// ReSiRai - لاگِ رویدادهای سامانه (فقط مدیرِ سیستم)
// ============================================================
// ورود، پیامک، تحلیلِ AI، پشتیبان و شروعِ برنامه این‌جا دیده می‌شود تا وقتی
// مطبی گزارش داد «دیروز چه شد» بتوان یک نگاه جواب داد. فیلترها سمتِ سرور
// اعمال می‌شوند؛ رکوردها ۱۸۰ روز نگه داشته و در هر اجرای پشتیبان پاک می‌شوند.
(() => {
  const main = document.querySelector(".page-container");
  const link = document.querySelector('.sidebar-link[data-nav="events"]');
  if (!main || !link) return;

  const isSuper = () => window.reSiRaiCurrentUser?.isSuperAdmin === true;

  // برچسبِ فارسیِ هر نوع؛ نوعِ ناشناخته همان متنِ خام نمایش داده می‌شود.
  const kindLabel = {
    login: "ورود",
    LoginRateLimitExceeded: "محدودیت تلاش ورود",
    sms: "پیامک",
    "ai.image": "تحلیل تصویر (تکی)",
    "ai.images": "تحلیل تصویر (چندتایی)",
    "ai.chat": "پرسش از AI",
    backup: "پشتیبان",
    "app.start": "شروع برنامه"
  };

  const section = document.createElement("section");
  section.id = "eventsSection";
  section.className = "card hidden shell-page";
  section.innerHTML = `
    <div class="section-header">
      <div><h2>لاگ رویدادها</h2><p>ورود، پیامک، تحلیل هوش مصنوعی، پشتیبان و شروع برنامه</p></div>
      <div class="events-actions"><button type="button" id="eventsExport" class="secondary-button">خروجیِ CSV</button><button type="button" id="eventsRefresh" class="secondary-button">تازه‌سازی</button></div>
    </div>
    <div class="events-filters">
      <div class="form-field"><label for="eventsKind">نوع رویداد</label><select id="eventsKind"><option value="all">همه</option></select></div>
      <div class="form-field"><label for="eventsOutcome">نتیجه</label><select id="eventsOutcome"><option value="all">همه</option><option value="ok">موفق</option><option value="fail">ناموفق</option></select></div>
      <div class="form-field"><label for="eventsFrom">از تاریخ</label><input type="date" id="eventsFrom"></div>
      <div class="form-field"><label for="eventsTo">تا تاریخ</label><input type="date" id="eventsTo"></div>
      <div class="form-field events-search"><label for="eventsQuery">جستجو</label><input type="text" id="eventsQuery" placeholder="در توضیح یا نام کاربر" /></div>
    </div>
    <div id="eventsStatus" class="status-message"></div>
    <div class="table-container">
      <table class="patient-table">
        <thead><tr><th>زمان</th><th>نوع</th><th>نتیجه</th><th>کاربر</th><th>مدت</th><th>توضیح</th></tr></thead>
        <tbody id="eventsBody"></tbody>
      </table>
    </div>
    <p id="eventsCount" class="field-hint"></p>`;
  main.appendChild(section);

  const $ = id => document.getElementById(id);
  const esc = value => { const d = document.createElement("div"); d.textContent = value ?? ""; return d.innerHTML; };

  // دادهٔ آخرین بارِ بارگذاری‌شده، برای خروجیِ CSV (همان فیلترِ فعلی).
  let lastEvents = [];

  async function load() {
    const status = $("eventsStatus");
    status.classList.remove("error");
    status.textContent = "در حال دریافت رویدادها...";
    try {
      const params = new URLSearchParams();
      const kind = $("eventsKind").value, outcome = $("eventsOutcome").value;
      const from = $("eventsFrom").value, to = $("eventsTo").value;
      const q = $("eventsQuery").value.trim();
      if (kind && kind !== "all") params.set("kind", kind);
      if (outcome && outcome !== "all") params.set("outcome", outcome);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (q) params.set("q", q);
      const r = await fetch(`/api/appevents?${params.toString()}`, { cache: "no-store" });
      const x = await r.json().catch(() => ({}));
      if (!r.ok || x.success === false) throw new Error(x.message || "رویدادها دریافت نشد.");
      renderKinds(x.kinds || []);
      render(x.events || [], x.total ?? 0);
      status.textContent = "";
    } catch (e) {
      status.textContent = e.message || "رویدادها دریافت نشد.";
      status.classList.add("error");
    }
  }

  function renderKinds(kinds) {
    const select = $("eventsKind");
    const current = select.value;
    select.innerHTML = '<option value="all">همه</option>' +
      kinds.map(k => `<option value="${esc(k)}">${esc(kindLabel[k] || k)}</option>`).join("");
    if ([...select.options].some(o => o.value === current)) select.value = current;
  }

  function render(events, total) {
    const body = $("eventsBody");
    lastEvents = events || [];
    body.innerHTML = "";
    if (!events.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 6;
      td.textContent = "رویدادی با این فیلتر پیدا نشد.";
      td.style.textAlign = "center";
      tr.appendChild(td);
      body.appendChild(tr);
    }
    events.forEach(e => {
      const tr = document.createElement("tr");
      const time = document.createElement("td");
      time.textContent = typeof formatPersianDateTime === "function" ? formatPersianDateTime(e.eventAt) : String(e.eventAt || "");
      const kind = document.createElement("td");
      kind.textContent = kindLabel[e.kind] || e.kind;
      const outcome = document.createElement("td");
      outcome.innerHTML = `<span class="events-outcome ${e.outcome === "fail" ? "is-fail" : "is-ok"}">${e.outcome === "fail" ? "ناموفق" : "موفق"}</span>`;
      const user = document.createElement("td");
      user.textContent = e.userName || (e.userID ? `#${e.userID}` : "—");
      const duration = document.createElement("td");
      duration.textContent = Number.isFinite(Number(e.durationMs)) && e.durationMs != null
        ? `${(Number(e.durationMs) / 1000).toLocaleString("fa-IR", { maximumFractionDigits: 1 })} ثانیه`
        : "—";
      const detail = document.createElement("td");
      detail.textContent = e.detail || "—";
      detail.title = e.detail || "";
      tr.append(time, kind, outcome, user, duration, detail);
      body.appendChild(tr);
    });
    $("eventsCount").textContent = total
      ? `${Number(total).toLocaleString("fa-IR")} رویداد مطابقِ فیلتر${events.length < total ? ` — ${events.length.toLocaleString("fa-IR")} موردِ آخر نمایش داده شد` : ""}`
      : "";
  }

  function open() {
    if (!isSuper()) return;
    document.querySelectorAll(".page-container > section").forEach(x => x.classList.add("hidden"));
    section.classList.remove("hidden");
    document.querySelectorAll(".sidebar-link").forEach(x => x.classList.toggle("active", x === link));
    window.scrollTo(0, 0);
    load();
  }

  // آیتمِ منو فقط برای مدیرِ سیستم دیده می‌شود؛ اگر دسترسی وسطِ کار بازپس
  // گرفته شود، خودِ صفحه هم بسته می‌شود.
  function sync() {
    const allowed = isSuper();
    link.classList.toggle("hidden", !allowed);
    if (!allowed) section.classList.add("hidden");
  }
  window.addEventListener("resirai-auth-changed", sync);
  setTimeout(sync, 0);

  ["eventsKind", "eventsOutcome", "eventsFrom", "eventsTo"].forEach(id => $(id).addEventListener("change", load));
  let searchTimer = null;
  $("eventsQuery").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(load, 400); });
  $("eventsRefresh").addEventListener("click", load);

  // خروجیِ اکسل: BOM تا فارسی در Excel درست خوانده شود و کاما/گیومه درست گِریخته شود.
  const csvCell = value => {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  function exportCsv() {
    if (!lastEvents.length) {
      window.showToast?.("رویدادی برای خروجی وجود ندارد.", "error");
      return;
    }
    const header = ["زمان", "نوع", "نتیجه", "کاربر", "مدت (ثانیه)", "توضیح"];
    const lines = [header.map(csvCell).join(",")];
    lastEvents.forEach(e => {
      lines.push([
        typeof formatPersianDateTime === "function" ? formatPersianDateTime(e.eventAt) : (e.eventAt || ""),
        kindLabel[e.kind] || e.kind,
        e.outcome === "fail" ? "ناموفق" : "موفق",
        e.userName || (e.userID ? `#${e.userID}` : ""),
        e.durationMs == null || e.durationMs === "" ? "" : Math.round(Number(e.durationMs) / 100) / 10,
        e.detail || ""
      ].map(csvCell).join(","));
    });
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `resirai-events-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  $("eventsExport").addEventListener("click", exportCsv);

  window.ReSiRaiEvents = { open };
})();
