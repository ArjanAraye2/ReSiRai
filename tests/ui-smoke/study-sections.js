// بخش‌هایِ مراجعه — پورتِ منطقِ UI از docs/design/gp-visit-proto.html
//
// هر مراجعه (tblRadiologyStudies) یک فهرستِ «بخش» دارد: شکایت و آنامنز، علائمِ
// حیاتی، معاینهٔ عمومی، ارزیابیِ فشارخون و قند (تکرارپذیر)، سبکِ زندگی،
// غربالگری + سه بخشِ پیوندی (آزمایش/تصویر/اسناد) و شش بخشِ افزودنی از «+ بخشِ دیگر».
//
// قواعدِ محصول (همان‌هایی که روی کاغذ توافق شد):
//   • تیک‌محور: چیپ‌ها تک‌انتخابی‌اند و کلیکِ دوباره = لغو؛ چک‌لیست‌ها چندانتخابی.
//   • بدونِ مقدارِ پیش‌فرض؛ ذخیره فقط با «تأیید و ثبت»؛ ناقص‌ها پیامِ «لطفاً تکمیل کنید» می‌گیرند.
//   • فقط یک بخش در هر لحظه باز است.
//   • تکرارپذیرها «+ نمونهٔ دیگر» و «🔁 تکرارِ اندازهٔ قبلی» با برچسبِ منبعِ «تکرارشده» دارند.
//   • هر فیلدِ متنی دکمهٔ میکروفون (دیکتهٔ fa-IR) و دکمهٔ ✕ دارد — هر دو داخلِ خودِ باکسِ متن،
//     و ✕ فقط وقتی متنی هست دیده می‌شود.
//   • ثبتِ دوباره همان بخش جایگزین می‌کند (upsert سمتِ سرور) — ردیفِ تکراری ساخته نمی‌شود.
//
// قراردادِ DataJson (پر شده توسط همین فایل؛ سرور کلیدها را نمی‌خواند):
//   { v:1, summary:"…", chips:{نام:مقدار}, checks:{نام:[…]}, texts:{کلید:متن},
//     numbers:{کلید:عدد}, rows:[{at,numbers,chips,texts,source}], systems:[{name,state,detail}],
//     screen:{آیتم:وضعیت}, links:[…] }
//   کلیدهایِ خالی اصلاً نوشته نمی‌شوند.
(() => {
  "use strict";

  /* پرچمِ «فیلدهای اضافه»: پارامترهایی که خارج از نمونهٔ تأییدشده به بخش‌ها
     اضافه شده‌اند. تا نمونهٔ تأیید نشود هیچ‌کدام رندر نمی‌شود؛ کدشان سرِ جایش
     می‌ماند و با true شدن همه برمی‌گردند. */
  const SHOW_EXTRA_FIELDS = false;

  /* ================= helpers ================= */

  const qsa = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const num = (v) => {
    const s = String(v == null ? "" : v).trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };
  const faNum = (v) => Number(v).toLocaleString("fa-IR");
  const nowLocal = () => {
    const d = new Date(), p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const grp = (root, name) => root.querySelector(`.gsec-chips[data-group="${name}"]`);
  const field = (root, key) => root.querySelector(`[data-k="${key}"]`);
  const value = (root, key) => String(field(root, key)?.value || "").trim();

  async function api(url, options) {
    const r = await fetch(url, options);
    let x = {};
    try { x = await r.json(); } catch { x = {}; }
    if (!r.ok || x.success === false) {
      const m = x.message || x.messageEn || x.error;
      if ((r.status === 401 || r.status === 403) && !m)
        throw new Error("نشست ورود شما پایان یافته است. لطفاً دوباره وارد شوید.");
      throw new Error(m || `خطای بخش‌های مراجعه (HTTP ${r.status})`);
    }
    return x;
  }

  const MIC_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V22h2v-3.08A7 7 0 0 0 19 12h-2z"/></svg>';

  /* ================= field factories ================= */

  // چیپ‌ها: تک‌انتخابی مگر data-multi — کلیکِ دوباره = لغوِ انتخاب.
  function chipGroup(name, options, opts = {}) {
    const wrap = el("div", "gsec-chips");
    wrap.dataset.group = name;
    if (opts.multi) wrap.dataset.multi = "1";
    if (opts.required) wrap.dataset.required = "1";
    if (opts.label) wrap.dataset.label = opts.label;
    if (opts.cls) wrap.classList.add(opts.cls);
    options.forEach((o) => {
      const b = el("button", "gsec-chip", o);
      b.type = "button";
      b.dataset.v = o;
      b.addEventListener("click", () => toggleChip(wrap, b));
      wrap.append(b);
    });
    return wrap;
  }

  function toggleChip(wrap, b) {
    if (wrap.dataset.multi) { b.classList.toggle("on"); return; }
    if (b.classList.contains("on")) { b.classList.remove("on"); delete wrap.dataset.v; return; }
    qsa(".gsec-chip", wrap).forEach((c) => c.classList.remove("on"));
    b.classList.add("on");
    wrap.dataset.v = b.dataset.v;
  }

  function setGroup(g, v) {
    if (!g) return;
    if (g.dataset.multi) {
      const set = new Set(Array.isArray(v) ? v : []);
      qsa(".gsec-chip", g).forEach((c) => c.classList.toggle("on", set.has(c.dataset.v)));
      return;
    }
    qsa(".gsec-chip", g).forEach((c) => c.classList.toggle("on", c.dataset.v === v));
    if (v) g.dataset.v = v; else delete g.dataset.v;
  }

  // عنوانِ فیلد؛ توضیحِ کوتاه (کلیدی/چک‌لیست/اختیاری) داخلِ خودِ عنوان می‌نشیند.
  function fieldLabel(label, hint) {
    const lab = el("label");
    lab.append(document.createTextNode(label));
    if (hint) lab.append(el("span", "gsec-hint", hint));
    return lab;
  }

  function numField(key, label, req, small) {
    const f = el("div", "gsec-field");
    const i = document.createElement("input");
    i.type = "number";
    i.inputMode = "decimal";
    i.className = "gsec-num" + (small ? " small" : "");
    i.dataset.k = key;
    i.dataset.num = "1";
    i.dataset.label = label;
    if (req) i.dataset.req = "1";
    f.append(fieldLabel(label, req ? " (کلیدی)" : ""), i);
    return f;
  }

  // هر فیلدِ متنی: باکسِ خودش میکروفون و ✕ را دارد.
  function txtField(key, label, req, placeholder) {
    const f = el("div", "gsec-field");
    if (label) f.append(fieldLabel(label, req ? " (کلیدی)" : ""));
    const box = el("span", "gsec-micbox");
    const i = document.createElement("input");
    i.type = "text";
    i.className = "gsec-txt";
    i.dataset.k = key;
    i.dataset.label = label || placeholder || "متن";
    i.placeholder = placeholder || "در صورتِ نیاز…";
    if (req) i.dataset.req = "1";
    box.append(i);
    attachTools(box, i);
    f.append(box);
    return f;
  }

  let __rec = null, __recBtn = null;
  function stopDictation() {
    if (__rec) { try { __rec.stop(); } catch { /* بی‌اثر */ } }
    if (__recBtn) __recBtn.classList.remove("on");
    __rec = null; __recBtn = null;
  }

  function attachTools(box, input) {
    const mic = el("button", "gsec-mic");
    mic.type = "button";
    mic.title = "دیکتهٔ صوتی";
    mic.innerHTML = MIC_SVG;
    mic.addEventListener("click", () => {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { mic.textContent = "⚠"; mic.title = "دیکته در این مرورگر پشتیبانی نمی‌شود"; return; }
      if (mic.classList.contains("on")) { stopDictation(); return; }
      stopDictation();
      const rec = new SR();
      rec.lang = "fa-IR";
      rec.interimResults = false;
      rec.continuous = false;
      rec.onresult = (e) => {
        const tx = e.results[0][0].transcript;
        input.value = (input.value ? input.value + " " : "") + tx;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      };
      rec.onerror = () => stopDictation();
      rec.onend = () => stopDictation();
      mic.classList.add("on");
      __rec = rec; __recBtn = mic;
      // فرمانِ صوتیِ برنامه همزمان میکروفون نگیرد (همان رویهٔ dictation.js).
      document.dispatchEvent(new CustomEvent("resirai-dictation-start"));
      try { rec.start(); } catch { stopDictation(); }
    });

    const clr = el("button", "gsec-clr", "✕");
    clr.type = "button";
    clr.title = "پاک‌کردنِ همه";
    const sync = () => { clr.style.display = input.value ? "flex" : "none"; };
    clr.addEventListener("click", () => {
      input.value = "";
      sync();
      input.focus();
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    input.addEventListener("input", sync);

    box.append(mic, clr);
    sync();
  }

  function footRow() {
    const f = el("div", "gsec-foot");
    const err = el("span", "gsec-err");
    err.dataset.err = "";
    const save = el("button", "gsec-btn primary", "تأیید و ثبت");
    save.type = "button";
    save.dataset.save = "1";
    const del = el("button", "gsec-btn ghost danger hidden", "حذفِ ثبت");
    del.type = "button";
    del.dataset.del = "1";
    f.append(err, save, del);
    return f;
  }

  /* ================= section builders ================= */

  const SYSTEMS = ["قلب", "ریه", "شکم", "عمومی/ظاهر", "عصبی", "پوست", "اسکلت‌عضله", "گوش‌حلق‌بینی", "چشم", "دهان", "ادراری/تناسلی", "روان‌وضعیت"];

  const SCREEN_ITEMS = ["فشارخون", "قند/دیابت", "چربی", "واکسیناسیون", "قد/وزن/BMI", "پاپ‌اسمیر", "ماموگرافی", "کلونوسکوپی", "PSA", "تیروئید", "کم‌خونی/آهن", "ویتامین D", "بینایی‌سنجی", "شنوایی", "سلامت روان", "اعتیاد", "خطر قلبی-عروقی", "پوست/خال‌ها", "هپاتیت B", "واکسن فصلی", "گلوکوم", "تعادل/سقوط", "سرطان دهان"];

  const SCREEN_STATES = ["انجام شده", "نیاز دارد", "انجام نشده"];

  const PHQ_OPTS = ["اصلاً", "چند روز", "بیشتر از روزها", "تقریباً هر روز"];

  function buildAnamnesis(body) {
    const f = el("div", "gsec-field");
    f.append(fieldLabel("شکایتِ اصلی", " (کلیدی — تیک یا متن)"));
    f.append(chipGroup("chief", ["پیگیری", "فشارخون", "دیابت/قند", "سرماخوردگی", "درد", "تب", "سرفه", "خستگی", "سرگیجه", "اسهال/استفروع", "حساسیت", "خواب/عصبی", "پوستی", "فشارِ چشم", "ادراری", "سایر"]));
    const box = el("span", "gsec-micbox");
    const t = document.createElement("input");
    t.type = "text";
    t.className = "gsec-txt";
    t.dataset.k = "chiefTxt";
    t.dataset.label = "متنِ شکایت";
    t.placeholder = "یا بنویسید…";
    t.style.marginTop = "8px";
    box.append(t);
    attachTools(box, t);
    f.append(box);
    body.append(f);

    body.append(txtField("anamOther", "متنِ تکمیلی (اختیاری)", false));

    const f2 = el("div", "gsec-field");
    f2.append(fieldLabel("مدت و شدت", ""));
    f2.append(chipGroup("dur", ["امروز", "چند روز", "چند هفته", "چند ماه", "سال", "مزمن", "از بدو تولد"]));
    const sev = el("div", "gsec-row");
    sev.style.marginTop = "8px";
    sev.append(el("span", "gsec-hint", "شدت"));
    const rng = document.createElement("input");
    rng.type = "range";
    rng.min = "0"; rng.max = "10"; rng.value = "0";
    rng.className = "gsec-range";
    rng.dataset.k = "sev";
    rng.dataset.num = "1";
    rng.dataset.label = "شدت";
    // «بدونِ عددِ پیش‌فرض»: اسلایدر تا وقتی کاربر آن را حرکت نداده ثبت نمی‌شود،
    // وگرنه هر بخشِ ناقصِ شدتِ صفر می‌خورد.
    rng.dataset.touch = "1";
    const lbl = el("span", "gsec-sevvalue", "۰");
    rng.addEventListener("input", () => { rng.dataset.touched = "1"; lbl.textContent = faNum(rng.value); });
    sev.append(rng, lbl);
    f2.append(sev);
    body.append(f2);

    const f3 = el("div", "gsec-field");
    f3.append(fieldLabel("بیماری‌های زمینه‌ای", " (چک‌لیست)"));
    f3.append(chipGroup("base", ["فشارخون", "دیابت", "چربی", "تیروئید", "بیماری قلبی", "آسم/ریوی", "کلیوی", "سرطان", "سکته", "روماتیسمی", "صرع", "گوارشی", "کم‌خونی", "اختلال روان", "سایر"], { multi: true }));
    f3.append(el("div", "gsec-subhint", "خالی گذاشتن = هیچکدام"));
    body.append(f3);

    // «داروهای مصرفی» + متنِ همراهش (توضیحِ دارو) خارج از نمونهٔ تأییدشده است.
    if (SHOW_EXTRA_FIELDS) {
      const f3b = el("div", "gsec-field");
      f3b.append(fieldLabel("داروهای مصرفی", " (چک‌لیست)"));
      f3b.append(chipGroup("meds", ["فشارشکن", "دیابت", "چربی", "تیروئید", "مسکن", "خواب", "روان", "ضدتشنج", "اسپری", "قرصِ ضدبارداری", "آنتی‌بیوتیک", "ویتامین/مکمل", "سایر"], { multi: true }));
      body.append(f3b);
      body.append(txtField("medsTxt", "توضیحِ دارو (اختیاری)", false, "نام یا دوزِ دارو…"));
    }

    const f4 = el("div", "gsec-field");
    f4.append(fieldLabel("حساسیت‌ها", " (اختیاری)"));
    f4.append(chipGroup("allergy", [
      "پنی‌سیلین/آموکسی‌سیلین", "سولفا", "مسکن (آسپرین/ایبوبروفن)", "آنتی‌بیوتیک‌های دیگر",
      "باقلا (G6PD)", "آجیل/مغزها", "لبنیات", "تخم‌مرغ", "گندم", "میوه‌ها",
      "ید/رنگِ کنتراست", "لاتکس", "حنا/رنگِ مو", "داروی بیهوشی", "سایر"
    ], { multi: true }));
    body.append(f4);
    body.append(txtField("allergyTxt", "توضیحِ حساسیت (اختیاری)", false));

    // «سابقهٔ خانوادگی» خارج از نمونهٔ تأییدشده است.
    if (SHOW_EXTRA_FIELDS) {
      const f5 = el("div", "gsec-field");
      f5.append(fieldLabel("سابقهٔ خانوادگی", ""));
      f5.append(chipGroup("famhx", ["فشار", "دیابت", "بیماری قلبی", "سرطان", "سکته", "ژنتیک", "اعتیاد", "سایر"], { multi: true }));
      body.append(f5);
    }

    const f6 = el("div", "gsec-field");
    f6.append(fieldLabel("بستری/عملِ قبلی", ""));
    f6.append(chipGroup("admit", ["بله", "خیر"]));
    body.append(f6);
    body.append(txtField("surgery", "سابقهٔ بستری/عمل (اختیاری)", false));
  }

  function buildVitals(body) {
    const g1 = el("div", "gsec-row gsec-stack");
    g1.append(numField("sys", "فشارِ سیستول (mmHg)", true), numField("dia", "فشارِ دیاستول (mmHg)", true));
    body.append(g1);
    const g2 = el("div", "gsec-row gsec-stack");
    g2.append(numField("wt", "وزن (kg)", true), numField("ht", "قد (cm)", true));
    body.append(g2);
    const g3 = el("div", "gsec-row gsec-stack");
    g3.append(numField("pulse", "نبض (bpm)", false));
    if (SHOW_EXTRA_FIELDS) g3.append(numField("resp", "تنفس (/دقیقه)", false)); // خارج از نمونه
    g3.append(numField("spo2", "SpO₂ (٪)", false));
    body.append(g3);
    const g4 = el("div", "gsec-row gsec-stack");
    g4.append(numField("temp", "دما (°C)", false));
    if (SHOW_EXTRA_FIELDS) g4.append(numField("waist", "دورِ کمر (cm)", false)); // خارج از نمونه
    body.append(g4);

    if (SHOW_EXTRA_FIELDS) {
      const tempPlace = el("div", "gsec-field");
      tempPlace.append(fieldLabel("محلِ اندازه‌گیریِ دما", ""));
      tempPlace.append(chipGroup("tempPlace", ["زیربغل", "دهان", "مقعد"]));
      body.append(tempPlace);
    }

    const bmi = el("div", "gsec-calc", "BMI: —");
    bmi.dataset.bmi = "1";
    body.append(bmi);
    const upd = () => {
      const w = num(field(body, "wt")?.value), h = num(field(body, "ht")?.value);
      bmi.textContent = (w > 0 && h > 0) ? `BMI: ${(w / Math.pow(h / 100, 2)).toFixed(1)} (محاسبه‌شده — خودکار)` : "BMI: —";
    };
    ["wt", "ht"].forEach((k) => field(body, k)?.addEventListener("input", upd));
    upd();
  }

  function setSys(row, mode) {
    const [ok, no] = qsa(".gseg button", row);
    ok.classList.toggle("on-ok", mode === "normal");
    no.classList.toggle("on-no", mode === "abnormal");
    if (mode == null) delete row.dataset.state; else row.dataset.state = mode;
    const box = row.querySelector(".gsec-micbox");
    if (box) box.style.display = mode === "abnormal" ? "block" : "none";
    const tx = row.querySelector("[data-detail]");
    if (tx && mode !== "abnormal") tx.value = "";
    refreshResult(row.closest(".gsec"));
  }

  function refreshResult(sec) {
    if (!sec) return;
    const box = sec.querySelector("[data-derived]");
    if (!box) return;
    const rows = qsa("[data-sys]", sec);
    const ab = rows.filter((r) => r.dataset.state === "abnormal").map((r) => r.dataset.sys);
    const any = rows.some((r) => r.dataset.state);
    const text = !any ? "—" : ab.length ? "غیرطبیعی" : "طبیعی";
    if (text === "—") delete box.dataset.v; else box.dataset.v = text;
    box.classList.toggle("is-ok", text === "طبیعی");
    box.classList.toggle("is-bad", text === "غیرطبیعی");
    const span = box.querySelector("[data-result-text]");
    if (span) span.textContent = text;
  }

  function buildExam(body, sec) {
    const bar = el("div", "gsec-allnormal");
    const all = el("button", "gsec-btn small", "✓ همه طبیعی");
    all.type = "button";
    all.addEventListener("click", () => {
      qsa("[data-sys]", sec).forEach((r) => setSys(r, "normal"));
      const err = sec.querySelector("[data-err]");
      if (err) err.textContent = "";
    });
    bar.append(all);
    body.append(bar);

    const gen = el("div", "gsec-field");
    gen.append(fieldLabel("حالِ عمومی", ""));
    gen.append(chipGroup("general", ["خوب", "ضعیف", "بد", "نیمه‌هوشیار"]));
    body.append(gen);

    SYSTEMS.forEach((name) => {
      const r = el("div", "gsec-sys");
      r.dataset.sys = name;
      r.append(el("span", "nm", name));
      const seg = el("div", "gseg");
      const ok = el("button", null, "طبیعی"); ok.type = "button";
      const no = el("button", null, "غیرطبیعی"); no.type = "button";
      ok.addEventListener("click", () => setSys(r, r.dataset.state === "normal" ? null : "normal"));
      no.addEventListener("click", () => setSys(r, r.dataset.state === "abnormal" ? null : "abnormal"));
      seg.append(ok, no);
      r.append(seg);
      const box = el("span", "gsec-micbox");
      const tx = document.createElement("input");
      tx.type = "text";
      tx.className = "gsec-txt";
      tx.dataset.detail = "1";
      tx.placeholder = "یافته…";
      box.append(tx);
      attachTools(box, tx);
      box.style.display = "none";
      r.append(box);
      body.append(r);
    });

    // نتیجهٔ کلی ★ از رویِ سیستم‌ها ساخته می‌شود — دستی انتخاب نمی‌شود.
    const res = el("div", "gsec-result");
    res.dataset.group = "result";
    res.dataset.derived = "1";
    res.append(el("b", null, "نتیجهٔ کلی:"), el("span", "gsec-result-value", "—"));
    res.querySelector("span").dataset.resultText = "1";
    body.append(res);

    body.append(txtField("examFindings", "یافته‌های مهم", false));
    refreshResult(sec);
  }

  // نوارِ «همین حالا» + برچسبِ منبعِ هر نمونهٔ تکرارپذیر.
  function repeatRowChrome(r) {
    const nowbar = el("div", "gsec-nowbar");
    const t = el("button", "gsec-chip on", "⏳ همین حالا");
    t.type = "button";
    t.dataset.now = "1";
    t.addEventListener("click", () => {
      t.dataset.v = nowLocal();
      t.textContent = "⏳ " + t.dataset.v;
    });
    nowbar.append(t);
    const src = el("span", "gsec-src hidden", "منبع: تکرارشده");
    src.dataset.srclabel = "1";
    nowbar.append(src);
    r.append(nowbar);
    return t;
  }

  function setRowSource(r, src) {
    if (src) r.dataset.source = src; else delete r.dataset.source;
    const label = r.querySelector("[data-srclabel]");
    if (label) label.classList.toggle("hidden", !src);
  }

  // «🔁 تکرارِ اندازهٔ قبلی» فقط وقتی ردیفِ قبلی هست ساخته می‌شود.
  function addRepeatChip(r, list) {
    const prev = list.querySelector("[data-row]");
    if (!prev) return null;
    const rep = el("button", "gsec-chip", "🔁 تکرارِ اندازهٔ قبلی");
    rep.type = "button";
    rep.addEventListener("click", () => {
      const srcs = qsa("[data-num]", prev);
      const mine = qsa("[data-num]", r);
      if (!srcs.length || !String(srcs[0].value || "").trim()) return;
      srcs.forEach((s, i) => {
        if (!mine[i]) return;
        mine[i].value = s.value;
        mine[i].dispatchEvent(new Event("input", { bubbles: true }));
      });
      setRowSource(r, "تکرارشده");
      rep.classList.add("on");
    });
    return rep;
  }

  function repeatNum(key, label, req) {
    const i = document.createElement("input");
    i.type = "number";
    i.inputMode = "decimal";
    i.className = "gsec-num small";
    i.dataset.k = key;
    i.dataset.num = "1";
    i.dataset.label = label;
    i.placeholder = label;
    if (req) i.dataset.req = "1";
    return i;
  }

  function repeatAddButton(list) {
    const more = el("button", "gsec-btn small", "+ نمونهٔ دیگر");
    more.type = "button";
    more.style.marginBottom = "8px";
    more.addEventListener("click", () => list.__mk());
    return more;
  }

  function buildBpRows(body, sec) {
    const list = el("div", "gsec-rows");
    list.dataset.rows = "1";
    const mk = () => {
      const r = el("div", "gsec-rowbox");
      r.dataset.row = "1";
      repeatRowChrome(r);
      const row = el("div", "gsec-row");
      row.append(repeatNum("sys", "سیستول", true), repeatNum("dia", "دیاستول", true), repeatNum("pulse", "نبض", false));
      r.append(row);
      const whens = chipGroup("when", ["صبح", "شب", "قبل از فشارشکن", "بعد از فشارشکن", "استراحت", "بعد از فعالیت"], { label: "نوبت" });
      const rep = addRepeatChip(r, list);
      if (rep) whens.append(rep);
      r.append(whens);
      // «وضعیتِ دارو» و «توضیح» خارج از نمونهٔ تأییدشده‌اند.
      if (SHOW_EXTRA_FIELDS) {
        r.append(chipGroup("medState", ["بدونِ فشارشکن", "روزانه", "نامظم"], { label: "وضعیتِ دارو" }));
        r.append(txtField("note", "توضیح", false));
      }
      list.append(r);
      return r;
    };
    list.__mk = mk;
    sec.__mkRow = mk;
    mk();
    body.append(list, repeatAddButton(list));
  }

  function buildSugarRows(body, sec) {
    const list = el("div", "gsec-rows");
    list.dataset.rows = "1";
    const mk = () => {
      const r = el("div", "gsec-rowbox");
      r.dataset.row = "1";
      repeatRowChrome(r);
      const row = el("div", "gsec-row");
      row.append(repeatNum("value", "مقدار", true));
      row.append(el("span", "gsec-hint", "mg/dL"));
      r.append(row);
      const conds = chipGroup("cond", ["ناشتا", "بعد غذا", "دو ساعته", "تصادفی"], { label: "شرایط" });
      const rep = addRepeatChip(r, list);
      if (rep) conds.append(rep);
      r.append(conds);
      r.append(chipGroup("src", ["خودسنجی", "آزمایشگاه ⤵"], { label: "منبع" }));
      list.append(r);
      return r;
    };
    list.__mk = mk;
    sec.__mkRow = mk;
    mk();
    body.append(list, repeatAddButton(list));
  }

  function buildLife(body) {
    body.append(chipGroup("smoke", ["هرگز", "فعلی", "سابق", "قلیان"], { required: true, label: "سیگار" }));

    const f = el("div", "gsec-field");
    f.append(fieldLabel("فعالیتِ بدنی", " (دقیقه در هفته — کلیدی)"));
    const i = document.createElement("input");
    i.type = "number";
    i.inputMode = "decimal";
    i.className = "gsec-num";
    i.dataset.k = "act";
    i.dataset.num = "1";
    i.dataset.req = "1";
    i.dataset.label = "فعالیتِ بدنی";
    f.append(i);
    body.append(f);
    body.append(chipGroup("actType", ["پیاده‌روی", "ورزش", "کارِ سنگین"], { label: "نوعِ فعالیت" }));

    const f2 = el("div", "gsec-field");
    f2.append(fieldLabel("الکل", ""));
    f2.append(chipGroup("alcohol", ["هرگز", "گاه", "هفتگی", "روزانه"]));
    body.append(f2);

    const f3 = el("div", "gsec-field");
    f3.append(fieldLabel("خواب", " (ساعت در شب)"));
    const row = el("div", "gsec-row");
    const sl = document.createElement("input");
    sl.type = "number";
    sl.inputMode = "decimal";
    sl.className = "gsec-num small";
    sl.dataset.k = "sleep";
    sl.dataset.num = "1";
    sl.dataset.label = "خواب";
    row.append(sl);
    // «کیفیتِ خواب» خارج از نمونهٔ تأییدشده است.
    if (SHOW_EXTRA_FIELDS) row.append(chipGroup("sleepQ", ["خوب", "ضعیف", "خواب‌آلودگی روز"], { label: "کیفیتِ خواب" }));
    f3.append(row);
    body.append(f3);

    const f4 = el("div", "gsec-field");
    f4.append(fieldLabel("تغذیه", " (اختیاری)"));
    f4.append(chipGroup("diet", ["پُرنمک", "پُرچرب", "پُرقند", "کم‌آبی", "کم‌فیبر"], { multi: true }));
    body.append(f4);

    body.append(txtField("lifeNote", "شغل/استرس (اختیاری)", false));
  }

  function screenRow(item) {
    const r = el("div", "gsec-sys");
    r.dataset.screen = item;
    r.append(el("span", "nm", item));
    const seg = el("div", "gseg");
    SCREEN_STATES.forEach((t) => {
      const b = el("button", null, t);
      b.type = "button";
      b.addEventListener("click", () => {
        const was = seg.dataset.state === t;
        qsa("button", seg).forEach((x) => { x.className = ""; });
        if (was) delete seg.dataset.state;
        else {
          b.classList.add(t === "انجام شده" ? "on-ok" : t === "نیاز دارد" ? "on-no" : "on-none");
          seg.dataset.state = t;
        }
      });
      seg.append(b);
    });
    r.append(seg);
    return r;
  }

  function buildScreen(body) {
    body.append(el("div", "gsec-subhint", "هر آیتم یکی از سه حالت: انجام شده / نیاز دارد / انجام نشده"));
    SCREEN_ITEMS.forEach((it) => body.append(screenRow(it)));
  }

  function buildLink(body, sec) {
    const box = el("div");
    (sec.def.items || []).forEach((it) => {
      const l = el("label", "gsec-linkrow");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.dataset.link = it;
      l.append(cb, document.createTextNode(it));
      box.append(l);
    });
    body.append(box);
  }

  /* ---------- بخش‌هایِ افزودنی ---------- */

  function buildEmerg(body) {
    body.append(chipGroup("emergSym", ["دردِ سینه", "تنگی نفس", "خونریزی", "تبِ بالا", "سردرگیِ شدید", "استفراغِ شدید", "تشنج", "سایر"], { multi: true, label: "علائمِ حاد" }));
    body.append(chipGroup("alert", ["هوشیار", "گیج", "بی‌هوش"], { required: true, label: "هوشیاری" }));
  }

  function buildPain(body) {
    const f = el("div", "gsec-field");
    f.append(fieldLabel("شدتِ درد", " (کلیدی — تیک روی مقیاس)"));
    f.append(chipGroup("painScale", ["۰", "۲", "۴", "۶", "۸", "۱۰"], { required: true, label: "شدتِ درد" }));
    body.append(f);
    body.append(chipGroup("painWhere", ["سر", "سینه", "شکم", "استخوان‌ماهیچه", "سایر"], { label: "محلِ درد" }));
  }

  function buildPhq(body) {
    body.append(el("div", "gsec-subhint", "در دو هفتهٔ گذشته، برای هر پرسش یک گزینه · کلیکِ دوباره = لغو"));
    ["علایمِ کم‌خوابی یا بی‌اشتهایی", "احساسِ غمگینی یا بی‌حوصلگی"].forEach((q, idx) => {
      const r = el("div", "gsec-phq");
      r.append(el("span", "q", q));
      r.append(chipGroup("phq" + idx, PHQ_OPTS, { required: true, label: `پرسشِ ${faNum(idx + 1)}`, cls: "gsec-opts" }));
      body.append(r);
    });
  }

  function buildAnte(body) {
    const row = el("div", "gsec-row gsec-stack");
    row.append(numField("ga", "هفتهٔ بارداری", true, true), numField("sys2", "فشار سیستول", true, true), numField("dia2", "فشار دیاستول", true, true));
    body.append(row);
    body.append(chipGroup("prot", ["منفی", "Trace", "+1", "+2", "+3"], { label: "پروتئینِ ادرار" }));
    body.append(chipGroup("edema", ["ندارد", "خفیف", "متوسط", "شدید"], { label: "ورم" }));
    body.append(chipGroup("fetal", ["طبیعی", "کم", "بدون حرکت"], { label: "حرکاتِ جنین" }));
    // «سونوگرافی ⤵» خارج از نمونهٔ تأییدشده است.
    if (SHOW_EXTRA_FIELDS) {
      const us = el("div", "gsec-field");
      us.append(fieldLabel("سونوگرافی ⤵", " (پیوند)"));
      const l = el("label", "gsec-linkrow");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.dataset.link = "سونوگرافی";
      l.append(cb, document.createTextNode("سونوگرافی"));
      us.append(l);
      body.append(us);
    }
  }

  function buildPeds(body) {
    const row = el("div", "gsec-row gsec-stack");
    row.append(numField("pwt", "وزن (kg)", true, true), numField("pht", "قد (cm)", true, true), numField("hc", "دور سر (cm)", false, true));
    body.append(row);
    // «درصدِ منحنی» خارج از نمونهٔ تأییدشده است.
    if (SHOW_EXTRA_FIELDS) {
      const row2 = el("div", "gsec-row gsec-stack");
      row2.append(numField("curvePct", "درصدِ منحنی", false, true));
      body.append(row2);
    }
    body.append(chipGroup("curve", ["طبیعی", "کم‌رشد", "اضافه‌وزن"], { label: "منحنیِ رشد" }));
    body.append(chipGroup("dev", ["طبیعی", "تاخیر حرکتی", "تاخیر زبانی"], { label: "سنِ حرکتی/زبانی" }));
    // «واکسیناسیون» خارج از نمونهٔ تأییدشده است.
    if (SHOW_EXTRA_FIELDS) body.append(chipGroup("vax", ["انجام شده", "نیاز دارد", "انجام نشده"], { label: "واکسیناسیون" }));
  }

  function buildGeri(body) {
    body.append(chipGroup("fall", ["ندارد", "گاه", "مکرر"], { required: true, label: "سقوط" }));
    body.append(chipGroup("balance", ["خوب", "ضعیف"], { label: "تعادل" }));
    body.append(chipGroup("cog", ["طبیعی", "شک"], { label: "شناخت" }));
    body.append(chipGroup("poly", ["تک‌دارویی", "چنددارویی"], { label: "چنددارویی" }));
    // «تعدادِ دارو» خارج از نمونهٔ تأییدشده است.
    if (SHOW_EXTRA_FIELDS) body.append(numField("medCount", "تعداد دارو در روز", false, true));
    body.append(chipGroup("nut", ["خوب", "کم‌اشتهایی"], { label: "تغذیه" }));
  }

  /* ================= خلاصه‌سازها / کلیدها (scoped به همان بخش) ================= */

  const grpV = (sec, name) => grp(sec, name)?.dataset.v || "";
  const txtV = (sec, key) => value(sec, key);

  function sumAnamnesis(sec) { return grpV(sec, "chief") || txtV(sec, "chiefTxt") || "—"; }
  function sumVitals(sec) {
    const w = num(field(sec, "wt")?.value), h = num(field(sec, "ht")?.value);
    const b = w > 0 && h > 0 ? (w / Math.pow(h / 100, 2)).toFixed(1) : "—";
    return `BMI ${b}`;
  }
  function sumExam(sec) {
    const ab = qsa("[data-sys]", sec).filter((r) => r.dataset.state === "abnormal").map((r) => r.dataset.sys);
    return ab.length ? `غیرطبیعی: ${ab.join("، ")}` : "طبیعی (همه سیستم‌ها)";
  }
  function sumRows(sec, pick) {
    return qsa("[data-row]", sec).map(pick).filter(Boolean).join(" ، ");
  }
  function sumBp(sec) {
    return sumRows(sec, (r) => {
      const i = qsa("[data-num]", r);
      return i[0]?.value && i[1]?.value ? `${i[0].value}/${i[1].value}` : "";
    });
  }
  function sumSugar(sec) { return sumRows(sec, (r) => qsa("[data-num]", r)[0]?.value || ""); }
  function sumLife(sec) { return `${grpV(sec, "smoke") || "—"} · فعالیت ${txtV(sec, "act") || "—"}′`; }
  function sumScreen(sec) {
    const done = qsa("[data-screen]", sec).filter((r) => r.querySelector(".gseg")?.dataset.state === "انجام شده").length;
    return `${faNum(done)} انجام‌شده`;
  }
  function linkSum(sec) {
    return qsa("[data-link]", sec).filter((c) => c.checked).map((c) => c.dataset.link).join("، ");
  }
  function sumPhq(sec) {
    const total = ["phq0", "phq1"].reduce((t, k) => {
      const i = PHQ_OPTS.indexOf(grpV(sec, k));
      return t + (i < 0 ? 0 : i);
    }, 0);
    return `PHQ-2 = ${total}`;
  }

  const EXTRA_DEFS = [
    {
      id: "emerg", title: "اورژانس و شدت", build: buildEmerg,
      summarize: (sec) => (grpV(sec, "alert") ? `هوشیاری: ${grpV(sec, "alert")}` : "")
    },
    {
      id: "pain", title: "ارزیابیِ درد", build: buildPain,
      summarize: (sec) => (grpV(sec, "painScale") ? `شدت ${grpV(sec, "painScale")}` : "")
    },
    { id: "phq", title: "سلامتِ روان (غربالگریِ PHQ-2)", build: buildPhq, summarize: sumPhq },
    {
      id: "ante", title: "بارداری (پیگیری)", build: buildAnte,
      summarize: (sec) => (txtV(sec, "ga") ? `هفتهٔ ${txtV(sec, "ga")}` : "")
    },
    {
      id: "peds", title: "رشد و تکاملِ کودک", build: buildPeds,
      summarize: (sec) => (txtV(sec, "pwt") ? `${txtV(sec, "pwt")} kg` : "")
    },
    {
      id: "geri", title: "سالمندی", build: buildGeri,
      summarize: (sec) => (grpV(sec, "fall") ? `سقوط: ${grpV(sec, "fall")}` : "")
    }
  ];

  const linkKey = (sec) => qsa("[data-link]:checked", sec).length > 0;
  const linkKeyMsg = "دستِ کم یک آیتم را انتخاب کنید";

  const TEMPLATE_DEFS = [
    {
      id: "anamnesis", title: "شکایت و آنامنز", build: buildAnamnesis,
      key: (sec) => !!(grpV(sec, "chief") || txtV(sec, "chiefTxt")),
      keyMsg: "شکایتِ اصلی را تیک بزنید یا بنویسید",
      summarize: sumAnamnesis
    },
    { id: "vitals", title: "علائمِ حیاتی", build: buildVitals, summarize: sumVitals },
    {
      id: "exam", title: "معاینهٔ عمومی", build: buildExam,
      key: (sec) => qsa("[data-sys]", sec).every((r) => r.dataset.state),
      keyMsg: "وضعیتِ همه سیستم‌ها را مشخص کنید (یا «✓ همه طبیعی»)",
      summarize: sumExam,
      afterFill: refreshResult
    },
    { id: "bp", title: "ارزیابیِ فشارخون", build: buildBpRows, summarize: sumBp, repeat: true },
    { id: "sugar", title: "ارزیابیِ قند", build: buildSugarRows, summarize: sumSugar, repeat: true },
    { id: "life", title: "سبکِ زندگی", build: buildLife, summarize: sumLife },
    {
      id: "screen", title: "غربالگری و پیشگیری", build: buildScreen,
      key: (sec) => qsa("[data-screen]", sec).every((r) => r.querySelector(".gseg")?.dataset.state),
      keyMsg: "برای همه آیتم‌ها یک وضعیت انتخاب کنید",
      summarize: sumScreen
    },
    {
      id: "linkLab", title: "آزمایش ⤵", link: true, build: buildLink,
      items: ["CBC", "قند/چربی", "فاکتورهای التهاب", "تیروئید", "کبدی", "کلیوی/اوره-کراتینین", "ادرار", "آهن/فریتین", "ویتامین D", "کشت", "تومورمارکرها", "HbA1c", "B12", "H. pylori", "β-hCG", "ادرارِ کامل"],
      key: linkKey, keyMsg: linkKeyMsg, summarize: linkSum
    },
    {
      id: "linkImg", title: "تصویر و رادیولوژی ⤵", link: true, build: buildLink,
      items: ["ECG", "رادیوگرافی سینه", "رادیوگرافی شکم", "سونوگرافی", "OPG/CBCT", "ماموگرافی", "MRI", "CT", "DEXA", "داپلر"],
      key: linkKey, keyMsg: linkKeyMsg, summarize: linkSum
    },
    {
      id: "linkDoc", title: "اسنادِ بالینی ⤵", link: true, build: buildLink,
      items: ["عکسِ بالینی/زخم", "نسخه", "کاربرگِ معرفی", "برگهٔ بیمارستان", "پاسخِ ارجاعِ تخصصی"],
      key: linkKey, keyMsg: linkKeyMsg, summarize: linkSum
    }
  ];

  const defOf = (code) => TEMPLATE_DEFS.find((d) => d.id === code) || EXTRA_DEFS.find((d) => d.id === code);

  /* ================= جمع‌آوری / بازگرداندنِ داده ================= */

  function collect(sec) {
    const body = sec.querySelector(".gsec-body");
    const data = { v: 1, chips: {}, checks: {}, texts: {}, numbers: {} };

    qsa("[data-group]", body).forEach((g) => {
      if (g.closest("[data-row]")) return;
      const name = g.dataset.group;
      if (g.dataset.multi) {
        const v = qsa(".gsec-chip.on", g).map((c) => c.dataset.v);
        if (v.length) data.checks[name] = v;
      } else if (g.dataset.v) {
        data.chips[name] = g.dataset.v;
      }
    });

    qsa("[data-k]", body).forEach((i) => {
      if (i.closest("[data-row]")) return;
      const k = i.dataset.k;
      if (i.dataset.num !== undefined) {
        if (i.dataset.touch === "1" && !i.dataset.touched) return; // دست نخورده = ثبت نشود
        const n = num(i.value);
        if (n !== null) data.numbers[k] = n;
      } else {
        const v = String(i.value || "").trim();
        if (v) data.texts[k] = v;
      }
    });

    // BMI محاسبه‌ای است، ولی برایِ خوانندگانِ بعدی (گزارش/هوش مصنوعی) ذخیره می‌شود.
    const bmiBox = body.querySelector("[data-bmi]");
    if (bmiBox) {
      const w = num(field(body, "wt")?.value), h = num(field(body, "ht")?.value);
      if (w > 0 && h > 0) data.numbers.bmi = Number((w / Math.pow(h / 100, 2)).toFixed(1));
    }

    const links = qsa("[data-link]", body).filter((c) => c.checked).map((c) => c.dataset.link);
    if (links.length) data.links = links;

    const systems = qsa("[data-sys]", body).map((r) => ({
      name: r.dataset.sys,
      state: r.dataset.state || "",
      detail: String(r.querySelector("[data-detail]")?.value || "").trim()
    }));
    if (systems.some((s) => s.state)) data.systems = systems;

    const screen = {};
    qsa("[data-screen]", body).forEach((r) => {
      const st = r.querySelector(".gseg")?.dataset.state;
      if (st) screen[r.dataset.screen] = st;
    });
    if (Object.keys(screen).length) data.screen = screen;

    const rowsHost = body.querySelector("[data-rows]");
    if (rowsHost) data.rows = qsa("[data-row]", rowsHost).map(collectRow);

    return data;
  }

  function collectRow(r) {
    const row = {};
    const now = r.querySelector("[data-now]");
    if (now?.dataset.v) row.at = now.dataset.v;

    const chips = {}, checks = {};
    qsa("[data-group]", r).forEach((g) => {
      if (g.dataset.multi) {
        const v = qsa(".gsec-chip.on", g).map((c) => c.dataset.v);
        if (v.length) checks[g.dataset.group] = v;
      } else if (g.dataset.v) {
        chips[g.dataset.group] = g.dataset.v;
      }
    });
    if (Object.keys(chips).length) row.chips = chips;
    if (Object.keys(checks).length) row.checks = checks;

    const numbers = {}, texts = {};
    qsa("[data-k]", r).forEach((i) => {
      if (i.dataset.num !== undefined) {
        const n = num(i.value);
        if (n !== null) numbers[i.dataset.k] = n;
      } else {
        const v = String(i.value || "").trim();
        if (v) texts[i.dataset.k] = v;
      }
    });
    if (Object.keys(numbers).length) row.numbers = numbers;
    if (Object.keys(texts).length) row.texts = texts;
    if (r.dataset.source) row.source = r.dataset.source;
    return row;
  }

  function fill(sec, data) {
    const body = sec.querySelector(".gsec-body");
    data = data || {};

    qsa("[data-group]", body).forEach((g) => {
      if (g.dataset.derived || g.closest("[data-row]")) return;
      const name = g.dataset.group;
      if (g.dataset.multi) setGroup(g, data.checks?.[name] || []);
      else if (data.chips?.[name]) setGroup(g, data.chips[name]);
    });

    qsa("[data-k]", body).forEach((i) => {
      if (i.closest("[data-row]")) return;
      const k = i.dataset.k;
      let changed = false;
      if (i.dataset.num !== undefined) {
        if (data.numbers?.[k] != null) { i.value = String(data.numbers[k]); changed = true; }
      } else if (data.texts?.[k] != null) {
        i.value = String(data.texts[k]);
        changed = true;
      }
      // فقط فیلدهایی که واقعاً از داده پر شدند رویداد می‌دهند؛ وگرنه فیلدِ
      // دست‌نخورده (مثلِ اسلایدرِ شدت) «لمس‌شده» حساب می‌شود و عددِ پیش‌فرض ثبت می‌گردد.
      if (changed) i.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const links = new Set(data.links || []);
    qsa("[data-link]", body).forEach((c) => { c.checked = links.has(c.dataset.link); });

    (data.systems || []).forEach((s) => {
      const row = body.querySelector(`[data-sys="${s.name}"]`);
      if (!row) return;
      setSys(row, s.state === "normal" || s.state === "abnormal" ? s.state : null);
      const tx = row.querySelector("[data-detail]");
      if (tx) {
        tx.value = s.detail || "";
        tx.dispatchEvent(new Event("input", { bubbles: true }));
      }
      const box = row.querySelector(".gsec-micbox");
      if (box) box.style.display = row.dataset.state === "abnormal" ? "block" : "none";
    });

    Object.entries(data.screen || {}).forEach(([item, state]) => {
      const seg = body.querySelector(`[data-screen="${item}"]`)?.querySelector(".gseg");
      if (!seg) return;
      seg.dataset.state = state;
      qsa("button", seg).forEach((b) => {
        b.className = b.textContent === state
          ? (state === "انجام شده" ? "on-ok" : state === "نیاز دارد" ? "on-no" : "on-none")
          : "";
      });
    });

    if (sec.def.repeat && Array.isArray(data.rows)) {
      const host = body.querySelector("[data-rows]");
      host.replaceChildren();
      data.rows.forEach((o) => fillRow(sec.__mkRow(), o));
      if (!host.children.length) sec.__mkRow();
    }

    sec.def.afterFill?.(sec);
  }

  function fillRow(r, obj) {
    if (!obj) return;
    const now = r.querySelector("[data-now]");
    if (now && obj.at) {
      now.dataset.v = obj.at;
      now.textContent = "⏳ " + obj.at;
    }
    Object.entries(obj.chips || {}).forEach(([k, v]) => setGroup(grp(r, k), v));
    Object.entries(obj.checks || {}).forEach(([k, v]) => setGroup(grp(r, k), v));
    Object.entries(obj.numbers || {}).forEach(([k, v]) => {
      const i = r.querySelector(`[data-k="${k}"]`);
      if (i) { i.value = String(v); i.dispatchEvent(new Event("input", { bubbles: true })); }
    });
    Object.entries(obj.texts || {}).forEach(([k, v]) => {
      const i = r.querySelector(`[data-k="${k}"]`);
      if (i) { i.value = String(v); i.dispatchEvent(new Event("input", { bubbles: true })); }
    });
    setRowSource(r, obj.source || null);
  }

  /* ================= آکاردئون / ثبت / حذف ================= */

  function toggleSection(sec) {
    const body = sec.querySelector(".gsec-body");
    const open = sec.classList.contains("is-open");
    qsa(".gsec", sec.parentElement).forEach((s) => {
      s.classList.remove("is-open");
      s.querySelector(".gsec-body").classList.add("hidden");
    });
    if (!open) {
      sec.classList.add("is-open");
      body.classList.remove("hidden");
    }
  }

  function closeSection(sec) {
    sec.classList.remove("is-open");
    sec.querySelector(".gsec-body").classList.add("hidden");
  }

  function badgeText(summary) {
    const s = summary ? String(summary) : "";
    const short = s.length > 70 ? s.slice(0, 67) + "…" : s;
    return "✓ ثبت شد" + (short ? ` — ${short}` : "");
  }

  function markRecorded(sec, summary) {
    sec.classList.add("recorded");
    const badge = sec.querySelector(".gsec-badge");
    badge.classList.add("done");
    badge.textContent = badgeText(summary);
    const del = sec.querySelector("[data-del]");
    if (del) del.classList.remove("hidden");
    sec.__summary = summary || "";
  }

  function unmarkRecorded(sec) {
    sec.classList.remove("recorded");
    const badge = sec.querySelector(".gsec-badge");
    badge.classList.remove("done");
    badge.textContent = "—";
    const del = sec.querySelector("[data-del]");
    if (del) del.classList.add("hidden");
    sec.__summary = "";
  }

  function validate(sec) {
    const body = sec.querySelector(".gsec-body");
    const miss = [];
    if (sec.def.key && !sec.def.key(sec)) miss.push(sec.def.keyMsg || "بخشِ کلیدی ناقص است");
    qsa("[data-req]", body).forEach((i) => {
      if (!String(i.value || "").trim()) miss.push(i.dataset.label || i.placeholder || "موردِ کلیدی");
    });
    qsa('[data-group][data-required="1"]', body).forEach((g) => {
      if (!g.dataset.v) miss.push(g.dataset.label || "انتخاب نشده");
    });
    return [...new Set(miss)];
  }

  // زمانِ ★ هر نمونه: اگر کاربر «همین حالا» را نزده باشد، لحظهٔ ثبت می‌نشیند.
  function stampTimes(sec) {
    qsa("[data-now]", sec).forEach((b) => {
      if (!b.dataset.v) {
        b.dataset.v = nowLocal();
        b.textContent = "⏳ " + b.dataset.v;
      }
    });
  }

  async function confirmSection(sec) {
    const err = sec.querySelector("[data-err]");
    stampTimes(sec);
    const miss = validate(sec);
    if (miss.length) {
      err.textContent = "لطفاً تکمیل کنید: " + miss.slice(0, 3).join("، ");
      return;
    }
    err.textContent = "";

    const data = collect(sec);
    data.summary = sec.def.summarize ? sec.def.summarize(sec) : "";

    // مراجعه هنوز ثبت نشده ⇒ بافر در حافظه؛ POST پس از ثبتِ مراجعه انجام می‌شود.
    if (!currentStudyID) {
      const row = { sectionCode: sec.def.id, title: sec.def.title, data };
      pendingSections.set(sec.def.id, row);
      rowsCache.set(sec.def.id, row);
      markRecorded(sec, data.summary);
      closeSection(sec);
      note("بخش‌ها با ثبتِ مراجعه ذخیره می‌شوند — تا آن‌وقت همین‌جا نگه داشته می‌شوند.", false);
      window.showToast?.(`بخش «${sec.def.title}» آماده شد؛ با ثبتِ مراجعه ذخیره می‌شود.`);
      return;
    }

    const btn = sec.querySelector("[data-save]");
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "در حال ثبت…";
    try {
      const x = await api(`/api/studies/${currentStudyID}/sections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectionCode: sec.def.id, title: sec.def.title, data })
      });
      markRecorded(sec, x.section?.data?.summary ?? data.summary);
      rowsCache.set(sec.def.id, x.section || null);
      closeSection(sec);
      window.showToast?.(`بخش «${sec.def.title}» ثبت شد.`);
    } catch (e) {
      err.textContent = e.message || "ثبتِ بخش انجام نشد.";
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  async function deleteSection(sec) {
    const err = sec.querySelector("[data-err]");
    if (!window.confirm(`ثبتِ بخش «${sec.def.title}» حذف شود؟`)) return;
    // در حالتِ پیش‌نویس چیزی روی سرور نیست؛ فقط از بافر حذف می‌شود.
    if (!currentStudyID) {
      pendingSections.delete(sec.def.id);
      rowsCache.delete(sec.def.id);
      unmarkRecorded(sec);
      err.textContent = "";
      window.showToast?.(`بخش «${sec.def.title}» از پیش‌نویس حذف شد.`);
      return;
    }
    const del = sec.querySelector("[data-del]");
    del.disabled = true;
    try {
      await api(`/api/studies/${currentStudyID}/sections?sectionCode=${encodeURIComponent(sec.def.id)}`, { method: "DELETE" });
      unmarkRecorded(sec);
      rowsCache.delete(sec.def.id);
      err.textContent = "";
      window.showToast?.(`ثبتِ بخش «${sec.def.title}» حذف شد.`);
    } catch (e) {
      err.textContent = e.message || "حذف انجام نشد.";
    } finally {
      del.disabled = false;
    }
  }

  /* ================= ساختِ بخش‌ها در سند ================= */

  let currentStudyID = 0;
  let rowsCache = new Map();      // sectionCode -> ردیفِ دریافتی از سرور
  // بخش‌هایی که در حالتِ «مراجعهٔ جدید» (بدون StudyID) «تأیید و ثبت» شده‌اند؛
  // بلافاصله پس از ثبتِ مراجعه با POST ذخیره می‌شوند (flushPending).
  let pendingSections = new Map();
  let addedCodes = [];            // بخش‌هایِ افزودنیِ انتخاب‌شده در این نشست
  let listEl = null, noteEl = null, dialogEl = null, dialogListEl = null, panelEl = null;

  function makeSection(def, row) {
    const sec = el("article", "gsec");
    sec.dataset.id = def.id;
    sec.def = def;

    const head = el("button", "gsec-head");
    head.type = "button";
    head.append(el("span", "gsec-arrow", "▾"), el("span", "gsec-name", def.title), el("span", "gsec-badge", "—"));
    const body = el("div", "gsec-body hidden");
    sec.append(head, body);
    listEl.append(sec); // پیش از ساختِ فرم به سند وصل شود تا جست‌وجوی سند کار کند

    head.addEventListener("click", () => toggleSection(sec));

    if (def.readOnly) {
      body.append(el("div", "gsec-subhint", "این بخش با نسخهٔ دیگری ثبت شده و در این نسخه قابلِ ویرایش نیست."));
      const pre = document.createElement("pre");
      pre.style.cssText = "direction:ltr;text-align:left;background:var(--surface-soft,#f6fafb);border:1px solid var(--border,#dbe4ec);border-radius:8px;padding:8px;font-size:12px;overflow:auto;max-height:220px";
      pre.textContent = JSON.stringify(row?.data ?? {}, null, 2);
      body.append(pre, footRow());
      body.querySelector("[data-save]")?.classList.add("hidden");
    } else {
      def.build(body, sec);
      body.append(footRow());
      fill(sec, row?.data || {});
      body.querySelector("[data-err]").textContent = "";
    }

    body.querySelector("[data-save]")?.addEventListener("click", () => confirmSection(sec));
    body.querySelector("[data-del]")?.addEventListener("click", () => deleteSection(sec));

    if (row) markRecorded(sec, row.data?.summary || (def.summarize ? def.summarize(sec) : ""));
    return sec;
  }

  function readOnlyDef(row) {
    return {
      id: row.sectionCode,
      title: row.title || row.sectionCode,
      readOnly: true,
      summarize: () => row.data?.summary || ""
    };
  }

  function defsFor(studyRows) {
    const defs = TEMPLATE_DEFS.slice();
    const known = new Set(defs.map((d) => d.id));
    studyRows.forEach((r) => {
      if (known.has(r.sectionCode)) return;
      defs.push(defOf(r.sectionCode) || readOnlyDef(r));
      known.add(r.sectionCode);
    });
    addedCodes.forEach((code) => {
      if (known.has(code)) return;
      const ex = defOf(code);
      if (ex) { defs.push(ex); known.add(code); }
    });
    return defs;
  }

  function renderList(studyRows) {
    rowsCache = new Map(studyRows.map((r) => [r.sectionCode, r]));
    listEl.replaceChildren();
    defsFor(studyRows).forEach((def) => makeSection(def, rowsCache.get(def.id) || null));
  }

  function note(text, isError) {
    if (!noteEl) return;
    noteEl.classList.toggle("error", !!isError);
    noteEl.classList.toggle("hidden", !text);
    noteEl.textContent = text || "";
  }

  async function render(study) {
    if (!ensurePanel()) return;
    const sid = Number(study && study.studyID != null ? study.studyID : study) || 0;
    currentStudyID = sid;
    if (!sid) {
      // حالتِ مراجعهٔ جدید: همان الگو ساخته می‌شود و بخش‌هایِ بافرشده پر می‌شوند.
      note("مراجعه هنوز ثبت نشده است؛ آنچه «تأیید و ثبت» کنید همراه با خودِ مراجعه ذخیره می‌شود.", false);
      renderList(Array.from(pendingSections.values()));
      return;
    }
    note("در حال دریافتِ بخش‌هایِ مراجعه…", false);
    let rows = [];
    let failure = null;
    try {
      const x = await api(`/api/studies/${sid}/sections`, { cache: "no-store" });
      rows = Array.isArray(x.sections) ? x.sections : [];
    } catch (e) {
      failure = e.message;
    }
    if (currentStudyID !== sid) return; // مراجعهٔ دیگری باز شده است
    note(failure ? `بخش‌ها خوانده نشد: ${failure}` : "", !!failure);
    // حتی اگر خواندن ناموفق بود، فرمِ الگو ساخته می‌شود تا صفحه خالی نماند.
    renderList(rows);
  }

  /* ================= پیش‌نویس (مراجعهٔ ثبت‌نشده) ================= */

  // با شروعِ یک مراجعهٔ جدید، بافرِ مراجعهٔ قبلی دور ریخته می‌شود.
  function resetDraft() {
    pendingSections.clear();
    rowsCache = new Map();
    currentStudyID = 0;
  }

  // بلافاصله پس از ثبتِ مراجعه: همهٔ بخش‌هایِ بافرشده یکی‌یکی ذخیره می‌شوند.
  // شکستِ یک بخش بقیه را متوقف نمی‌کند؛ شمارهٔ ناموفق‌ها در خطا گفته می‌شود.
  async function flushPending(studyID) {
    const sid = Number(studyID) || 0;
    if (!sid || pendingSections.size === 0) return 0;
    const queue = Array.from(pendingSections.values());
    currentStudyID = sid;
    const failed = [];
    let saved = 0;
    for (const row of queue) {
      try {
        const x = await api(`/api/studies/${sid}/sections`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(row)
        });
        pendingSections.delete(row.sectionCode);
        rowsCache.set(row.sectionCode, x.section || row);
        saved++;
      } catch (e) {
        failed.push(`${row.title}: ${e.message || "ثبت نشد"}`);
      }
    }
    if (failed.length) throw new Error(`ذخیرهٔ ${failed.length} بخش ناموفق بود — ${failed[0]}`);
    return saved;
  }

  /* ================= دیالوگِ «+ بخشِ دیگر» ================= */

  function buildDialog() {
    dialogEl = el("div", "gs-dialog");
    const box = el("div", "gs-dialog-box");
    box.append(el("h3", null, "افزودنِ بخش"));
    dialogListEl = el("div");
    const foot = el("div", "gsec-foot");
    foot.style.marginTop = "12px";
    const closeBtn = el("button", "gsec-btn", "بستن");
    closeBtn.type = "button";
    closeBtn.addEventListener("click", closeDialog);
    foot.append(closeBtn);
    box.append(dialogListEl, foot);
    dialogEl.append(box);
    dialogEl.addEventListener("click", (e) => { if (e.target === dialogEl) closeDialog(); });
    document.body.append(dialogEl);
  }

  function openDialog() {
    if (!dialogEl) buildDialog();
    dialogListEl.replaceChildren();
    const present = new Set(qsa(".gsec", listEl).map((s) => s.dataset.id));
    let any = false;
    EXTRA_DEFS.forEach((x) => {
      if (present.has(x.id)) return;
      any = true;
      const o = el("div", "gs-opt");
      o.append(el("span", null, x.title));
      const b = el("button", "gsec-btn small", "افزودن");
      b.type = "button";
      b.addEventListener("click", () => {
        if (!addedCodes.includes(x.id)) addedCodes.push(x.id);
        makeSection(x, rowsCache.get(x.id) || null);
        closeDialog();
      });
      o.append(b);
      dialogListEl.append(o);
    });
    if (!any) dialogListEl.append(el("div", "gs-opt", "همهٔ بخش‌ها افزوده شده‌اند."));
    dialogEl.classList.add("open");
  }

  function closeDialog() {
    if (dialogEl) dialogEl.classList.remove("open");
  }

  /* ================= پانل ================= */

  function ensurePanel() {
    if (panelEl && document.body.contains(panelEl)) return panelEl;
    const host = document.getElementById("studySectionsPanel");
    if (!host) return null;
    panelEl = el("div", "gs-panel");
    panelEl.append(el("div", "gs-hint",
      "تیک‌محور: انتخاب با یک کلیک و کلیکِ دوباره = لغو · ذخیره فقط با «تأیید و ثبت» · بخشِ ثبت‌شده را می‌توان دوباره باز کرد و اصلاح کرد."));
    noteEl = el("div", "gs-note hidden");
    listEl = el("div", "gs-list");
    const addbar = el("div", "gs-addbar");
    const add = el("button", "gs-add", "+ بخشِ دیگر");
    add.type = "button";
    add.addEventListener("click", openDialog);
    addbar.append(add);
    panelEl.append(noteEl, listEl, addbar);

    // Enter در فیلدها نباید فرمِ مراجعه را ثبت کند — ذخیره فقط از «تأیید و ثبت» است.
    panelEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target && e.target.tagName === "INPUT") e.preventDefault();
    });

    host.replaceChildren(panelEl);
    return panelEl;
  }

  // flushPending: ذخیرهٔ بخش‌هایِ بافرشده پس از ثبتِ مراجعه (app.js).
  // resetDraft: شروعِ دوبارهٔ یک مراجعهٔ جدید.
  window.ReSiRaiStudySections = { render, resetDraft, flushPending };
})();
