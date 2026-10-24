// آزمایشاتِ مراجعه — هر «آزمایش» یک گزارشِ آزمایشگاه است: یک یا چند صفحه که
// یکجا استخراج شده‌اند + فیلدهای استخراج‌شده‌اش (هموگلوبین و …). آزمایش مثلِ
// تصویرِ رادیولوژی یک «سندِ» پیوست‌شده به مراجعه است — نه اقدام، نه مالی، و
// هیچ ارتباطی بینِ آزمایش و اقدام نیست. پزشک در صورتِ نیاز می‌بیندش.
// هر ردیف با تکهٔ خودِ برگه (crop) قابلِ راستی‌آزمایی است؛ هیچ عددی این‌جا
// ساخته نمی‌شود — وضعیتِ هر ردیف از «بازهٔ چاپ‌شده» خوانده می‌شود.
(() => {
  "use strict";

  const api = async (url) => {
    const r = await fetch(url);
    let x = {};
    try { x = await r.json(); } catch {}
    if (!r.ok || x.success === false) throw new Error(x.message || `خطای آزمایشات (HTTP ${r.status})`);
    return x;
  };

  const faNum = (v) => Number(v).toLocaleString("fa-IR");
  const faDate = (v) => {
    if (!v) return "—";
    const d = new Date(v);
    return isNaN(d.getTime()) ? String(v).slice(0, 10) : d.toLocaleDateString("fa-IR");
  };

  // وضعیتِ هر ردیف در برابرِ «بازهٔ چاپ‌شده» (همان چیزی که در جدولِ برگه دیده
  // می‌شود). ممیز/تبدیلِ مقیاس این‌جا رخ نمی‌دهد؛ فقط مقایسهٔ عددیِ سرراست.
  function rangeState(f) {
    const v = Number(String(f.value).replace(/[^\d.\-]/g, ""));
    if (!Number.isFinite(v) || f.refLow == null || f.refHigh == null) return { text: "—", kind: "none" };
    if (v > Number(f.refHigh)) return { text: "بالاتر از بازه", kind: "high" };
    if (v < Number(f.refLow)) return { text: "پایین‌تر از بازه", kind: "low" };
    return { text: "در بازه", kind: "ok" };
  }

  function fieldRow(test, f) {
    const tr = document.createElement("tr");
    tr.className = "labtest-row";
    tr.tabIndex = 0;
    const st = rangeState(f);
    const name = document.createElement("td");
    name.textContent = f.name;
    if (f.section) {
      const sec = document.createElement("small");
      sec.className = "labtest-section";
      sec.textContent = f.section;
      name.append(document.createElement("br"), sec);
    }
    const value = document.createElement("td");
    value.className = "labtest-value";
    value.textContent = f.value;
    const unit = document.createElement("td");
    unit.textContent = f.unit || "—";
    const ref = document.createElement("td");
    ref.textContent = f.refText || "—";
    const state = document.createElement("td");
    const em = document.createElement("em");
    em.className = "labtest-state is-" + st.kind;
    em.textContent = st.text;
    state.append(em);
    const conf = document.createElement("td");
    conf.textContent = f.confidence > 0 ? "٪" + faNum(f.confidence) : "—";
    tr.append(name, value, unit, ref, state, conf);

    // تکهٔ برگه: هر ادعای استخراج با تکهٔ خودِ سند قابلِ راستی‌آزمایی است.
    const ev = document.createElement("tr");
    ev.className = "labtest-evidence hidden";
    const td = document.createElement("td");
    td.colSpan = 6;
    const img = document.createElement("img");
    img.loading = "lazy";
    img.alt = "تکهٔ برگه — " + f.name;
    img.src = `/api/ai/images/crop?extractionID=${encodeURIComponent(test.extractionID)}&row=${encodeURIComponent(f.row)}`;
    td.append(img);
    ev.append(td);

    const toggle = () => ev.classList.toggle("hidden");
    tr.addEventListener("click", toggle);
    tr.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });
    return [tr, ev];
  }

  function renderTests(host, tests) {
    const list = host.querySelector('[data-list="labtests"]');
    if (!list) return;
    const chip = host.querySelector("[data-labtests-summary]");
    const totalFields = tests.reduce((s, t) => s + (t.fields?.length || 0), 0);
    // بدونِ آزمایش، کلِ این بخش دیده نمی‌شود؛ فقط وقتی داده هست ظاهر می‌شود.
    if (!tests.length) {
      host.classList.add("hidden");
      list.replaceChildren();
      if (chip) chip.textContent = "";
      const descEmpty = host.querySelector("[data-labtests-desc]");
      if (descEmpty) descEmpty.textContent = "";
      return;
    }
    host.classList.remove("hidden");
    if (chip) {
      chip.textContent = `${faNum(tests.length)} آزمایش · ${faNum(totalFields)} فیلد`;
    }
    const descEl = host.querySelector("[data-labtests-desc]");
    if (descEl) {
      const text = tests.map((t) => t.labName || "گزارشِ آزمایشگاه").join(" — ");
      descEl.textContent = text;
      descEl.title = text;
    }
    list.replaceChildren();
    tests.forEach((t) => {
      const card = document.createElement("article");
      card.className = "labtest-card";
      const head = document.createElement("header");
      head.className = "labtest-head";
      const name = document.createElement("strong");
      name.textContent = t.labName || "گزارشِ آزمایشگاه";
      const meta = document.createElement("span");
      meta.className = "labtest-meta";
      meta.textContent = `${faDate(t.sampleDate || t.createdDate)} · ${faNum(t.pageCount || 1)} صفحه · ${faNum((t.fields || []).length)} فیلد`;
      head.append(name, meta);

      const table = document.createElement("table");
      table.className = "labtest-table";
      table.innerHTML = "<thead><tr><th>آزمون</th><th>مقدار</th><th>واحد</th><th>بازهٔ چاپ‌شده</th><th>وضعیت</th><th>ضریبِ اطمینان</th></tr></thead>";
      const tbody = document.createElement("tbody");
      (t.fields || []).forEach((f) => tbody.append(...fieldRow(t, f)));
      table.append(tbody);
      card.append(head, table);
      list.append(card);
    });
  }

  function createPanel(studyID) {
    const root = document.createElement("section");
    root.className = "study-labtests hidden";
    root.dataset.studyId = String(studyID);

    const head = document.createElement("button");
    head.type = "button";
    head.className = "study-labtests-head";
    head.setAttribute("aria-expanded", "true");
    const arrow = document.createElement("span");
    arrow.className = "study-labtests-arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "^";
    const title = document.createElement("strong");
    title.textContent = "آزمایشات این مراجعه";
    const descLine = document.createElement("span");
    descLine.className = "study-labtests-desc";
    descLine.dataset.labtestsDesc = "";
    const chip = document.createElement("span");
    chip.className = "study-labtests-chip";
    chip.dataset.labtestsSummary = "";
    chip.textContent = "در حال خواندن…";
    head.append(arrow, title, descLine, chip);

    const body = document.createElement("div");
    body.className = "study-labtests-body";
    const list = document.createElement("div");
    list.dataset.list = "labtests";
    const status = document.createElement("div");
    status.className = "study-labtests-status";
    body.append(list, status);
    root.append(head, body);

    const setOpen = (open) => {
      body.classList.toggle("hidden", !open);
      root.classList.toggle("is-collapsed", !open);
      head.setAttribute("aria-expanded", open ? "true" : "false");
      arrow.textContent = open ? "^" : "v";
    };
    head.addEventListener("click", () => setOpen(body.classList.contains("hidden")));
    return root;
  }

  async function load(root) {
    const status = root.querySelector(".study-labtests-status");
    try {
      const x = await api(`/api/ai/images/lab-tests?studyID=${encodeURIComponent(root.dataset.studyId)}`);
      renderTests(root, x.tests || []);
      if (status) status.textContent = "";
    } catch (e) {
      if (status) { status.textContent = e.message; status.classList.add("error"); }
    }
  }

  function enhance() {
    document.querySelectorAll(".study-scroll-card").forEach((card) => {
      if (card.dataset.labTestsReady) return;
      card.dataset.labTestsReady = "1";
      const panel = createPanel(Number(card.dataset.studyId));
      const body = card.querySelector(".study-scroll-body");
      if (body) {
        // جانمایی: بعد از پنلِ مالی/اقدامات و درست پیش از تصاویر. آزمایش سند
        // است، مثلِ تصویرِ رادیولوژی — پس کنارِ تصاویر می‌نشیند.
        const place = () => {
          const imgs = body.querySelector(".study-scroll-images");
          // جانمایی فقط «بعد از تصاویر» است. داخلِ بازهٔ «اقدامات ← مالی ←
          // تصاویر» دست نمی‌زنیم: observerِ study-finance آن بازه را مرتب نگه
          // می‌دارد و هر جابه‌جاییِ متقابل، حلقهٔ بی‌نهایتِ MutationObserver
          // می‌ساخت (همان گیرِ «در حال دریافت اطلاعات…» هنگامِ بازکردنِ بیمار).
          if (imgs) {
            if (panel.previousElementSibling !== imgs) imgs.after(panel);
          } else if (panel.parentElement !== body) {
            body.appendChild(panel);
          }
        };
        place();
        new MutationObserver(place).observe(body, { childList: true });
      } else {
        card.append(panel);
      }
      load(panel);
    });
  }

  const observer = new MutationObserver(enhance);
  const host = document.getElementById("studiesContainer");
  if (host) observer.observe(host, { childList: true, subtree: true });
  window.addEventListener("resirai-lab-tests-changed", (e) => {
    const studyID = Number(e.detail?.studyID) || 0;
    document.querySelectorAll(".study-labtests").forEach((panel) => {
      if (!studyID || Number(panel.dataset.studyId) === studyID) load(panel);
    });
  });
  enhance();
})();
