// ReSiRai shell navigation.
// Keeps global navigation separate from Patient and Study actions and moves
// administrative maintenance commands out of the application header.
(() => {
    const main = document.querySelector(".page-container");
    const sidebarLinks = [...document.querySelectorAll(".sidebar-link[data-nav]")];
    let latestNetwork = {};
    if (!main || !sidebarLinks.length) return;

    const hidePages = () => document.querySelectorAll(".page-container > section").forEach(x => x.classList.add("hidden"));
    const setActive = name => sidebarLinks.forEach(x => x.classList.toggle("active", x.dataset.nav === name));

    const dashboard = document.createElement("section");
    dashboard.id = "dashboardSection";
    dashboard.className = "card hidden shell-page";
    dashboard.innerHTML = `
      <div class="section-header"><div><h2>داشبورد</h2><p>نمای کلی سامانه ReSiRai</p></div></div>
      <h3 class="dashboard-group-title">آمار کلی</h3>
      <div class="dashboard-summary-grid dashboard-overall-grid">
        <div class="dashboard-summary-card metric-blue"><span class="dashboard-metric-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.4"/><path d="M2.8 20c0-3.4 2.8-5.6 6.2-5.6s6.2 2.2 6.2 5.6"/><path d="M16.2 5.2a3.4 3.4 0 0 1 0 6.5"/><path d="M17.6 14.7c2.2.6 3.6 2.3 3.6 4.5"/></svg></span><strong id="dashboardTotalPatients">-</strong><span>کل بیماران</span></div>
        <div class="dashboard-summary-card metric-green"><span class="dashboard-metric-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8 12.4 2.6 2.6L16 9.6"/></svg></span><strong id="dashboardActivePatients">-</strong><span>بیماران فعال</span></div>
        <div class="dashboard-summary-card metric-gray"><span class="dashboard-metric-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg></span><strong id="dashboardInactivePatients">-</strong><span>بیماران غیرفعال</span></div>
        <div class="dashboard-summary-card metric-purple"><span class="dashboard-metric-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5a1.5 1.5 0 0 1 1.5-1.5h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5Z"/><path d="M8.5 3v18"/><path d="M12 8.5h5"/><path d="M12 12h5"/><path d="M12 15.5h3"/></svg></span><strong id="dashboardTotalStudies">-</strong><span>کل مطالعات</span></div>
        <div class="dashboard-summary-card metric-cyan"><span class="dashboard-metric-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="m3.5 16 4.6-4.3a1.6 1.6 0 0 1 2.2 0l3.2 3"/><path d="m13.8 14 1.6-1.5a1.6 1.6 0 0 1 2.2 0l3.1 2.9"/><circle cx="9" cy="9.4" r="1.3"/></svg></span><strong id="dashboardTotalImages">-</strong><span>کل تصاویر</span></div>
      </div>
      <h3 class="dashboard-group-title">امروز</h3>
      <div class="dashboard-summary-grid dashboard-today-grid">
        <div class="dashboard-summary-card today-card today-patients"><strong id="dashboardPatientsToday">-</strong><span>بیماران امروز</span></div>
        <div class="dashboard-summary-card today-card today-studies"><strong id="dashboardStudiesToday">-</strong><span>مطالعات امروز</span></div>
        <div class="dashboard-summary-card today-card today-images"><strong id="dashboardImagesToday">-</strong><span>تصاویر امروز</span></div>
        <div class="dashboard-summary-card today-card today-new"><strong id="dashboardNewPatientsToday">-</strong><span>بیماران جدید امروز</span></div>
      </div>
      <section class="dashboard-panel dashboard-attention-panel">
        <div class="dashboard-panel-title">
          <strong>نیازمند اطلاع‌رسانی</strong>
          <span id="attentionSummary">-</span>
        </div>
        <div id="dashboardAttention" class="attention-list"></div>
      </section>
      <div class="dashboard-detail-grid">
        <section class="dashboard-panel"><div class="dashboard-panel-title"><strong>آخرین مطالعات</strong><span>۵ مورد اخیر</span></div><div id="dashboardRecentStudies" class="dashboard-recent-list"></div></section>
        <section class="dashboard-panel"><div class="dashboard-panel-title"><strong>آخرین تصاویر</strong><span>۵ مورد اخیر</span></div><div id="dashboardRecentImages" class="dashboard-recent-list"></div></section>
      </div>
      <section class="dashboard-system-panel"><div><strong>وضعیت سامانه</strong><span id="dashboardGeneratedAt">-</span></div><div class="dashboard-system-items"><span id="dashboardDatabaseStatus">پایگاه‌داده: در حال بررسی</span><span id="dashboardStorageStatus">فضای تصاویر: در حال بررسی</span></div></section>`;
    main.appendChild(dashboard);

    const settings = document.createElement("section");
    settings.id = "settingsSection";
    settings.className = "card hidden shell-page";
    settings.innerHTML = `
      <div class="section-header"><div><h2>تنظیمات و مدیریت سیستم</h2><p>تعاریف پایه و دسترسی‌های مدیریتی ReSiRai</p></div></div>
      <div id="settingsAdminActions" class="settings-admin-actions"></div>`;
    main.appendChild(settings);

    // «گزارش‌ها» دیگر placeholder نیست: ماژولِ reports-ui.js صفحهٔ واقعی را می‌سازد.
    const placeholders = {};
    const placeholderSections = {};
    Object.entries(placeholders).forEach(([name, [title, description]]) => {
        const section = document.createElement("section");
        section.id = `${name}WorkspaceSection`;
        section.className = "card hidden shell-page";
        section.innerHTML = `<div class="section-header"><div><h2>${title}</h2><p>${description}</p></div></div><div class="shell-empty-state">این بخش در مرحلهٔ بعد تکمیل می‌شود.</div>`;
        main.appendChild(section);
        placeholderSections[name] = section;
    });

    function moveAdministrativeButtons() {
        const target = document.getElementById("settingsAdminActions");
        const administrativeLabels = new Set(["مدیریت پرسنل", "مدیریت تخصص‌ها", "مدیریت انواع Study", "مدیریت انواع تصویر", "مدیریت کاربران"]);
        document.querySelectorAll(".header-content button").forEach(button => {
            if (!administrativeLabels.has(button.textContent.trim())) return;
            button.classList.add("settings-action-button");
            target.appendChild(button);
        });
    }

    // The dashboard refreshes itself while it is open. The timer is paused when
    // the tab is hidden so background tabs never poll needlessly.
    const DASHBOARD_REFRESH_MS = 30000;
    let dashboardTimer = null;
    let dashboardVisible = false;

    function startDashboardAutoRefresh() {
        stopDashboardAutoRefresh();
        dashboardTimer = setInterval(() => {
            if (dashboardVisible && document.visibilityState === "visible" && !dashboard.classList.contains("hidden")) {
                openDashboard({ silent: true });
            }
        }, DASHBOARD_REFRESH_MS);
    }
    function stopDashboardAutoRefresh() {
        if (dashboardTimer) { clearInterval(dashboardTimer); dashboardTimer = null; }
    }
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && dashboardVisible && !dashboard.classList.contains("hidden")) {
            openDashboard({ silent: true });
        }
    });

    async function openDashboard(options = {}) {
        const silent = options.silent === true;
        if (!silent) {
            hidePages(); dashboard.classList.remove("hidden"); setActive("dashboard");
            dashboardVisible = true;
            startDashboardAutoRefresh();
        }
        try {
            const response = await fetch("/api/dashboard", { cache: "no-store" });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error();
            const overall = result.overall || {}, today = result.today || {};
            const connected = result.system?.databaseConnected !== false;
            const values = {
                dashboardTotalPatients: overall.totalPatients, dashboardActivePatients: overall.activePatients,
                dashboardInactivePatients: overall.inactivePatients, dashboardTotalStudies: overall.totalStudies,
                dashboardTotalImages: overall.totalImages, dashboardPatientsToday: today.patientsToday,
                dashboardStudiesToday: today.studiesToday, dashboardImagesToday: today.imagesToday,
                dashboardNewPatientsToday: today.newPatientsToday
            };
            // Show a dash instead of a misleading 0 when the database is unreachable.
            Object.entries(values).forEach(([id, value]) => {
                const el = document.getElementById(id);
                if (!el) return;
                el.textContent = connected ? (value ?? 0) : "—";
                // Cards that track "today" turn green once they have activity.
                const card = el.closest(".dashboard-summary-card");
                if (card?.classList.contains("today-card")) {
                    card.classList.toggle("has-value", connected && Number(value) > 0);
                }
            });
            renderRecentStudies(connected ? (result.recentStudies || []) : []);
            renderRecentImages(connected ? (result.recentImages || []) : []);
            document.getElementById("dashboardGeneratedAt").textContent = `آخرین به‌روزرسانی: ${formatPersianDateTime(result.generatedAt)}`;
            document.getElementById("dashboardDatabaseStatus").textContent = connected ? "● پایگاه‌داده متصل است" : "● پایگاه‌داده در دسترس نیست";
            document.getElementById("dashboardDatabaseStatus").className = connected ? "system-ok" : "system-error";
            const storage = result.system?.storage || {};
            document.getElementById("dashboardStorageStatus").textContent = storage.available
                ? `● فضای تصاویر آماده است — ${formatBytes(storage.freeBytes)} آزاد`
                : `● مسیر ${storage.rootPath || "تنظیم‌نشده"} در دسترس نیست`;
            document.getElementById("dashboardStorageStatus").className = storage.available ? "system-ok" : "system-error";
            renderNetworkAccess(result.system?.network || {});
            renderSettingsNetworkLinks(result.system?.network || {});
            loadAttention();
        } catch {
            if (silent) return; // keep the last good snapshot on a background refresh
            dashboard.querySelectorAll(".dashboard-summary-card strong").forEach(x => x.textContent = "-");
            document.getElementById("dashboardRecentStudies").textContent = "دریافت اطلاعات داشبورد ناموفق بود.";
            document.getElementById("dashboardRecentImages").textContent = "دریافت اطلاعات داشبورد ناموفق بود.";
        }
    }

    const formatBytes = value => !Number.isFinite(Number(value)) ? "-" : `${(Number(value) / 1073741824).toLocaleString("fa-IR", { maximumFractionDigits: 1 })} گیگابایت`;

    // Who needs a message today, gathered from appointments, due follow-ups and
    // outstanding balances. Nothing is sent from here automatically; each row has a
    // button that opens the messaging dialog with the right template.
    async function loadAttention() {
        const root = document.getElementById("dashboardAttention");
        const summary = document.getElementById("attentionSummary");
        if (!root) return;
        root.textContent = "در حال بررسی...";
        try {
            const r = await fetch("/api/attention", { cache: "no-store" });
            const x = await r.json();
            if (!r.ok || !x.success) throw new Error();

            const rows = []
                .concat((x.appointments || []).map(i => ({ ...i, kindLabel: "نوبت پیش‌رو" })))
                .concat((x.followUps || []).map(i => ({ ...i, kindLabel: "پیگیری سررسیده" })))
                .concat((x.balances || []).map(i => ({ ...i, kindLabel: "مانده حساب" })));

            summary.textContent = rows.length ? `${rows.length} مورد` : "موردی نیست";
            root.replaceChildren();
            if (!rows.length) {
                root.innerHTML = '<div class="attention-empty">همه‌چیز به‌روز است. کاری برای اطلاع‌رسانی باقی نمانده.</div>';
                return;
            }
            rows.forEach(item => {
                const row = document.createElement("div");
                row.className = `attention-row attention-${item.kind}`;
                const text = document.createElement("div");
                text.className = "attention-text";
                const name = document.createElement("strong");
                name.textContent = item.patientName || "-";
                const meta = document.createElement("small");
                meta.textContent = item.kind === "balance"
                    ? `${item.kindLabel} — ${Number(item.balance || 0).toLocaleString("fa-IR")} تومان`
                    : `${item.kindLabel} — ${item.dueDate ? formatPersianDateTime(item.dueDate) : ""}`;
                text.append(name, meta);
                const send = document.createElement("button");
                send.type = "button";
                send.className = "attention-send";
                send.textContent = "ارسال پیامک";
                send.onclick = () => openAttentionMessage(item);
                row.append(text, send);
                root.appendChild(row);
            });
        } catch {
            if (summary) summary.textContent = "-";
            root.textContent = "دریافت فهرست اطلاع‌رسانی ناموفق بود.";
        }
    }

    // Opens the patient and asks the messaging dialog to open with the template for
    // this kind of reminder.
    async function openAttentionMessage(item) {
        try {
            navigate("patients");
            if (typeof window.openPatientInline === "function") await window.openPatientInline(item.patientID);
            window.dispatchEvent(new CustomEvent("resirai-offer-message", {
                detail: { patientID: item.patientID, templateKey: item.templateKey }
            }));
        } catch { /* the patient workspace shows its own error */ }
    }

    function renderNetworkAccess(network) {
        latestNetwork = network;
        // ReSiRai اکنون روی سرور ابری اجرا می‌شود؛ بخش دسترسی شبکه حذف شده است.
    }
    function renderSettingsNetworkLinks(network) {
        latestNetwork = network;
        if (network.serverNameUrl) root.appendChild(createAccessLink(network.serverNameUrl, "نام سرور"));
        if (network.publicUrl) root.appendChild(createAccessLink(network.publicUrl, "IP استاتیک"));
    }

    // IP عمومی همان عددی است که کاوه‌نگار هنگام ارسال پیامک می‌بیند. چون IP
    // مطب معمولاً داینامیک است، نمایش همین‌جا کنار لینک‌های اجرا باعث می‌شود
    // وقتی از محدودهٔ ثبت‌شده در پنل کاوه‌نگار بیرون رفت، همان اول دیده شود.
    function createPublicIpRow() {
        const row = document.createElement("div");
        row.className = "dashboard-access-row";
        const title = document.createElement("span");
        title.textContent = "آی‌پی عمومی اینترنت";
        const value = document.createElement("code");
        value.className = "dashboard-access-ip";
        value.textContent = "در حال دریافت...";
        const copy = document.createElement("button");
        copy.type = "button"; copy.className = "secondary-button"; copy.textContent = "کپی";
        copy.onclick = async () => {
            try { await navigator.clipboard.writeText(value.textContent); copy.textContent = "کپی شد"; setTimeout(() => copy.textContent = "کپی", 1500); }
            catch { window.prompt("آی‌پی را کپی کنید:", value.textContent); }
        };
        const refresh = document.createElement("button");
        refresh.type = "button"; refresh.className = "secondary-button"; refresh.textContent = "تازه‌سازی";
        const hint = document.createElement("small");
        hint.textContent = "کاوه‌نگار پیامک را فقط از IP های ثبت‌شده در «تنظیمات ← تنظیمات آی‌پی مجاز ← وب‌سرویس» می‌پذیرد؛ اگر این عدد از محدودهٔ ثبت‌شده بیرون رفت، پیامک ارسال نمی‌شود.";
        row.append(title, value, copy, refresh, hint);

        const load = async () => {
            value.textContent = "در حال دریافت...";
            refresh.disabled = true;
            try {
                const r = await fetch("/api/communications/public-ip", { cache: "no-store" });
                // پاسخ 401/403 بدنهٔ خالی دارد؛ اگر JSON نبود نباید کل بارگذاری بترسد.
                let d = {}; try { d = await r.json(); } catch { d = {}; }
                value.textContent = r.ok && d.success
                    ? d.ip
                    : (d.message || ((r.status === 401 || r.status === 403) ? "نیاز به دسترسی مدیر سیستم" : "دریافت IP ممکن نشد"));
            } catch { value.textContent = "ارتباط با سرور برقرار نشد."; }
            finally { refresh.disabled = false; }
        };
        refresh.onclick = load;
        load();
        return row;
    }
    function createAccessLink(url, label) {
        const row = document.createElement("div"); row.className = "dashboard-access-row";
        const title = document.createElement("span"); title.textContent = label;
        const link = document.createElement("a"); link.href = url; link.target = "_blank"; link.rel = "noopener"; link.textContent = url;
        const copy = document.createElement("button"); copy.type = "button"; copy.className = "secondary-button"; copy.textContent = "کپی";
        copy.onclick = async () => { try { await navigator.clipboard.writeText(url); copy.textContent = "کپی شد"; setTimeout(() => copy.textContent = "کپی", 1500); } catch { window.prompt("لینک را کپی کنید:", url); } };
        row.append(title, link, copy);
        const qr = createAccessQr(url, label);
        if (qr) row.appendChild(qr);
        return row;
    }
    // The QR code of the link itself, so a phone can open ReSiRai by pointing its
    // camera instead of typing the address. qrcode-generator draws the standard
    // four-module quiet zone (margin below); the card around it adds more white
    // space so neighbouring codes stay far enough apart to scan reliably.
    //
    // Phone cameras disagree about how big a module has to be: an iPhone locks on
    // around three pixels, while Xiaomi (MIUI) usually needs four or more, and the
    // run-link QR carries the longest payload. One click opens the same code full
    // screen, which is what makes it scannable on the stricter cameras.
    function createAccessQr(url, label) {
        if (typeof qrcode !== "function") return null;
        try {
            const code = qrcode(0, "M");            // 0 = pick the smallest version that fits
            code.addData(url);
            code.make();
            const box = document.createElement("div");
            box.className = "dashboard-access-qr";
            box.innerHTML = code.createSvgTag({ cellSize: 4, margin: 16, scalable: true, alt: `کیوکد لینک ${label}` });
            const hint = document.createElement("small");
            hint.textContent = "برای باز کردن ReSiRai روی موبایل، دوربین را روی این کد بگیرید. برای اسکن آسان‌تر، روی کد کلیک کنید.";
            box.append(hint);
            box.tabIndex = 0;
            box.setAttribute("role", "button");
            box.setAttribute("aria-label", `بزرگ‌نمایی کیوآرکد ${label}`);
            return box;
        } catch {
            // A broken QR must never take the dashboard down; the plain link stays.
            return null;
        }
    }

    // بزرگ‌نمایی همهٔ کیوآرکدهای برنامه — لینک‌های اجرا، جفت‌سازی، دانلود و
    // دریافت تصویر. با یک شنوندهٔ سراسری، پنجره‌هایی که بعداً ساخته می‌شوند هم
    // خودکار پوشش داده می‌شوند و لازم نیست هر جا دوباره سیم‌کشی شود.
    function attachQrZoomDelegation() {
        const findBox = (target) => (target && target.closest ? target.closest(".dashboard-access-qr, .pair-qr") : null);
        document.addEventListener("click", (e) => {
            const box = findBox(e.target);
            if (!box) return;
            const svg = box.querySelector("svg");
            if (!svg) return;
            const alt = (svg.getAttribute("alt") || "").replace(/^کیوکد\s+|^کیوآرکد\s+/, "");
            ReSiRaiQrZoom(box, alt);
        });
        document.addEventListener("keydown", (e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            const box = findBox(e.target);
            if (!box || !box.querySelector("svg")) return;
            e.preventDefault();
            ReSiRaiQrZoom(box, (box.querySelector("svg").getAttribute("alt") || "").replace(/^کیوکد\s+|^کیوآرکد\s+/, ""));
        });
    }
    attachQrZoomDelegation();

    // نمای تمام‌صفحهٔ یک کیوآرکد؛ همان کد، فقط بزرگ‌تر تا هر دوربینی بگیردش.
    function ReSiRaiQrZoom(box, label) {
        let overlay = document.getElementById("qrZoomOverlay");
        if (!overlay) {
            overlay = document.createElement("div");
            overlay.id = "qrZoomOverlay";
            overlay.className = "qr-zoom-overlay hidden";
            overlay.innerHTML =
                '<div class="qr-zoom-card">' +
                '<button class="modal-close-button" type="button" aria-label="بستن">×</button>' +
                '<div class="qr-zoom-body"></div>' +
                '<small class="qr-zoom-hint"></small>' +
                "</div>";
            document.body.appendChild(overlay);
            const close = () => overlay.classList.add("hidden");
            overlay.querySelector(".modal-close-button").onclick = close;
            overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
            document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
        }
        const svg = box?.querySelector("svg");
        const body = overlay.querySelector(".qr-zoom-body");
        body.replaceChildren(svg ? svg.cloneNode(true) : document.createTextNode("کیوآرکد در دسترس نیست."));
        overlay.querySelector(".qr-zoom-hint").textContent =
            `${label ? `کیوآرکد ${label} — ` : ""}گوشی را ۱۰ تا ۱۵ سانتی‌متر از صفحه فاصله بدهید و ثابت نگه دارید.`;
        overlay.classList.remove("hidden");
    }
    window.ReSiRaiQrZoom = ReSiRaiQrZoom;
    function renderRecentStudies(items) {
        const root = document.getElementById("dashboardRecentStudies"); root.replaceChildren();
        if (!items.length) { root.textContent = "مطالعه‌ای ثبت نشده است."; return; }
        items.forEach(item => {
            const row = document.createElement("button");
            row.type = "button";
            row.className = "dashboard-recent-row dashboard-recent-clickable";
            row.title = "باز کردن پرونده بیمار و همین مطالعه";

            // Prefer a real thumbnail; fall back to the study icon when the study
            // has no image (or only PDFs).
            const media = item.thumbnailImageID
                ? document.createElement("img")
                : document.createElement("span");
            media.className = "dashboard-recent-icon";
            if (item.thumbnailImageID) {
                media.src = `/api/radiologyimages/${item.thumbnailImageID}`;
                media.alt = ""; media.loading = "lazy";
                media.onerror = () => { media.removeAttribute("src"); media.textContent = "▣"; };
            } else media.textContent = "▣";

            const text = document.createElement("span");
            const name = document.createElement("strong");
            name.textContent = item.patientName;
            const meta = document.createElement("small");
            meta.textContent = `${item.studyTypeName}${item.bodyPart ? ` — ${item.bodyPart}` : ""}`;
            text.append(name, meta);

            const time = document.createElement("time");
            time.textContent = formatPersianDateTime(item.studyDate);

            row.append(media, text, time);
            row.addEventListener("click", () => openPatientStudy(item));
            root.appendChild(row);
        });
    }
    function renderRecentImages(items) {
        const root = document.getElementById("dashboardRecentImages"); root.replaceChildren();
        if (!items.length) { root.textContent = "تصویری ثبت نشده است."; return; }
        items.forEach(item => {
            const row = document.createElement("button");
            row.type = "button";
            row.className = "dashboard-recent-row dashboard-recent-clickable";
            row.title = item.contentType === "application/pdf" ? "باز کردن PDF در تب جدید" : "نمایش تصویر بزرگ";

            const isPdf = item.contentType === "application/pdf";
            const media = isPdf ? document.createElement("span") : document.createElement("img");
            media.className = "dashboard-image-thumb";
            if (isPdf) media.textContent = "PDF";
            else { media.src = `/api/radiologyimages/${item.imageID}`; media.alt = ""; media.loading = "lazy"; }

            const text = document.createElement("span"), name = document.createElement("strong"),
                  type = document.createElement("small"), time = document.createElement("time");
            name.textContent = item.patientName;
            type.textContent = item.imageTypeName || item.fileName;
            time.textContent = formatPersianDateTime(item.createdDate);
            text.append(name, type);
            row.append(media, text, time);
            row.addEventListener("click", () => openDashboardImage(item, isPdf));
            root.appendChild(row);
        });
    }

    // Opens the patient record and scrolls to the clicked study card. The
    // patients workspace is reused so behaviour matches the patient list.
    async function openPatientStudy(item) {
        navigate("patients");
        try {
            if (typeof window.openPatientInline === "function") await window.openPatientInline(item.patientID);
            // Studies render asynchronously; wait for the card to exist.
            const card = await waitForStudyCard(item.studyID);
            card?.scrollIntoView({ behavior: "smooth", block: "start" });
        } catch { /* patient lookup failed; the workspace already shows its own error */ }
    }

    function waitForStudyCard(studyID, timeoutMs = 4000) {
        return new Promise(resolve => {
            const started = Date.now();
            const tick = () => {
                const card = document.querySelector(`.study-scroll-card[data-study-id="${studyID}"]`);
                if (card) return resolve(card);
                if (Date.now() - started > timeoutMs) return resolve(null);
                setTimeout(tick, 120);
            };
            tick();
        });
    }

    function openDashboardImage(item, isPdf) {
        const url = `/api/radiologyimages/${item.imageID}`;
        if (isPdf) { window.open(url, "_blank", "noopener"); return; }
        // Reuse the application's own image viewer when it is available.
        if (typeof window.openLargeImage === "function") {
            window.openLargeImage({ imageID: item.imageID, fileName: item.fileName, contentType: item.contentType, imageTypeName: item.imageTypeName });
        } else {
            window.open(url, "_blank", "noopener");
        }
    }

    function openPatients() {
        hidePages();
        document.getElementById("patientsSection")?.classList.remove("hidden");
        setActive("patients");
        if (typeof window.loadPatients === "function") window.loadPatients();
        // ناحیهٔ «معرفیِ بیمار» (کدِ ملی اول) همیشه بالایِ فهرست سوار شود.
        if (window.ReSiRaiPatientDraft && window.ReSiRaiPatientDraft.mount) window.ReSiRaiPatientDraft.mount();
        window.scrollTo(0, 0);
    }

    function openHelp() {
        hidePages();
        document.getElementById("helpSection")?.classList.remove("hidden");
        setActive("help");
        if (typeof window.ReSiRaiHelpPage === "function") window.ReSiRaiHelpPage.render();
        window.scrollTo(0, 0);
    }

    function openSettings(focus) {
        hidePages(); settings.classList.remove("hidden"); setActive("settings");
        renderSettingsNetworkLinks(latestNetwork);
        window.scrollTo(0, 0);
    }

    function openPlaceholder(name) {
        hidePages(); placeholderSections[name]?.classList.remove("hidden"); setActive(name); window.scrollTo(0, 0);
    }

    // The header search previously did nothing. It now performs a real
    // patient lookup and opens the selected record in the Patients workspace.
    function setupGlobalSearch() {
        const input = document.getElementById("globalSearchInput");
        const results = document.getElementById("globalSearchResults");
        if (!input || !results) return;
        let timer = null, controller = null;

        const close = () => { results.classList.add("hidden"); results.replaceChildren(); };

        const render = patients => {
            results.replaceChildren();
            if (!patients.length) {
                const empty = document.createElement("div");
                empty.className = "global-search-empty";
                empty.textContent = "بیماری با این مشخصات یافت نشد.";
                results.appendChild(empty);
            } else {
                patients.slice(0, 8).forEach(p => {
                    const item = document.createElement("button");
                    item.type = "button";
                    item.className = "global-search-item";
                    item.setAttribute("role", "option");
                    const avatar = document.createElement("span");
                    avatar.className = "global-search-avatar";
                    const img = document.createElement("img");
                    img.alt = ""; img.loading = "lazy";
                    img.src = `/api/patients/${p.patientID}/photo`;
                    img.onerror = () => { img.remove(); avatar.textContent = "👤"; };
                    avatar.appendChild(img);
                    const text = document.createElement("span");
                    text.className = "global-search-text";
                    const name = document.createElement("strong");
                    name.textContent = `${p.firstName || ""} ${p.lastName || ""}`.trim() || "-";
                    const meta = document.createElement("small");
                    meta.textContent = `${p.nationalCode || "-"}${p.mobile ? ` — ${p.mobile}` : ""}`;
                    text.append(name, meta);
                    item.append(avatar, text);
                    item.addEventListener("click", () => { close(); input.value = ""; openSearchResult(p); });
                    results.appendChild(item);
                });
            }
            results.classList.remove("hidden");
        };

        const search = async term => {
            controller?.abort(); controller = new AbortController();
            try {
                const q = new URLSearchParams();
                q.set("search", term);
                q.set("includeInactive", "true");
                const r = await fetch(`/api/patients?${q}`, { cache: "no-store", signal: controller.signal });
                const x = await r.json();
                if (!r.ok) throw new Error();
                render(x.patients || x || []);
            } catch (e) { if (e?.name !== "AbortError") close(); }
        };

        input.addEventListener("input", () => {
            const term = input.value.trim();
            clearTimeout(timer);
            if (term.length < 2) { close(); return; }
            timer = setTimeout(() => search(term), 220);
        });
        input.addEventListener("keydown", e => {
            if (e.key === "Escape") { close(); input.blur(); return; }
            if (e.key === "Enter") { e.preventDefault(); results.querySelector(".global-search-item")?.click(); }
        });
        document.addEventListener("click", e => { if (!e.target.closest("#globalSearchBox")) close(); });
    }

    async function openSearchResult(patient) {
        navigate("patients");
        const search = document.getElementById("patientSearch");
        if (search) search.value = patient.nationalCode || `${patient.firstName || ""} ${patient.lastName || ""}`.trim();
        if (typeof window.loadPatients === "function") await window.loadPatients(search?.value || "");
        if (typeof window.openPatientInline === "function") await window.openPatientInline(patient.patientID);
    }

    function navigate(name) {
        if (name === "dashboard") return openDashboard();
        if (name === "patients") { dashboardVisible = false; stopDashboardAutoRefresh(); return openPatients(); }
        if (name === "settings") { dashboardVisible = false; stopDashboardAutoRefresh(); return openSettings(); }
        if (name === "help") { dashboardVisible = false; stopDashboardAutoRefresh(); return openHelp(); }
        // گزارش‌ها: دسترسی در خودِ ماژول بررسی می‌شود (مدیرِ سیستم یا پرچمِ گزارش‌ها).
        if (name === "reports") { dashboardVisible = false; stopDashboardAutoRefresh(); return window.ReSiRaiReports?.open(); }
        // لاگِ رویدادها فقط برای مدیرِ سیستم است؛ ماژولِ خودش دسترسی را بررسی می‌کند.
        if (name === "events") { dashboardVisible = false; stopDashboardAutoRefresh(); return window.ReSiRaiEvents?.open(); }
        if (placeholderSections[name]) { dashboardVisible = false; stopDashboardAutoRefresh(); return openPlaceholder(name); }
    }

    sidebarLinks.forEach(link => link.addEventListener("click", event => {
        event.preventDefault();
        navigate(link.dataset.nav);
    }));
    dashboard.addEventListener("click", event => {
        const button = event.target.closest("[data-open-nav]");
        if (!button) return;
        if (button.dataset.openNav === "settings") return openSettings(button.dataset.settingsFocus);
        navigate(button.dataset.openNav);
    });

    // Admin scripts run before this file and create their own working buttons.
    // Moving those same nodes preserves every original click handler.
    // The POS panel is its own card; the button reveals it and loads the settings.
    document.getElementById("openPosSettingsButton")?.addEventListener("click", () => {
        window.ReSiRaiPosSettings?.show();
        document.getElementById("posSettingsCard")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    moveAdministrativeButtons();
    setupGlobalSearch();
    window.ReSiRaiNavigation = { navigate, moveAdministrativeButtons };
    navigate("dashboard");
})();
