// ReSiRai - "sharayet-e feli" panel: the patient's current condition as structured,
// numeric factors the AI consultation can reason over.
//
// Definitions come from the shared dictionary (keyed by the visit's doctor),
// values are saved per visit and keep their source (manual here; lab-report
// extraction writes through the same API with source = 2). A value outside its
// reference range is flagged while it is typed, so the doctor sees it before AI.
//
// SuperAdmins get a "test mode" bar on top of the panel: it asks which specialty
// to test and loads that specialty's factor set, so the whole flow can be tried
// before any doctor is registered. Values recorded in test mode are still real
// values on the visit - the bar says so.
(function () {
    "use strict";

    const TEST_KEY = "reSiRaiTestSpecialty";

    const CATEGORY_LABELS = {
        Vitals: "علائم حیاتی",
        Anthropometry: "اندازه‌های بدن",
        History: "سابقه",
        Exam: "معاینه",
        Lab: "آزمایشگاه",
        Imaging: "تصویربرداری و نوار قلب",
        Score: "امتیازهای محاسبه‌شده"
    };

    let studyID = null;
    let currentStudy = null;
    let factors = [];
    let saving = false;
    // Values entered in the new-visit form before the visit row exists; they are
    // posted the moment the visit is created (commitPending).
    let pendingItems = [];
    // The panel that last rendered; the test bar re-renders that one, not some
    // other panel of the same page.
    let lastHost = null;
    let testState = loadTestState();

    function loadTestState() {
        try {
            const raw = localStorage.getItem(TEST_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                return { enabled: !!parsed.enabled, specialtyID: Number(parsed.specialtyID) || 0 };
            }
        } catch { }
        return { enabled: false, specialtyID: 0 };
    }

    function saveTestState() {
        try { localStorage.setItem(TEST_KEY, JSON.stringify(testState)); } catch { }
    }

    async function readJson(r) { try { return await r.json(); } catch { return { success: false }; } }

    function latestByFactor(values) {
        const map = new Map();
        for (const v of values || []) {
            const prev = map.get(v.factorID);
            if (!prev || new Date(v.observedAt) > new Date(prev.observedAt)) map.set(v.factorID, v);
        }
        return map;
    }

    // "80-306", "<200" or ">40" as printed on the sheet becomes the numeric
    // bounds the abnormality check needs.
    function parsePrintedRange(text) {
        const nums = (String(text).match(/\d+(?:[.,]\d+)?/g) || [])
            .map(x => Number(x.replace(",", ".")))
            .filter(x => Number.isFinite(x));
        if (nums.length >= 2) return { low: nums[0], high: nums[1] };
        if (nums.length === 1)
            return String(text).includes(">") ? { low: nums[0], high: null } : { low: null, high: nums[0] };
        return null;
    }

    function refHint(f) {
        if (f.refText) return f.refText;
        if (f.refLow !== null && f.refLow !== undefined && f.refHigh !== null && f.refHigh !== undefined)
            return `${f.refLow} تا ${f.refHigh}`;
        if (f.refHigh !== null && f.refHigh !== undefined) return `کمتر از ${f.refHigh}`;
        if (f.refLow !== null && f.refLow !== undefined) return `بیشتر از ${f.refLow}`;
        return "";
    }

    function isAbnormal(f, raw) {
        if (f.dataType !== 1 || raw === "" || raw === null || raw === undefined) return false;
        const n = Number(raw);
        if (!Number.isFinite(n)) return false;
        if (f.refLow !== null && f.refLow !== undefined && n < f.refLow) return true;
        if (f.refHigh !== null && f.refHigh !== undefined && n > f.refHigh) return true;
        return false;
    }

    function currentValueOf(f, latest) {
        const v = latest.get(f.factorID);
        if (!v) return "";
        if (f.dataType === 1 || f.dataType === 2) return v.valueNumber ?? "";
        if (f.dataType === 3) return v.valueBit === true ? "1" : (v.valueBit === false ? "0" : "");
        if (f.dataType === 4) return v.valueText ?? "";
        if (f.dataType === 5) {
            if (!v.valueDate) return "";
            return window.formatPersianDateForInput ? window.formatPersianDateForInput(v.valueDate) : v.valueDate;
        }
        return "";
    }

    function buildInput(f, value) {
        if (f.dataType === 2) {
            const select = document.createElement("select");
            select.appendChild(new Option("— انتخاب —", ""));
            let options = [];
            try { options = JSON.parse(f.optionsJson || "[]"); } catch { options = []; }
            for (const o of options) select.appendChild(new Option(o.t, String(o.v)));
            select.value = String(value ?? "");
            return select;
        }
        if (f.dataType === 3) {
            const select = document.createElement("select");
            select.appendChild(new Option("— انتخاب —", ""));
            select.appendChild(new Option("بله", "1"));
            select.appendChild(new Option("خیر", "0"));
            select.value = value === "" ? "" : String(value);
            return select;
        }
        const input = document.createElement("input");
        if (f.dataType === 1) { input.type = "number"; input.step = "any"; input.inputMode = "decimal"; }
        else if (f.dataType === 5) { input.type = "text"; input.setAttribute("data-jalali-date", ""); input.placeholder = "مثال: 1405/07/08"; }
        else { input.type = "text"; input.maxLength = 500; }
        input.value = value ?? "";
        return input;
    }

    function readValue(f, input) {
        const raw = (input.value ?? "").trim();
        if (raw === "") return null;
        if (f.dataType === 1) {
            const n = Number(raw);
            return Number.isFinite(n) ? { valueNumber: n } : null;
        }
        if (f.dataType === 2) return { valueNumber: Number(raw) };
        if (f.dataType === 3) return { valueBit: raw === "1" };
        if (f.dataType === 4) return { valueText: raw };
        if (f.dataType === 5) {
            try {
                const iso = window.parsePersianDateForBackend ? window.parsePersianDateForBackend(raw, false) : raw;
                return { valueDate: iso };
            } catch { return { valueText: raw }; }
        }
        return null;
    }

    function setStatus(host, message, isError) {
        const el = host.querySelector(".factors-status");
        if (!el) return;
        el.textContent = message || "";
        el.classList.toggle("error", !!isError);
    }

    // The admin test bar: "I am testing" + "which specialty?" - it reloads the
    // panel with the chosen specialty's factor set.
    function buildTestBar() {
        const bar = document.createElement("div");
        bar.className = "factors-testbar";

        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = !!(testState.enabled && testState.specialtyID);
        label.append(checkbox, document.createTextNode(" در حال تست هستم"));

        const question = document.createElement("span");
        question.className = "factors-testbar-question";
        question.textContent = "برای کدام تخصص تست می‌کنید؟";

        // ۱۳۰ ردیفِ تخصص: سلکت با «متن + datalist» عوض می‌شود تا تایپ فیلتر کند؛
        // SpecialtyID از همان fetch خوانده می‌شود و متنِ خالی یعنی «انتخاب نشده».
        const list = document.createElement("datalist");
        list.id = "factorsTestSpecialtyList";
        const input = document.createElement("input");
        input.type = "text";
        input.list = list.id;
        input.autocomplete = "off";
        input.placeholder = "— انتخاب تخصص —";
        input.disabled = !checkbox.checked;
        const entries = [];
        let chosen = Number(testState.specialtyID) || 0;
        const normSpec = s => String(s || "").replace(/\u200c/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
        const resolveSpecialty = () => {
            const want = normSpec(input.value);
            if (!want) return 0;
            const hit = entries.find(e => normSpec(e.name) === want)
                || entries.find(e => normSpec(e.name).includes(want) || want.includes(normSpec(e.name)));
            return hit ? hit.id : 0;
        };

        fetch("/api/admin/specialties", { cache: "no-store" }).then(readJson).then(x => {
            const rows = x.specialties || x.items || x.data || [];
            for (const s of rows) {
                const name = s.specialtyName || s.name || "";
                const id = s.specialtyID ?? s.id;
                if (id === undefined || !name) continue;
                entries.push({ id: Number(id) || 0, name: String(name) });
                list.appendChild(new Option(name));
            }
            const hit = entries.find(e => e.id === chosen);
            input.value = hit ? hit.name : "";
        }).catch(() => { });

        const hint = document.createElement("small");
        hint.className = "factors-testbar-hint";
        hint.textContent = "فقط برای نمایش فاکتورهای آن تخصص؛ مقادیری که ثبت کنید روی همین مراجعه می‌ماند.";

        const reload = () => { if (currentStudy) render(currentStudy, lastHost); };
        checkbox.addEventListener("change", () => {
            testState.enabled = checkbox.checked;
            if (!checkbox.checked) { testState.specialtyID = 0; chosen = 0; input.value = ""; }
            saveTestState();
            input.disabled = !checkbox.checked;
            reload();
        });
        // تایپ فقط فهرست را فیلتر می‌کند؛ انتخاب هنگامِ خروج از فیلد (یا Enter)
        // قطعی می‌شود تا هر حرف باعث رندرِ دوبارهٔ پنل نشود.
        input.addEventListener("change", () => {
            const id = resolveSpecialty();
            if (id === chosen) return;
            chosen = id;
            testState.specialtyID = id;
            saveTestState();
            reload();
        });
        input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } });

        bar.append(label, question, input, list, hint);
        return bar;
    }

    async function render(study, hostOverride) {
        const host = hostOverride || document.getElementById("studyFactorsPanel") || ensurePanelExists();
        if (!host || !study) return;
        lastHost = host;
        studyID = Number(study.studyID) || 0;
        currentStudy = study;
        // Every handler reads the study from its own host, so the same panel can
        // live in both the visit card and the details form without clashing.
        host.dataset.renderedFor = String(studyID);
        host.dataset.studyId = String(studyID);
        host.replaceChildren();

        const content = document.createElement("div");
        content.className = "factors-content";
        host.appendChild(content);
        // The test bar is available to every user of this installation; it only
        // switches the displayed specialty and says so on its face.
        host.insertBefore(buildTestBar(), content);

        const note = document.createElement("div");
        note.className = "factors-empty";
        note.textContent = "در حال دریافت فاکتورها...";
        content.appendChild(note);

        try {
            const params = [];
            if (studyID) params.push(`studyID=${studyID}`);
            if (testState.enabled && testState.specialtyID) params.push(`specialtyID=${testState.specialtyID}`);
            const defUrl = `/api/factors/definitions${params.length ? "?" + params.join("&") : ""}`;
            const [defRes, valRes] = await Promise.all([
                fetch(defUrl, { cache: "no-store" }).then(readJson),
                studyID
                    ? fetch(`/api/factors/values?studyID=${studyID}`, { cache: "no-store" }).then(readJson)
                    : Promise.resolve({ success: true, values: [] })
            ]);
            if (!defRes.success) throw new Error(defRes.message || "دریافت فاکتورها ناموفق بود.");

            factors = defRes.factors || [];
            const latest = latestByFactor(valRes.values);
            // The range and unit printed on the patient's own sheet outrank the
            // dictionary's default: ranges differ per lab, age and sex. An
            // extracted value shows ONLY what the paper printed - never a
            // dictionary range that may belong to another lab.
            for (const f of factors) {
                const v = latest.get(f.factorID);
                if (!v) continue;
                if (v.source === 2) {
                    f.refText = v.valueRefText || "";
                    const r = v.valueRefText ? parsePrintedRange(v.valueRefText) : null;
                    if (r) { f.refLow = r.low; f.refHigh = r.high; }
                    else { f.refLow = null; f.refHigh = null; }
                } else if (v.valueRefText) {
                    f.refText = v.valueRefText;
                    const r = parsePrintedRange(v.valueRefText);
                    if (r) { f.refLow = r.low; f.refHigh = r.high; }
                }
                if (v.valueUnitText) f.unitUCUM = v.valueUnitText;
            }
            // Earlier visits' values of the same factors, oldest first - the
            // little trend beside each row.
            const history = new Map();
            for (const h of (valRes.history || []).slice().reverse()) {
                if (h.valueNumber === null || h.valueNumber === undefined) continue;
                if (!history.has(h.factorID)) history.set(h.factorID, []);
                history.get(h.factorID).push(Number(h.valueNumber));
            }
            content.replaceChildren();
            if (factors.length === 0) {
                const empty = document.createElement("div");
                empty.className = "factors-empty";
                empty.textContent = "برای این تخصص هنوز فاکتوری تعریف نشده است.";
                content.appendChild(empty);
                return;
            }

            // هر دسته، بخشِ بازشونده با عنوانِ مناسب و شمارنده است (علائم
            // حیاتی، آزمایشگاه، …) — پنل دیگر اسکرولِ زیاد نمی‌خواهد.
            // ترتیبِ دسته‌ها باید یکدست باشد وگرنه هر دسته چند بار ساخته می‌شود
            // (کدهای LAB.CUSTOM بعد از IMG.* می‌آمدند و «آزمایشگاه» تکرار می‌شد).
            const catOrder = ["Vitals", "Anthropometry", "History", "Exam", "Lab", "Imaging", "Score"];
            const byCategory = [...factors].sort((a, b) =>
                (catOrder.indexOf(a.category) + 1 || 99) - (catOrder.indexOf(b.category) + 1 || 99));
            // بیمارِ مرد: فاکتورِ «بارداری/شیردهی» (HIST.PREG) بی‌معنی است — نه
            // ساخته می‌شود نه در شمارشِ دسته می‌آید؛ مصرف‌کننده‌ها null را رد می‌کنند.
            if (Number(window.selectedPatient?.gender) === 1) {
                for (let i = byCategory.length - 1; i >= 0; i--)
                    if (byCategory[i].factorCode === "HIST.PREG") byCategory.splice(i, 1);
            }
            const counts = {};
            for (const f of byCategory) counts[f.category] = (counts[f.category] || 0) + 1;

            // جست‌وجوی سریع: با تایپ، ردیف‌ها فیلتر و گروهِ درست خودکار باز
            // می‌شود — رسیدن به هر تست بدونِ اسکرول و با حداقلِ کلیک.
            const searchWrap = document.createElement("div");
            searchWrap.className = "factors-search";
            const searchInput = document.createElement("input");
            searchInput.type = "search";
            searchInput.id = "factorsQuickSearch";
            searchInput.placeholder = "جست‌وجوی سریع تست… (تایپ یا دیکتهٔ صوتی — مثلاً «اچ بی» یا کراتینین)";
            searchWrap.appendChild(searchInput);
            content.appendChild(searchWrap);
            const norm = s => String(s || "").toLowerCase()
                .replace(/\u200c/g, " ").replace(/[يئ]/g, "ی").replace(/ك/g, "ک")
                .replace(/\s+/g, " ").trim();
            // تلفظِ حروفِ انگلیسی هم پذیرفته می‌شود: «اچ بی» ← Hb، «دبلیو بی سی» ← WBC.
            const letterMap = new Map([
                ["دبلیو", "w"], ["اکس", "x"], ["کیو", "q"], ["اچ", "h"], ["آر", "r"], ["اس", "s"],
                ["بی", "b"], ["سی", "c"], ["دی", "d"], ["ای", "e"], ["اف", "f"], ["جی", "g"],
                ["آی", "i"], ["کی", "k"], ["ال", "l"], ["ام", "m"], ["ان", "n"], ["او", "o"],
                ["پی", "p"], ["تی", "t"], ["یو", "u"], ["وی", "v"], ["وای", "y"], ["زد", "z"]
            ]);
            const faToLatin = s => {
                let out = "";
                for (const t of norm(s).split(" ").filter(Boolean)) {
                    const ch = letterMap.get(t) || letterMap.get(t.replace(/[\u064B-\u0652\u0640]/g, ""));
                    if (!ch) return "";
                    out += ch;
                }
                return out;
            };
            searchInput.addEventListener("input", () => {
                const q = norm(searchInput.value);
                const qLetters = faToLatin(searchInput.value);
                for (const g of content.querySelectorAll(".factors-group")) {
                    let visible = 0;
                    for (const row of g.querySelectorAll(".factor-row")) {
                        const hay = norm(row.dataset.search);
                        const hit = q.length === 0 || hay.includes(q)
                            || (qLetters.length > 0 && hay.includes(qLetters));
                        row.style.display = hit ? "" : "none";
                        if (hit) visible++;
                    }
                    g.style.display = visible ? "" : "none";
                    if (q.length > 0) { if (visible) g.open = true; }
                    else g.open = false;
                }
            });

            let group = null;
            let weightRow = null;
            let heightRow = null;
            let bmiRow = null;
            let egfrRow = null;
            let creatRow = null;
            let pregRow = null;
            let waistRow = null;
            for (const f of byCategory) {
                if (!group || group.dataset.category !== f.category) {
                    group = document.createElement("details");
                    group.className = "factors-group";
                    group.dataset.category = f.category;
                    group.open = false;
                    const groupTitle = document.createElement("summary");
                    groupTitle.className = "factors-group-title";
                    groupTitle.textContent = `${CATEGORY_LABELS[f.category] || f.category} — ${counts[f.category]} مورد`;
                    group.appendChild(groupTitle);
                    content.appendChild(group);
                }

                const row = document.createElement("div");
                row.className = "factor-row";
                row.dataset.factorId = String(f.factorID);
                // برایِ جست‌وجوی سریع: نامِ فارسی، کوتاه و کدِ فاکتور.
                row.dataset.search = [f.nameFa, f.nameEn, f.shortCode, f.factorCode]
                    .filter(Boolean).join(" ");
                if (f.factorCode === "ANTH.HEIGHT") heightRow = row;
                if (f.factorCode === "ANTH.WEIGHT") weightRow = row;
                if (f.factorCode === "ANTH.BMI") bmiRow = row;
                if (f.factorCode === "LAB.EGFR") egfrRow = row;
                if (f.factorCode === "LAB.CREAT") creatRow = row;
                if (f.factorCode === "HIST.PREG") pregRow = row;
                if (f.factorCode === "ANTH.WC") waistRow = row;

                const label = document.createElement("label");
                label.textContent = f.nameFa + " ";
                if (f.shortCode) {
                    // The lab sheet's short code (Hb, WBC) beside the Persian name,
                    // so screen and paper read alike.
                    const code = document.createElement("small");
                    code.className = "factor-short";
                    code.textContent = `(${f.shortCode})`;
                    label.appendChild(code);
                    label.appendChild(document.createTextNode(" "));
                }
                if (f.isRequired) {
                    const req = document.createElement("span");
                    req.className = "factor-required";
                    req.textContent = "*";
                    label.appendChild(req);
                }
                if (f.unitUCUM) {
                    const unit = document.createElement("small");
                    unit.textContent = `(${f.unitUCUM})`;
                    label.appendChild(unit);
                }

                const input = buildInput(f, currentValueOf(f, latest));
                input.addEventListener("input", () => row.classList.toggle("abnormal", isAbnormal(f, input.value)));
                input.addEventListener("change", () => row.classList.toggle("abnormal", isAbnormal(f, input.value)));
                row.classList.toggle("abnormal", isAbnormal(f, input.value));

                const ref = document.createElement("span");
                ref.className = "factor-ref";
                ref.textContent = refHint(f);
                ref.title = `${f.refSource || ""}${f.refPopulation ? " - " + f.refPopulation : ""}`;

                const flag = document.createElement("span");
                flag.className = "factor-flag";
                flag.textContent = "خارج از بازه طبیعی";

                const trend = document.createElement("span");
                trend.className = "factor-trend";
                const past = history.get(f.factorID) || [];
                if (f.dataType === 1 && past.length) {
                    const current = Number(input.value);
                    const arrow = input.value !== "" && Number.isFinite(current)
                        ? (current > past[past.length - 1] ? "↑" : current < past[past.length - 1] ? "↓" : "→")
                        : "";
                    trend.textContent = (arrow + " " + past.slice(-3).join("، ")).trim();
                    trend.title = "مقادیر قبلی (قدیمی → جدید): " + past.join("، ");
                }

                // دکمهٔ تاریخچه: پنل «سابقهٔ فاکتور» را با جدول و نمودار باز می‌کند.
                // در فرم مراجعهٔ جدید، بیمار را مستقیم می‌فرستیم چون StudyID هنوز نیست.
                const historyBtn = document.createElement("button");
                historyBtn.type = "button";
                historyBtn.className = "factor-history-button";
                historyBtn.textContent = "سابقه";
                historyBtn.title = "مشاهدهٔ همهٔ مقادیر این فاکتور با تاریخ و نمودار";
                historyBtn.addEventListener("click", () => {
                    const currentStudyID = Number(host.dataset.studyId) || 0;
                    window.ReSiRaiFactorsHistory?.openFactor(
                        f.factorID,
                        currentStudyID ? { studyID: currentStudyID } : { patientID: window.selectedPatientID || 0 }
                    );
                });

                row.append(label, input, ref, flag, trend, historyBtn);
                group.appendChild(row);
            }

            // Under BMI: the patient's suitable weight range for their height,
            // plus the sex-specific ideal weight (Devine) when sex is known.
            if (bmiRow) {
                const note = document.createElement("div");
                note.className = "factor-weight-range";
                bmiRow.parentNode.insertBefore(note, bmiRow.nextSibling);
                // Personal weight guide: the base range plus the adjustments a
                // real clinic makes (age, sex, pregnancy, waist), each with its
                // source - and the cautions no formula can see.
                const refreshNote = () => {
                    const hEl = heightRow ? heightRow.querySelector("input, select") : null;
                    const h = Number(hEl && hEl.value);
                    const gender = Number(window.selectedPatient?.gender) || 0;
                    note.replaceChildren();
                    const line = (text, warn) => {
                        const d = document.createElement("div");
                        if (warn) d.className = "factor-weight-warn";
                        d.textContent = text;
                        note.appendChild(d);
                    };
                    if (!(h > 50 && h < 260)) {
                        line("برای نمایش راهنمای وزن، قد را وارد کنید.");
                        return;
                    }
                    const m = h / 100;
                    const band = (loBmi, hiBmi) =>
                        `${(loBmi * m * m).toFixed(0)} تا ${(hiBmi * m * m).toFixed(0)} کیلو`;
                    line(`بازه وزن سالم برای قد ${Math.round(h)}${gender ? ` (${gender === 2 ? "زن" : "مرد"})` : ""}: ${band(18.5, 24.9)} — BMI ۱۸.۵ تا ۲۴.۹ (WHO)`);
                    const birth = window.selectedPatient?.birthDate ? new Date(window.selectedPatient.birthDate) : null;
                    const age = birth && !isNaN(birth.getTime())
                        ? Math.floor((Date.now() - birth.getTime()) / (365.25 * 24 * 3600 * 1000)) : 0;
                    if (age >= 65)
                        line(`سن ${age}: در سالمندی هدف BMI حدود ۲۲ تا ۲۷ بهتر است → ${band(22, 27)} (پیشگیری از لاغری و شکستگی).`);
                    if (gender && h >= 152) {
                        const ideal = (gender === 2 ? 45.5 : 50) + 2.3 * (h / 2.54 - 60);
                        line(`وزن ایده‌آل (Devine، ${gender === 2 ? "زن" : "مرد"}): ${ideal.toFixed(0)} کیلو.`);
                    }
                    const pregEl = pregRow ? pregRow.querySelector("input, select") : null;
                    const preg = Number(pregEl && pregEl.value);
                    if (preg === 1)
                        line("بارداری: هدف، افزایش وزن توصیه‌شده (IOM) بر پایه BMI پیش از بارداری است؛ محدودیت سخت کالری توصیه نمی‌شود.", true);
                    else if (preg === 2)
                        line("شیردهی: محدودیت سخت کالری توصیه نمی‌شود؛ کاهش وزن باید آرام و تدریجی باشد.", true);
                    const waistEl = waistRow ? waistRow.querySelector("input, select") : null;
                    const waist = Number(waistEl && waistEl.value);
                    const waistLimit = gender === 2 ? 88 : 102;
                    if (waist > 0) {
                        if (waist >= waistLimit)
                            line(`دور کمر ${Math.round(waist)}: چاقی مرکزی (آستانه زن ۸۸ / مرد ۱۰۲ — NHLBI)؛ ریسک متابولیک مستقل از BMI بالاست.`, true);
                        else
                            line(`دور کمر ${Math.round(waist)}: زیر آستانه چاقی مرکزی (زن ۸۸ / مرد ۱۰۲).`);
                    }
                    line("توجه: برای افراد عضلانی/ورزشکار، ادم یا آسیت، و بیماری مزمن (دیابت، COPD، نارسایی قلب/کلیه) هدف وزنی فردی است.", true);
                    const wEl = weightRow ? weightRow.querySelector("input, select") : null;
                    const w = Number(wEl && wEl.value);
                    if (w > 10 && w >= 24.9 * m * m)
                        line(`هدف واقع‌بینانه کاهش وزن: ۵ تا ۱۰ درصد وزن فعلی (${(w * 0.05).toFixed(0)} تا ${(w * 0.10).toFixed(0)} کیلو).`);
                };
                // BMI and eGFR are facts of arithmetic: their fields are locked
                // and fill themselves as the measurements arrive. There is no
                // honest way to type them by hand.
                const lock = (input, why) => {
                    if (!input) return;
                    input.readOnly = true;
                    input.classList.add("factor-derived");
                    input.title = why;
                };
                const bmiInput = bmiRow.querySelector("input, select");
                lock(bmiInput, "محاسبه‌شده از قد و وزن - قابل ورود دستی نیست");
                const egfrInput = egfrRow ? egfrRow.querySelector("input, select") : null;
                lock(egfrInput, "محاسبه‌شده از کراتینین، سن و جنسیت - قابل ورود دستی نیست");
                const refreshDerived = () => {
                    const hEl = heightRow ? heightRow.querySelector("input, select") : null;
                    const wEl = weightRow ? weightRow.querySelector("input, select") : null;
                    const h = Number(hEl && hEl.value), w = Number(wEl && wEl.value);
                    if (bmiInput && h > 50 && h < 260 && w > 10 && w < 400) {
                        const m = h / 100;
                        const bmi = Math.round((w / (m * m)) * 10) / 10;
                        if (bmiInput.value !== String(bmi)) {
                            bmiInput.value = String(bmi);
                            bmiInput.dispatchEvent(new Event("input"));
                        }
                    }
                    if (egfrInput) {
                        const cEl = creatRow ? creatRow.querySelector("input, select") : null;
                        const cr = Number(cEl && cEl.value);
                        const birth = window.selectedPatient?.birthDate ? new Date(window.selectedPatient.birthDate) : null;
                        const gender = Number(window.selectedPatient?.gender) || 0;
                        if (cr > 0.1 && cr < 15 && birth && !isNaN(birth.getTime())) {
                            const age = Math.floor((Date.now() - birth.getTime()) / (365.25 * 24 * 3600 * 1000));
                            const female = gender === 2;
                            const k = female ? 0.7 : 0.9;
                            const a = female ? -0.241 : -0.302;
                            // CKD-EPI 2021 (race-free).
                            const egfr = 142 * Math.pow(Math.min(cr / k, 1), a) * Math.pow(Math.max(cr / k, 1), -1.2)
                                * Math.pow(0.9938, age) * (female ? 1.012 : 1);
                            const v = String(Math.round(egfr * 10) / 10);
                            if (egfr > 0 && egfr < 300 && egfrInput.value !== v) {
                                egfrInput.value = v;
                                egfrInput.dispatchEvent(new Event("input"));
                            }
                        }
                    }
                };
                const hInput = heightRow ? heightRow.querySelector("input, select") : null;
                const wInput = weightRow ? weightRow.querySelector("input, select") : null;
                const cInput = creatRow ? creatRow.querySelector("input, select") : null;
                const waInput = waistRow ? waistRow.querySelector("input, select") : null;
                const pInput = pregRow ? pregRow.querySelector("input, select") : null;
                for (const el of [hInput, wInput, cInput, waInput, pInput]) {
                    if (!el) continue;
                    el.addEventListener("input", () => { refreshNote(); refreshDerived(); });
                    el.addEventListener("change", () => { refreshNote(); refreshDerived(); });
                }
                refreshNote();
                refreshDerived();
            }

            const footer = document.createElement("div");
            footer.className = "factors-footer";
            const saveBtn = document.createElement("button");
            saveBtn.type = "button";
            saveBtn.className = "primary-button";
            saveBtn.textContent = studyID ? "ثبت مقادیر" : "آماده‌سازی مقادیر";
            saveBtn.addEventListener("click", () => save(host, saveBtn));
            const extractBtn = document.createElement("button");
            extractBtn.type = "button";
            extractBtn.className = "secondary-button";
            extractBtn.textContent = "استخراج از برگه آزمایش";
            extractBtn.addEventListener("click", () => window.ReSiRaiLabExtract?.open(Number(host.dataset.studyId) || 0));
            const consultBtn = document.createElement("button");
            consultBtn.type = "button";
            consultBtn.className = "primary-button";
            consultBtn.textContent = "مشاوره با هوش مصنوعی";
            consultBtn.addEventListener("click", () => {
                const specialty = testState.enabled && testState.specialtyID ? testState.specialtyID : null;
                const myID = Number(host.dataset.studyId) || 0;
                if (myID) { window.ReSiRaiConsult?.open(myID, specialty); return; }
                // New-visit form: the consultation runs over what is typed in
                // right now. When the data is not enough, the AI says what is
                // missing instead of guessing.
                window.ReSiRaiConsult?.openDraft({
                    patientID: window.selectedPatientID || null,
                    description: document.getElementById("newStudyDescription")?.value || "",
                    specialtyID: specialty,
                    items: collectItems(host)
                });
            });
            const status = document.createElement("span");
            status.className = "factors-status";
            footer.append(saveBtn, extractBtn, consultBtn, status);
            // The three actions live on top of the panel - reachable without
            // scrolling past fifty rows first.
            content.insertBefore(footer, content.firstChild);

            window.ReSiRaiJalali?.enhanceAll(content);
        } catch (e) {
            content.replaceChildren();
            const err = document.createElement("div");
            err.className = "factors-empty";
            err.textContent = e.message || "دریافت فاکتورها ناموفق بود.";
            content.appendChild(err);
        }
    }

    // Reads the typed values of one panel; shared by saving, pre-save collection
    // and the pre-save consultation.
    function collectItems(host) {
        const items = [];
        for (const f of factors) {
            const row = host.querySelector(`.factor-row[data-factor-id="${f.factorID}"]`);
            if (!row) continue;
            const input = row.querySelector("input, select");
            if (!input) continue;
            // BMI and eGFR never travel as typed values: the server derives
            // them from the measurements (source = computed).
            if (f.factorCode === "ANTH.BMI" || f.factorCode === "LAB.EGFR") continue;
            const value = readValue(f, input);
            if (!value) continue;
            items.push(Object.assign({ factorID: f.factorID, source: 1 }, value));
        }
        return items;
    }

    async function save(host, button) {
        const targetStudyID = Number(host.dataset.studyId) || 0;
        if (saving) return;
        const items = collectItems(host);
        if (items.length === 0) { setStatus(host, "هیچ مقداری برای ثبت وارد نشده است.", true); return; }

        if (!targetStudyID) {
            // New-visit form: hold the values and post them right after the
            // visit row is created (commitPending).
            pendingItems = items.concat(pendingItems.filter(p => !items.some(i => i.factorID === p.factorID)));
            setStatus(host, `${items.length} مقدار آماده شد؛ با ثبتِ مراجعه ذخیره می‌شوند.`, false);
            return;
        }

        try {
            saving = true;
            button.disabled = true;
            button.textContent = "در حال ثبت...";
            setStatus(host, "", false);
            const r = await fetch("/api/factors/values", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ studyID: targetStudyID, items })
            });
            const x = await readJson(r);
            if (!r.ok || !x.success) throw new Error(x.message || "ثبت مقادیر ناموفق بود.");
            setStatus(host, `${x.saved} مقدار ثبت شد.`, false);
        } catch (e) {
            setStatus(host, e.message || "ثبت مقادیر ناموفق بود.", true);
        } finally {
            saving = false;
            button.disabled = false;
            button.textContent = SAVE_LABEL;
        }
    }

    // --- pre-save collection (new-visit form) -----------------------
    // Extraction review, before the visit exists, hands its confirmed rows
    // here: they fill the form and wait for the visit to be created.
    function addPending(items) {
        const incoming = items || [];
        pendingItems = incoming.concat(pendingItems.filter(p => !incoming.some(i => i.factorID === p.factorID)));
        const host = document.getElementById("studyFactorsPanel");
        if (!host) return;
        for (const it of incoming) {
            const row = host.querySelector(`.factor-row[data-factor-id="${it.factorID}"]`);
            if (!row) continue;
            const input = row.querySelector("input, select");
            if (!input) continue;
            if (input.type === "checkbox") input.checked = !!it.valueBit;
            else if (it.valueNumber !== undefined && it.valueNumber !== null) input.value = String(it.valueNumber);
            else if (it.valueText !== undefined && it.valueText !== null) input.value = it.valueText;
            else if (it.valueDate) input.value = String(it.valueDate).slice(0, 10);
            input.dispatchEvent(new Event("input"));
        }
    }

    // شروعِ یک مراجعهٔ جدید: پیش‌نویسِ مراجعهٔ انصرافی نباید به مراجعهٔ بعدی سرایز کند.
    function resetDraft() {
        pendingItems = [];
    }

    // Called by app.js the moment a new visit is created.
    async function commitPending(targetStudyID) {
        if (pendingItems.length === 0) return 0;
        const items = pendingItems;
        pendingItems = [];
        try {
            const r = await fetch("/api/factors/values", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ studyID: Number(targetStudyID), items })
            });
            const x = await readJson(r);
            if (!r.ok || !x.success) throw new Error(x.message || "ثبت مقادیر ناموفق بود.");
            return x.saved || 0;
        } catch (e) {
            pendingItems = items;
            throw e;
        }
    }

    // --- self-mounting -------------------------------------------------
    // The panel builds its own home and renders itself when a visit card opens,
    // so it works even when the browser serves an old cached copy of index.html
    // or app.js. Nothing outside this file is required for the panel to appear.
    function ensurePanelExists() {
        let host = document.getElementById("studyFactorsPanel");
        if (host) return host;
        // فرمِ واحدِ مراجعه (ثبتِ جدید و ویرایش، هر دو) با این شناسه ساخته شده است.
        const form = document.getElementById("newStudyForm");
        if (!form) return null;
        const section = document.createElement("section");
        section.className = "study-form-card";
        const title = document.createElement("h3");
        title.className = "study-form-card-title";
        title.textContent = "شرایط فعلی بیمار";
        host = document.createElement("div");
        host.id = "studyFactorsPanel";
        host.className = "factors-panel";
        section.append(title, host);
        const anchor = document.getElementById("studyDetailsStatus");
        if (anchor) form.insertBefore(section, anchor);
        else form.appendChild(section);
        return host;
    }

    function selfMount() {
        ensurePanelExists();
        const section = document.getElementById("studyDetailsSection");
        if (section) {
            // یک پنل برای هر دو حالتِ فرمِ ادغام‌شده: اگر StudyID باشد همان مراجعه
            // است، وگرنه (مراجعهٔ جدید) پیش‌نویسی که با ثبتِ مراجعه تسویه می‌شود.
            const tryRender = () => {
                if (section.classList.contains("hidden")) return;
                const host = ensurePanelExists();
                if (!host) return;
                const study = window.selectedStudy;
                const id = study && Number(study.studyID) > 0 ? Number(study.studyID) : 0;
                if (host.dataset.renderedFor === String(id)) return; // همین حالا رندر شده
                render(id ? study : { studyID: 0 }, host);
            };
            new MutationObserver(tryRender).observe(section, { attributes: true, attributeFilter: ["class"] });
            tryRender();
        }
    }

    // The visit card («نمایش») is the screen actually opened when a visit is
    // reviewed, so the panel lives there too, on top of the card body.
    function renderCard(study, body) {
        if (!study || !body) return;
        let host = body.querySelector(".factors-card-section .factors-panel");
        if (!host) {
            const section = document.createElement("section");
            section.className = "study-form-card factors-card-section";
            const title = document.createElement("h3");
            title.className = "study-form-card-title";
            title.textContent = "شرایط فعلی بیمار";
            host = document.createElement("div");
            host.className = "factors-panel";
            section.append(title, host);
            body.prepend(section);
        }
        if (host.dataset.renderedFor !== String(study.studyID)) render(study, host);
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", selfMount);
    else selfMount();

    window.ReSiRaiFactors = { render, renderCard, addPending, commitPending, resetDraft };
})();
