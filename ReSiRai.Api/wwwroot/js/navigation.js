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
      <div class="section-header"><div><h2>Ø¯Ø§Ø´Ø¨ÙˆØ±Ø¯</h2><p>Ù†Ù…Ø§ÛŒ Ú©Ù„ÛŒ Ø³Ø§Ù…Ø§Ù†Ù‡ ReSiRai</p></div></div>
      <h3 class="dashboard-group-title">Ø¢Ù…Ø§Ø± Ú©Ù„ÛŒ</h3>
      <div class="dashboard-summary-grid dashboard-overall-grid">
        <div class="dashboard-summary-card metric-blue"><span class="dashboard-metric-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.4"/><path d="M2.8 20c0-3.4 2.8-5.6 6.2-5.6s6.2 2.2 6.2 5.6"/><path d="M16.2 5.2a3.4 3.4 0 0 1 0 6.5"/><path d="M17.6 14.7c2.2.6 3.6 2.3 3.6 4.5"/></svg></span><strong id="dashboardTotalPatients">-</strong><span>Ú©Ù„ Ø¨ÛŒÙ…Ø§Ø±Ø§Ù†</span></div>
        <div class="dashboard-summary-card metric-green"><span class="dashboard-metric-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8 12.4 2.6 2.6L16 9.6"/></svg></span><strong id="dashboardActivePatients">-</strong><span>Ø¨ÛŒÙ…Ø§Ø±Ø§Ù† ÙØ¹Ø§Ù„</span></div>
      </div>
      <h3 class="dashboard-group-title">Ø§Ù…Ø±ÙˆØ²</h3>
      <div class="dashboard-summary-grid dashboard-today-grid">
        <div class="dashboard-summary-card today-card today-patients"><strong id="dashboardPatientsToday">-</strong><span>Ø¨ÛŒÙ…Ø§Ø±Ø§Ù† Ø§Ù…Ø±ÙˆØ²</span></div>
        <div class="dashboard-summary-card today-card today-studies"><strong id="dashboardStudiesToday">-</strong><span>Ù…Ø·Ø§Ù„Ø¹Ø§Øª Ø§Ù…Ø±ÙˆØ²</span></div>
        <div class="dashboard-summary-card today-card today-new"><strong id="dashboardNewPatientsToday">-</strong><span>Ø¨ÛŒÙ…Ø§Ø±Ø§Ù† Ø¬Ø¯ÛŒØ¯ Ø§Ù…Ø±ÙˆØ²</span></div>
      </div>
      <section id="dashboardAttentionPanel" class="dashboard-panel dashboard-attention-panel hidden">
        <div class="dashboard-panel-title">
          <strong>Ù†ÛŒØ§Ø²Ù…Ù†Ø¯ Ø§Ø·Ù„Ø§Ø¹â€ŒØ±Ø³Ø§Ù†ÛŒ</strong>
          <span id="attentionSummary">-</span>
        </div>
        <div id="dashboardAttention" class="attention-list"></div>
      </section>
      <div class="dashboard-detail-grid">
        <section class="dashboard-panel"><div class="dashboard-panel-title"><strong>Ø¢Ø®Ø±ÛŒÙ† Ù…Ø±Ø§Ø¬Ø¹Ø§Øª</strong><span>Ûµ Ù…ÙˆØ±Ø¯ Ø§Ø®ÛŒØ±</span></div><div id="dashboardRecentStudies" class="dashboard-recent-list"></div></section>
      </div>
      <section id="dashboardStoragePanel" class="dashboard-storage-panel hidden">
        <div class="dashboard-storage-head"><strong>ÙØ¶Ø§ÛŒ Ù…Ø­Ù„ Ù†Ú¯Ù‡Ø¯Ø§Ø±ÛŒ ØªØµØ§ÙˆÛŒØ±</strong><code id="dashboardStoragePath">-</code></div>
        <div class="dashboard-storage-bar"><i id="dashboardStorageFill"></i></div>
        <div class="dashboard-storage-legend">
          <span>Ø§Ø³ØªÙØ§Ø¯Ù‡â€ŒØ´Ø¯Ù‡: <b id="dashboardStorageUsed">-</b></span>
          <span>Ø¢Ø²Ø§Ø¯: <b id="dashboardStorageFree">-</b></span>
          <span>Ú©Ù„: <b id="dashboardStorageTotal">-</b></span>
          <span id="dashboardStoragePct"></span>
        </div>
      </section>`;
    main.appendChild(dashboard);

    const settings = document.createElement("section");
    settings.id = "settingsSection";
    settings.className = "card hidden shell-page";
    settings.innerHTML = `
      <div class="section-header"><div><h2>ØªÙ†Ø¸ÛŒÙ…Ø§Øª Ùˆ Ù…Ø¯ÛŒØ±ÛŒØª Ø³ÛŒØ³ØªÙ…</h2><p>ØªØ¹Ø§Ø±ÛŒÙ Ù¾Ø§ÛŒÙ‡ Ùˆ Ø¯Ø³ØªØ±Ø³ÛŒâ€ŒÙ‡Ø§ÛŒ Ù…Ø¯ÛŒØ±ÛŒØªÛŒ ReSiRai</p></div></div>
      <div id="settingsAdminActions" class="settings-admin-actions"></div>`;
    main.appendChild(settings);

    // Â«Ú¯Ø²Ø§Ø±Ø´â€ŒÙ‡Ø§Â» Ø¯ÛŒÚ¯Ø± placeholder Ù†ÛŒØ³Øª: Ù…Ø§Ú˜ÙˆÙ„Ù reports-ui.js ØµÙØ­Ù‡Ù” ÙˆØ§Ù‚Ø¹ÛŒ Ø±Ø§ Ù…ÛŒâ€ŒØ³Ø§Ø²Ø¯.
    const placeholders = {};
    const placeholderSections = {};
    Object.entries(placeholders).forEach(([name, [title, description]]) => {
        const section = document.createElement("section");
        section.id = `${name}WorkspaceSection`;
        section.className = "card hidden shell-page";
        section.innerHTML = `<div class="section-header"><div><h2>${title}</h2><p>${description}</p></div></div><div class="shell-empty-state">Ø§ÛŒÙ† Ø¨Ø®Ø´ Ø¯Ø± Ù…Ø±Ø­Ù„Ù‡Ù” Ø¨Ø¹Ø¯ ØªÚ©Ù…ÛŒÙ„ Ù…ÛŒâ€ŒØ´ÙˆØ¯.</div>`;
        main.appendChild(section);
        placeholderSections[name] = section;
    });

    function moveAdministrativeButtons() {
        const target = document.getElementById("settingsAdminActions");
        const administrativeLabels = new Set(["Ù…Ø¯ÛŒØ±ÛŒØª Ù¾Ø±Ø³Ù†Ù„", "Ù…Ø¯ÛŒØ±ÛŒØª ØªØ®ØµØµâ€ŒÙ‡Ø§", "Ù…Ø¯ÛŒØ±ÛŒØª Ø§Ù†ÙˆØ§Ø¹ Study", "Ù…Ø¯ÛŒØ±ÛŒØª Ø§Ù†ÙˆØ§Ø¹ ØªØµÙˆÛŒØ±", "Ù…Ø¯ÛŒØ±ÛŒØª Ú©Ø§Ø±Ø¨Ø±Ø§Ù†"]);
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
                dashboardTotalPatients: overall.totalPatients,
                dashboardActivePatients: overall.activePatients,
                dashboardPatientsToday: today.patientsToday,
                dashboardStudiesToday: today.studiesToday,
                dashboardNewPatientsToday: today.newPatientsToday
            };
            // Show a dash instead of a misleading 0 when the database is unreachable.
            Object.entries(values).forEach(([id, value]) => {
                const el = document.getElementById(id);
                if (!el) return;
                el.textContent = connected ? (value ?? 0) : "â€”";
                // Cards that track "today" turn green once they have activity.
                const card = el.closest(".dashboard-summary-card");
                if (card?.classList.contains("today-card")) {
                    card.classList.toggle("has-value", connected && Number(value) > 0);
                }
            });
            renderRecentStudies(connected ? (result.recentStudies || []) : []);
            renderStorage(connected ? (result.system?.storage || {}) : {});
            loadAttention();
        } catch {
            if (silent) return; // keep the last good snapshot on a background refresh
            dashboard.querySelectorAll(".dashboard-summary-card strong").forEach(x => x.textContent = "-");
            document.getElementById("dashboardRecentStudies").textContent = "Ø¯Ø±ÛŒØ§ÙØª Ø§Ø·Ù„Ø§Ø¹Ø§Øª Ø¯Ø§Ø´Ø¨ÙˆØ±Ø¯ Ù†Ø§Ù…ÙˆÙÙ‚ Ø¨ÙˆØ¯.";
        }
    }

    const formatBytes = value => {
        const n = Number(value);
        if (!Number.isFinite(n)) return "-";
        if (n < 1073741824) return `${Math.round(n / 1048576).toLocaleString("fa-IR")} Ù…Ú¯Ø§Ø¨Ø§ÛŒØª`;
        return `${(n / 1073741824).toLocaleString("fa-IR", { maximumFractionDigits: 1 })} Ú¯ÛŒÚ¯Ø§Ø¨Ø§ÛŒØª`;
    };

    // ÙØ¶Ø§ÛŒ Ù…Ø­Ù„ Ù†Ú¯Ù‡Ø¯Ø§Ø±ÛŒ ØªØµØ§ÙˆÛŒØ±: ÙÙ‚Ø· ÙˆÙ‚ØªÛŒ Ù…Ø³ÛŒØ± Ø¯Ø± Ø¯Ø³ØªØ±Ø³ Ø§Ø³Øª Ù†Ù…Ø§ÛŒØ´ Ø¯Ø§Ø¯Ù‡ Ù…ÛŒâ€ŒØ´ÙˆØ¯
    // (Ø±ÙˆÛŒ Ù†ØµØ¨Ù Ø¯Ø³Ú©ØªØ§Ù¾ÛŒ Ù‡Ù…Ø§Ù† Ø¯ÛŒØ³Ú©Ù Ú©Ø§Ù…Ù¾ÛŒÙˆØªØ±Ù Ù…Ø·Ø¨ Ø§Ø³Øª).
    function renderStorage(storage) {
        const panel = document.getElementById("dashboardStoragePanel");
        if (!panel) return;
        const total = Number(storage?.totalBytes);
        const free = Number(storage?.freeBytes);
        if (!storage?.available || !Number.isFinite(total) || total <= 0) {
            panel.classList.add("hidden");
            return;
        }
        const used = Math.max(0, total - (Number.isFinite(free) ? free : 0));
        const pct = Math.min(100, Math.max(0, Math.round((used / total) * 100)));
        document.getElementById("dashboardStoragePath").textContent = storage.rootPath || "-";
        document.getElementById("dashboardStorageUsed").textContent = formatBytes(used);
        document.getElementById("dashboardStorageFree").textContent = formatBytes(free);
        document.getElementById("dashboardStorageTotal").textContent = formatBytes(total);
        document.getElementById("dashboardStoragePct").textContent = `${pct.toLocaleString("fa-IR")}Ùª Ø§Ø³ØªÙØ§Ø¯Ù‡`;
        const fill = document.getElementById("dashboardStorageFill");
        fill.style.width = `${pct}%`;
        fill.style.background = pct >= 90 ? "#ef4444" : pct >= 70 ? "#f59e0b" : "linear-gradient(90deg,#22c55e,#16a34a)";
        panel.classList.remove("hidden");
    }

    // Who needs a message today, gathered from appointments, due follow-ups and
    // outstanding balances. Nothing is sent from here automatically; each row has a
    // button that opens the messaging dialog with the right template.
    async function loadAttention() {
        const root = document.getElementById("dashboardAttention");
        const summary = document.getElementById("attentionSummary");
        const panel = document.getElementById("dashboardAttentionPanel");
        if (!root) return;
        root.textContent = "Ø¯Ø± Ø­Ø§Ù„ Ø¨Ø±Ø±Ø³ÛŒ...";
        try {
            const r = await fetch("/api/attention", { cache: "no-store" });
            const x = await r.json();
            if (!r.ok || !x.success) throw new Error();

            const rows = []
                .concat((x.appointments || []).map(i => ({ ...i, kindLabel: "Ù†ÙˆØ¨Øª Ù¾ÛŒØ´â€ŒØ±Ùˆ" })))
                .concat((x.followUps || []).map(i => ({ ...i, kindLabel: "Ù¾ÛŒÚ¯ÛŒØ±ÛŒ Ø³Ø±Ø±Ø³ÛŒØ¯Ù‡" })))
                .concat((x.balances || []).map(i => ({ ...i, kindLabel: "Ù…Ø§Ù†Ø¯Ù‡ Ø­Ø³Ø§Ø¨" })));

            summary.textContent = rows.length ? `${rows.length} Ù…ÙˆØ±Ø¯` : "Ù…ÙˆØ±Ø¯ÛŒ Ù†ÛŒØ³Øª";
            root.replaceChildren();
            // Â«Ù†ÛŒØ§Ø²Ù…Ù†Ø¯ Ø§Ø·Ù„Ø§Ø¹â€ŒØ±Ø³Ø§Ù†ÛŒÂ» ÙÙ‚Ø· ÙˆÙ‚ØªÛŒ Ù…ÙˆØ±Ø¯ÛŒ Ù‡Ø³Øª Ù†Ù…Ø§ÛŒØ´ Ø¯Ø§Ø¯Ù‡ Ù…ÛŒâ€ŒØ´ÙˆØ¯.
            panel?.classList.toggle("hidden", !rows.length);
            if (!rows.length) {
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
                    ? `${item.kindLabel} â€” ${Number(item.balance || 0).toLocaleString("fa-IR")} ØªÙˆÙ…Ø§Ù†`
                    : `${item.kindLabel} â€” ${item.dueDate ? formatPersianDateTime(item.dueDate) : ""}`;
                text.append(name, meta);
                const send = document.createElement("button");
                send.type = "button";
                send.className = "attention-send";
                send.textContent = "Ø§Ø±Ø³Ø§Ù„ Ù¾ÛŒØ§Ù…Ú©";
                send.onclick = () => openAttentionMessage(item);
                row.append(text, send);
                root.appendChild(row);
            });
        } catch {
            panel?.classList.add("hidden");
            if (summary) summary.textContent = "-";
            root.textContent = "";
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
        // ReSiRai Ø§Ú©Ù†ÙˆÙ† Ø±ÙˆÛŒ Ø³Ø±ÙˆØ± Ø§Ø¨Ø±ÛŒ Ø§Ø¬Ø±Ø§ Ù…ÛŒâ€ŒØ´ÙˆØ¯Ø› Ø¨Ø®Ø´ Ø¯Ø³ØªØ±Ø³ÛŒ Ø´Ø¨Ú©Ù‡ Ø­Ø°Ù Ø´Ø¯Ù‡ Ø§Ø³Øª.
    }
    function renderSettingsNetworkLinks(network) {
        latestNetwork = network;
        // Ø¨Ø®Ø´ Ø¯Ø³ØªØ±Ø³ÛŒ Ø´Ø¨Ú©Ù‡ Ø§Ø² ØªÙ†Ø¸ÛŒÙ…Ø§Øª Ø­Ø°Ù Ø´Ø¯Ù‡ Ø§Ø³ØªØ› Ø§ÛŒÙ† ØªØ§Ø¨Ø¹ ÙÙ‚Ø· Ø­Ø§ÙØ¸Ù‡Ù” Ø¢Ø®Ø±ÛŒÙ† ÙˆØ¶Ø¹ÛŒØª Ø±Ø§ Ù†Ú¯Ù‡ Ù…ÛŒâ€ŒØ¯Ø§Ø±Ø¯.
    }

    // IP Ø¹Ù…ÙˆÙ…ÛŒ Ù‡Ù…Ø§Ù† Ø¹Ø¯Ø¯ÛŒ Ø§Ø³Øª Ú©Ù‡ Ú©Ø§ÙˆÙ‡â€ŒÙ†Ú¯Ø§Ø± Ù‡Ù†Ú¯Ø§Ù… Ø§Ø±Ø³Ø§Ù„ Ù¾ÛŒØ§Ù…Ú© Ù…ÛŒâ€ŒØ¨ÛŒÙ†Ø¯. Ú†ÙˆÙ† IP
    // Ù…Ø·Ø¨ Ù…Ø¹Ù…ÙˆÙ„Ø§Ù‹ Ø¯Ø§ÛŒÙ†Ø§Ù…ÛŒÚ© Ø§Ø³ØªØŒ Ù†Ù…Ø§ÛŒØ´ Ù‡Ù…ÛŒÙ†â€ŒØ¬Ø§ Ú©Ù†Ø§Ø± Ù„ÛŒÙ†Ú©â€ŒÙ‡Ø§ÛŒ Ø§Ø¬Ø±Ø§ Ø¨Ø§Ø¹Ø« Ù…ÛŒâ€ŒØ´ÙˆØ¯
    // ÙˆÙ‚ØªÛŒ Ø§Ø² Ù…Ø­Ø¯ÙˆØ¯Ù‡Ù” Ø«Ø¨Øªâ€ŒØ´Ø¯Ù‡ Ø¯Ø± Ù¾Ù†Ù„ Ú©Ø§ÙˆÙ‡â€ŒÙ†Ú¯Ø§Ø± Ø¨ÛŒØ±ÙˆÙ† Ø±ÙØªØŒ Ù‡Ù…Ø§Ù† Ø§ÙˆÙ„ Ø¯ÛŒØ¯Ù‡ Ø´ÙˆØ¯.
    function createPublicIpRow() {
        const row = document.createElement("div");
        row.className = "dashboard-access-row";
        const title = document.createElement("span");
        title.textContent = "Ø¢ÛŒâ€ŒÙ¾ÛŒ Ø¹Ù…ÙˆÙ…ÛŒ Ø§ÛŒÙ†ØªØ±Ù†Øª";
        const value = document.createElement("code");
        value.className = "dashboard-access-ip";
        value.textContent = "Ø¯Ø± Ø­Ø§Ù„ Ø¯Ø±ÛŒØ§ÙØª...";
        const copy = document.createElement("button");
        copy.type = "button"; copy.className = "secondary-button"; copy.textContent = "Ú©Ù¾ÛŒ";
        copy.onclick = async () => {
            try { await navigator.clipboard.writeText(value.textContent); copy.textContent = "Ú©Ù¾ÛŒ Ø´Ø¯"; setTimeout(() => copy.textContent = "Ú©Ù¾ÛŒ", 1500); }
            catch { window.prompt("Ø¢ÛŒâ€ŒÙ¾ÛŒ Ø±Ø§ Ú©Ù¾ÛŒ Ú©Ù†ÛŒØ¯:", value.textContent); }
        };
        const refresh = document.createElement("button");
        refresh.type = "button"; refresh.className = "secondary-button"; refresh.textContent = "ØªØ§Ø²Ù‡â€ŒØ³Ø§Ø²ÛŒ";
        const hint = document.createElement("small");
        hint.textContent = "Ú©Ø§ÙˆÙ‡â€ŒÙ†Ú¯Ø§Ø± Ù¾ÛŒØ§Ù…Ú© Ø±Ø§ ÙÙ‚Ø· Ø§Ø² IP Ù‡Ø§ÛŒ Ø«Ø¨Øªâ€ŒØ´Ø¯Ù‡ Ø¯Ø± Â«ØªÙ†Ø¸ÛŒÙ…Ø§Øª â† ØªÙ†Ø¸ÛŒÙ…Ø§Øª Ø¢ÛŒâ€ŒÙ¾ÛŒ Ù…Ø¬Ø§Ø² â† ÙˆØ¨â€ŒØ³Ø±ÙˆÛŒØ³Â» Ù…ÛŒâ€ŒÙ¾Ø°ÛŒØ±Ø¯Ø› Ø§Ú¯Ø± Ø§ÛŒÙ† Ø¹Ø¯Ø¯ Ø§Ø² Ù…Ø­Ø¯ÙˆØ¯Ù‡Ù” Ø«Ø¨Øªâ€ŒØ´Ø¯Ù‡ Ø¨ÛŒØ±ÙˆÙ† Ø±ÙØªØŒ Ù¾ÛŒØ§Ù…Ú© Ø§Ø±Ø³Ø§Ù„ Ù†Ù…ÛŒâ€ŒØ´ÙˆØ¯.";
        row.append(title, value, copy, refresh, hint);

        const load = async () => {
            value.textContent = "Ø¯Ø± Ø­Ø§Ù„ Ø¯Ø±ÛŒØ§ÙØª...";
            refresh.disabled = true;
            try {
                const r = await fetch("/api/communications/public-ip", { cache: "no-store" });
                // Ù¾Ø§Ø³Ø® 401/403 Ø¨Ø¯Ù†Ù‡Ù” Ø®Ø§Ù„ÛŒ Ø¯Ø§Ø±Ø¯Ø› Ø§Ú¯Ø± JSON Ù†Ø¨ÙˆØ¯ Ù†Ø¨Ø§ÛŒØ¯ Ú©Ù„ Ø¨Ø§Ø±Ú¯Ø°Ø§Ø±ÛŒ Ø¨ØªØ±Ø³Ø¯.
                let d = {}; try { d = await r.json(); } catch { d = {}; }
                value.textContent = r.ok && d.success
                    ? d.ip
                    : (d.message || ((r.status === 401 || r.status === 403) ? "Ù†ÛŒØ§Ø² Ø¨Ù‡ Ø¯Ø³ØªØ±Ø³ÛŒ Ù…Ø¯ÛŒØ± Ø³ÛŒØ³ØªÙ…" : "Ø¯Ø±ÛŒØ§ÙØª IP Ù…Ù…Ú©Ù† Ù†Ø´Ø¯"));
            } catch { value.textContent = "Ø§Ø±ØªØ¨Ø§Ø· Ø¨Ø§ Ø³Ø±ÙˆØ± Ø¨Ø±Ù‚Ø±Ø§Ø± Ù†Ø´Ø¯."; }
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
        const copy = document.createElement("button"); copy.type = "button"; copy.className = "secondary-button"; copy.textContent = "Ú©Ù¾ÛŒ";
        copy.onclick = async () => { try { await navigator.clipboard.writeText(url); copy.textContent = "Ú©Ù¾ÛŒ Ø´Ø¯"; setTimeout(() => copy.textContent = "Ú©Ù¾ÛŒ", 1500); } catch { window.prompt("Ù„ÛŒÙ†Ú© Ø±Ø§ Ú©Ù¾ÛŒ Ú©Ù†ÛŒØ¯:", url); } };
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
            box.innerHTML = code.createSvgTag({ cellSize: 4, margin: 16, scalable: true, alt: `Ú©ÛŒÙˆÚ©Ø¯ Ù„ÛŒÙ†Ú© ${label}` });
            const hint = document.createElement("small");
            hint.textContent = "Ø¨Ø±Ø§ÛŒ Ø¨Ø§Ø² Ú©Ø±Ø¯Ù† ReSiRai Ø±ÙˆÛŒ Ù…ÙˆØ¨Ø§ÛŒÙ„ØŒ Ø¯ÙˆØ±Ø¨ÛŒÙ† Ø±Ø§ Ø±ÙˆÛŒ Ø§ÛŒÙ† Ú©Ø¯ Ø¨Ú¯ÛŒØ±ÛŒØ¯. Ø¨Ø±Ø§ÛŒ Ø§Ø³Ú©Ù† Ø¢Ø³Ø§Ù†â€ŒØªØ±ØŒ Ø±ÙˆÛŒ Ú©Ø¯ Ú©Ù„ÛŒÚ© Ú©Ù†ÛŒØ¯.";
            box.append(hint);
            box.tabIndex = 0;
            box.setAttribute("role", "button");
            box.setAttribute("aria-label", `Ø¨Ø²Ø±Ú¯â€ŒÙ†Ù…Ø§ÛŒÛŒ Ú©ÛŒÙˆØ¢Ø±Ú©Ø¯ ${label}`);
            return box;
        } catch {
            // A broken QR must never take the dashboard down; the plain link stays.
            return null;
        }
    }

    // Ø¨Ø²Ø±Ú¯â€ŒÙ†Ù…Ø§ÛŒÛŒ Ù‡Ù…Ù‡Ù” Ú©ÛŒÙˆØ¢Ø±Ú©Ø¯Ù‡Ø§ÛŒ Ø¨Ø±Ù†Ø§Ù…Ù‡ â€” Ù„ÛŒÙ†Ú©â€ŒÙ‡Ø§ÛŒ Ø§Ø¬Ø±Ø§ØŒ Ø¬ÙØªâ€ŒØ³Ø§Ø²ÛŒØŒ Ø¯Ø§Ù†Ù„ÙˆØ¯ Ùˆ
    // Ø¯Ø±ÛŒØ§ÙØª ØªØµÙˆÛŒØ±. Ø¨Ø§ ÛŒÚ© Ø´Ù†ÙˆÙ†Ø¯Ù‡Ù” Ø³Ø±Ø§Ø³Ø±ÛŒØŒ Ù¾Ù†Ø¬Ø±Ù‡â€ŒÙ‡Ø§ÛŒÛŒ Ú©Ù‡ Ø¨Ø¹Ø¯Ø§Ù‹ Ø³Ø§Ø®ØªÙ‡ Ù…ÛŒâ€ŒØ´ÙˆÙ†Ø¯ Ù‡Ù…
    // Ø®ÙˆØ¯Ú©Ø§Ø± Ù¾ÙˆØ´Ø´ Ø¯Ø§Ø¯Ù‡ Ù…ÛŒâ€ŒØ´ÙˆÙ†Ø¯ Ùˆ Ù„Ø§Ø²Ù… Ù†ÛŒØ³Øª Ù‡Ø± Ø¬Ø§ Ø¯ÙˆØ¨Ø§Ø±Ù‡ Ø³ÛŒÙ…â€ŒÚ©Ø´ÛŒ Ø´ÙˆØ¯.
    function attachQrZoomDelegation() {
        const findBox = (target) => (target && target.closest ? target.closest(".dashboard-access-qr, .pair-qr") : null);
        document.addEventListener("click", (e) => {
            const box = findBox(e.target);
            if (!box) return;
            const svg = box.querySelector("svg");
            if (!svg) return;
            const alt = (svg.getAttribute("alt") || "").replace(/^Ú©ÛŒÙˆÚ©Ø¯\s+|^Ú©ÛŒÙˆØ¢Ø±Ú©Ø¯\s+/, "");
            ReSiRaiQrZoom(box, alt);
        });
        document.addEventListener("keydown", (e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            const box = findBox(e.target);
            if (!box || !box.querySelector("svg")) return;
            e.preventDefault();
            ReSiRaiQrZoom(box, (box.querySelector("svg").getAttribute("alt") || "").replace(/^Ú©ÛŒÙˆÚ©Ø¯\s+|^Ú©ÛŒÙˆØ¢Ø±Ú©Ø¯\s+/, ""));
        });
    }
    attachQrZoomDelegation();

    // Ù†Ù…Ø§ÛŒ ØªÙ…Ø§Ù…â€ŒØµÙØ­Ù‡Ù” ÛŒÚ© Ú©ÛŒÙˆØ¢Ø±Ú©Ø¯Ø› Ù‡Ù…Ø§Ù† Ú©Ø¯ØŒ ÙÙ‚Ø· Ø¨Ø²Ø±Ú¯â€ŒØªØ± ØªØ§ Ù‡Ø± Ø¯ÙˆØ±Ø¨ÛŒÙ†ÛŒ Ø¨Ú¯ÛŒØ±Ø¯Ø´.
    function ReSiRaiQrZoom(box, label) {
        let overlay = document.getElementById("qrZoomOverlay");
        if (!overlay) {
            overlay = document.createElement("div");
            overlay.id = "qrZoomOverlay";
            overlay.className = "qr-zoom-overlay hidden";
            overlay.innerHTML =
                '<div class="qr-zoom-card">' +
                '<button class="modal-close-button" type="button" aria-label="Ø¨Ø³ØªÙ†">Ã—</button>' +
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
        body.replaceChildren(svg ? svg.cloneNode(true) : document.createTextNode("Ú©ÛŒÙˆØ¢Ø±Ú©Ø¯ Ø¯Ø± Ø¯Ø³ØªØ±Ø³ Ù†ÛŒØ³Øª."));
        overlay.querySelector(".qr-zoom-hint").textContent =
            `${label ? `Ú©ÛŒÙˆØ¢Ø±Ú©Ø¯ ${label} â€” ` : ""}Ú¯ÙˆØ´ÛŒ Ø±Ø§ Û±Û° ØªØ§ Û±Ûµ Ø³Ø§Ù†ØªÛŒâ€ŒÙ…ØªØ± Ø§Ø² ØµÙØ­Ù‡ ÙØ§ØµÙ„Ù‡ Ø¨Ø¯Ù‡ÛŒØ¯ Ùˆ Ø«Ø§Ø¨Øª Ù†Ú¯Ù‡ Ø¯Ø§Ø±ÛŒØ¯.`;
        overlay.classList.remove("hidden");
    }
    window.ReSiRaiQrZoom = ReSiRaiQrZoom;
    function renderRecentStudies(items) {
        const root = document.getElementById("dashboardRecentStudies"); root.replaceChildren();
        if (!items.length) { root.textContent = "Ù…Ø·Ø§Ù„Ø¹Ù‡â€ŒØ§ÛŒ Ø«Ø¨Øª Ù†Ø´Ø¯Ù‡ Ø§Ø³Øª."; return; }
        items.forEach(item => {
            const row = document.createElement("button");
            row.type = "button";
            row.className = "dashboard-recent-row dashboard-recent-clickable";
            row.title = "Ø¨Ø§Ø² Ú©Ø±Ø¯Ù† Ù¾Ø±ÙˆÙ†Ø¯Ù‡ Ø¨ÛŒÙ…Ø§Ø± Ùˆ Ù‡Ù…ÛŒÙ† Ù…Ø·Ø§Ù„Ø¹Ù‡";

            // Prefer a real thumbnail; fall back to the study icon when the study
            // has no image (or only PDFs).
            const media = item.thumbnailImageID
                ? document.createElement("img")
                : document.createElement("span");
            media.className = "dashboard-recent-icon";
            if (item.thumbnailImageID) {
                media.src = `/api/radiologyimages/${item.thumbnailImageID}`;
                media.alt = ""; media.loading = "lazy";
                media.onerror = () => { media.removeAttribute("src"); media.textContent = "â–£"; };
            } else media.textContent = "â–£";

            const text = document.createElement("span");
            const name = document.createElement("strong");
            name.textContent = item.patientName;
            const meta = document.createElement("small");
            meta.textContent = `${item.studyTypeName}${item.bodyPart ? ` â€” ${item.bodyPart}` : ""}`;
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
        if (!items.length) { root.textContent = "ØªØµÙˆÛŒØ±ÛŒ Ø«Ø¨Øª Ù†Ø´Ø¯Ù‡ Ø§Ø³Øª."; return; }
        items.forEach(item => {
            const row = document.createElement("button");
            row.type = "button";
            row.className = "dashboard-recent-row dashboard-recent-clickable";
            row.title = item.contentType === "application/pdf" ? "Ø¨Ø§Ø² Ú©Ø±Ø¯Ù† PDF Ø¯Ø± ØªØ¨ Ø¬Ø¯ÛŒØ¯" : "Ù†Ù…Ø§ÛŒØ´ ØªØµÙˆÛŒØ± Ø¨Ø²Ø±Ú¯";

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
        // Ù†Ø§Ø­ÛŒÙ‡Ù” Â«Ù…Ø¹Ø±ÙÛŒÙ Ø¨ÛŒÙ…Ø§Ø±Â» (Ú©Ø¯Ù Ù…Ù„ÛŒ Ø§ÙˆÙ„) Ù‡Ù…ÛŒØ´Ù‡ Ø¨Ø§Ù„Ø§ÛŒÙ ÙÙ‡Ø±Ø³Øª Ø³ÙˆØ§Ø± Ø´ÙˆØ¯.
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
                empty.textContent = "Ø¨ÛŒÙ…Ø§Ø±ÛŒ Ø¨Ø§ Ø§ÛŒÙ† Ù…Ø´Ø®ØµØ§Øª ÛŒØ§ÙØª Ù†Ø´Ø¯.";
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
                    img.onerror = () => { img.remove(); avatar.textContent = "ðŸ‘¤"; };
                    avatar.appendChild(img);
                    const text = document.createElement("span");
                    text.className = "global-search-text";
                    const name = document.createElement("strong");
                    name.textContent = `${p.firstName || ""} ${p.lastName || ""}`.trim() || "-";
                    const meta = document.createElement("small");
                    meta.textContent = `${p.nationalCode || "-"}${p.mobile ? ` â€” ${p.mobile}` : ""}`;
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
        // Ú¯Ø²Ø§Ø±Ø´â€ŒÙ‡Ø§: Ø¯Ø³ØªØ±Ø³ÛŒ Ø¯Ø± Ø®ÙˆØ¯Ù Ù…Ø§Ú˜ÙˆÙ„ Ø¨Ø±Ø±Ø³ÛŒ Ù…ÛŒâ€ŒØ´ÙˆØ¯ (Ù…Ø¯ÛŒØ±Ù Ø³ÛŒØ³ØªÙ… ÛŒØ§ Ù¾Ø±Ú†Ù…Ù Ú¯Ø²Ø§Ø±Ø´â€ŒÙ‡Ø§).
        if (name === "reports") { dashboardVisible = false; stopDashboardAutoRefresh(); return window.ReSiRaiReports?.open(); }
        // Ù„Ø§Ú¯Ù Ø±ÙˆÛŒØ¯Ø§Ø¯Ù‡Ø§ ÙÙ‚Ø· Ø¨Ø±Ø§ÛŒ Ù…Ø¯ÛŒØ±Ù Ø³ÛŒØ³ØªÙ… Ø§Ø³ØªØ› Ù…Ø§Ú˜ÙˆÙ„Ù Ø®ÙˆØ¯Ø´ Ø¯Ø³ØªØ±Ø³ÛŒ Ø±Ø§ Ø¨Ø±Ø±Ø³ÛŒ Ù…ÛŒâ€ŒÚ©Ù†Ø¯.
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
