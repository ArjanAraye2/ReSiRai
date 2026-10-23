// ReSiRai — معرفیِ بیمار بدونِ ناوبری
//
// قرارداد (توافقِ ۱۴۰۵/۰۷/۱۶، فازِ پزشکِ عمومی):
//  - ناحیهٔ معرفیِ بیمار **همیشه بالایِ فهرستِ بیماران** است؛ هیچ صفحه‌ای باز نمی‌شود.
//  - **اول کدِ ملی**: تا کدِ ملیِ کامل (۱۰ رقمِ معتبر) وارد نشود، بقیه فیلدها
//    فقط‌خواندنی‌اند.
//  - کدِ ملی کامل شد و بیمار در جدول نبود ← بقیه فیلدها باز می‌شوند؛ هر وقت
//    حداقلِ اطلاعات لازم (نام، نامِ خانوادگی، جنسیت) کامل شد، **کلیدِ «ثبت»
//    کنارِ همان فیلدی که کرسر در آن است** ظاهر می‌شود و با کلیک، بیمار ثبت و
//    پرونده‌اش باز می‌شود (آمادهٔ ثبتِ مراجعه).
//  - کدِ ملی با موجودیتِ بیمار منطبق شد دو حالت دارد:
//      ۱) بیمار سابقهٔ مراجعه دارد (از هر پزشکی) ← در فهرستِ بیماران ردیفِ او
//         نشان/اسکرول می‌شود؛ پرونده‌اش فقط مراجعه‌های همین پزشک را نشان می‌دهد
//         و «مراجعهٔ جدید» برای ثبتِ مراجعهٔ تازه در دسترس است.
//      ۲) بیمار هیچ مراجعه‌ای ندارد ← اطلاعات در همین باکس‌ها نمایش داده
//         می‌شود و «ثبت مراجعه» پرونده را برای ثبتِ اولین مراجعه باز می‌کند.
//  - پروندهٔ بیمار مشترک و ثابت است؛ مراجعه‌ها متعلق به هر پزشک‌اند.
//  - مطب فقط ستونِ داخلی است؛ از `visit-context` می‌آید و در UI نیست.
(() => {
    "use strict";

    const SAME_HINT = "بیمار در فهرست است — ردیفِ او نشان داده می‌شود";
    const NO_STUDY_HINT = "بیمار موجود است (بدونِ مراجعه) — «ثبت مراجعه» را بزنید";
    const ACTION_VISIT = "ثبت مراجعه برای همین بیمار";
    const ACTION_OPEN = "باز کردن پرونده و ثبت مراجعه";

    const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
    const readJson = async r => { try { return await r.json(); } catch { return {}; } };
    const digits = v => (window.normalizeDigits ? window.normalizeDigits(v) : String(v || ""));
    const onlyDigits = v => digits(v).replace(/\D/g, "");
    const fmtDate = v => (window.formatPersianDateForInput ? window.formatPersianDateForInput(v) : "");
    const toBackDate = v => (window.parsePersianDateForBackend ? window.parsePersianDateForBackend(v, false) : null);
    const nullIfEmpty = v => (window.emptyToNull ? window.emptyToNull(String(v == null ? "" : v)) : (String(v || "").trim() ? v : null));

  const ctx = { clinicID: null, doctorStaffID: null, specialtyID: null, ready: false };
    let ctxPromise = null;
    function loadContext() {
        if (ctxPromise) return ctxPromise;
        ctxPromise = fetch("/api/visit-context", { cache: "no-store" }).then(readJson).then(x => {
            ctx.clinicID = x.clinicID ?? null;
            ctx.doctorStaffID = x.doctorStaffID ?? null;
            ctx.specialtyID = x.specialtyID ?? null;
            ctx.ready = true;
            return ctx;
        }).catch(() => { ctx.ready = true; return ctx; });
        return ctxPromise;
    }

    const state = { card: null, rows: {}, found: null, lookupToken: 0, hint: null, status: null };

    function mkInput(id, placeholder, attrs) {
        const t = el("input", "visit-input");
        t.type = "text";
        if (id) t.id = id;
        if (placeholder) t.placeholder = placeholder;
        (attrs || []).forEach(a => t.setAttribute(a, ""));
        return t;
    }

    function addRow(body, key, label, input) {
        const row = el("div", "visit-field-row");
        row.dataset.key = key;
        const lab = el("label", "visit-field-label", label);
        const box = el("div", "visit-field-input");
        box.appendChild(input);
        const save = el("button", "visit-field-save hidden", "ثبت");
        save.type = "button";
        save.title = "ثبتِ بیمار تازه (بعد از کامل شدنِ حداقلِ اطلاعات لازم)";
        row.append(lab, box, save);
        state.rows[key] = { row, input, save }; body.appendChild(row);
        
        // ردیف به بدنه اضافه می‌شود (build از آن صدا می‌زند و بدنه را می‌شناسد).
        
        return row;
    }

    function build() {
        const card = el("article", "patient-draft-card");
        const head = el("header", "study-draft-head");
        const title = el("div", "patient-draft-title");
        const badge = el("span", "patient-draft-badge", "معرفیِ بیمار");
        title.append(badge, " ", document.createTextNode("اول کدِ ملی — در صورتِ نبود، بقیه باز می‌شود"));
        head.appendChild(title);
        const hintEl = el("span", "patient-draft-hint");
        head.appendChild(hintEl);
        state.hint = hintEl;

        const body = el("div", "patient-draft-body");
        body.className = "patient-draft-body visit-fields";

        const code = mkInput("patientDraftNationalCode", "کد ملی ۱۰ رقمی", ["inputmode", "numeric", "maxlength"]);
        code.setAttribute("inputmode", "numeric");
        code.setAttribute("maxlength", "10");
        code.setAttribute("data-dic", "1");
        addRow(body, "nationalCode", "کد ملی", code);

        const first = mkInput("patientDraftFirstName", "نام");
        first.maxLength = 100;
        first.setAttribute("data-dic", "1");
        addRow(body, "firstName", "نام", first);

        const last = mkInput("patientDraftLastName", "نام خانوادگی");
        last.maxLength = 100;
        last.setAttribute("data-dic", "1");
        addRow(body, "lastName", "نام خانوادگی", last);

        const gender = el("select", "visit-input");
        gender.id = "patientDraftGender";
        gender.dataset.emptyLabel = "انتخاب نشده";
        addRow(body, "gender", "جنسیت", gender);

        const mobile = mkInput("patientDraftMobile", "موبایل (اختیاری)");
        mobile.maxLength = 30;
        mobile.setAttribute("inputmode", "tel");
        mobile.setAttribute("data-dic", "1");
        addRow(body, "mobile", "موبایل", mobile);

        const birth = mkInput("patientDraftBirthDate", "YYYY/MM/DD (اختیاری)", ["data-jalali-date"]);
        birth.maxLength = 10;
        birth.setAttribute("inputmode", "numeric");
        birth.setAttribute("data-dic", "1");
        addRow(body, "birthDate", "تاریخ تولد", birth);

        card.append(head, body);

        // بیمارِ موجود (چه سابقه داشته باشد چه نه): یک اقدامِ روشن برای ثبتِ
        // مراجعه. فقطوقتی بیمار شناسایی شود دیده می‌شود.
        const actionBar = el("div", "patient-draft-actions hidden");
        const action = el("button", "primary-button", ACTION_VISIT);
        action.type = "button";
        action.addEventListener("click", ev => { ev.preventDefault(); openFoundPatient(); });
        actionBar.appendChild(action);
        card.append(actionBar);
        state.actionBar = actionBar;
        state.action = action;

        state.card = card;
        eachInput(code, "nationalCode");
        eachInput(first, "firstName");
        eachInput(last, "lastName");
        eachInput(gender, "gender");
        eachInput(mobile, "mobile");
        eachInput(birth, "birthDate");
        [first, last, gender, mobile, birth].forEach(input => { input.readOnly = true; });

        // ثبتِ بیمار تازه: با کلیکِ ثبتِ هر فیلد، همه با هم می‌روند.
        Object.values(state.rows).forEach(r => r.save.addEventListener("click", ev => {
            ev.preventDefault();
            register();
        }));

        // گزینه‌های جنسیت (خودِ دادهٔ فرمِ قدیمی).
        (async () => {
            // بدونِ سربرگِ اضافه؛ همان سه گزینهٔ فرمِ قدیمی.
        })();

        return card;
    }

    // گوش دادن به تغییرِ هر فیلد: قفل/باز و «ثبت» کنارِ همان فیلد (حتی بدونِ کرسر —
    // مثل وقتی که با دیکته متن اضافه می‌شود و کرسر رویِ دکمهٔ میکروفن است).
    function eachInput(input, key) {
        const handler = () => onAnyChange(key);
        input.addEventListener("input", handler);
        input.addEventListener("change", handler);
        input.addEventListener("focus", handler);
    }

    function refreshGenderOptions() {
        const g = state.rows.gender && state.rows.gender.input;
        if (!g || g.options.length) return;
        g.replaceChildren();
        [["", "انتخاب نشده"], ["1", "مرد"], ["2", "زن"]].forEach(([v, t]) => {
            const o = el("option", "", t);
            o.value = v;
            g.appendChild(o);
        });
    }

    function validCode() {
        const code = onlyDigits(state.rows.nationalCode.input.value);
        if (code.length !== 10) return null;
        // checksum همان IranianNationalCodeValidator (سمتِ سرور هم همین است)
        let sum = 0;
        for (let i = 0; i < 9; i++) sum += (code[i] - '0') * (10 - i);
        const remainder = sum % 11;
        const expected = remainder < 2 ? remainder : 11 - remainder;
        if ((code[9] - '0') !== expected) return null;
        return code;
    }

    // حداقلِ ظاهرشدنِ «ثبت»: کدِ ملی + نام + نامِ خانوادگی (جنسیت هنگامِ کلیکِ ثبت
    // چک می‌شود تا کلید گم نشود — ناقص را خودِ ستون اعلان می‌کند).
    function minimumComplete() {
        const v = k => state.rows[k] ? String(state.rows[k].input.value || "").trim() : "";
        return !!validCode() && v("firstName") && v("lastName");
    }

    function onAnyChange(key) {
        refreshGenderOptions();
        // فقط بیمارِ «ثبت‌نشده» فیلدها را باز می‌کند؛ بیمارِ موجود فقط‌خواندنی
        // است و به‌جای «ثبت»، اقدامِ «ثبت مراجعه» نشان داده می‌شود.
        const unlocked = !!state.notFoundCode;
        const code = validCode();
        const complete = unlocked && minimumComplete();
        if (key) state.lastKey = key; // «فیلدِ جاری» برای پاسخِ دیرهنگامِ جست‌وجو
        // قفل/بازِ فیلدهای بعد از کد ملی
        Object.keys(state.rows).forEach(k => {
            if (k === "nationalCode") return;
            state.rows[k].input.readOnly = !unlocked ? true : false;
        });
        // اقدامِ «ثبت مراجعه» فقط برایِ بیمارِ شناسایی‌شده
        if (state.actionBar) state.actionBar.classList.toggle("hidden", !state.found);
        if (state.action) state.action.textContent = state.found && state.found.hasAnyStudy ? ACTION_OPEN : ACTION_VISIT;
        // «ثبت» کنارِ فیلدِ جاری؛ اگر رویداد بدونِ کلید آمد (پاسخِ جست‌وجو)،
        // کنارِ آخرین فیلدِ ویرایش‌شده بماند — نه اینکه کلید غیب شود.
        const target = key || state.lastKey || null;
        Object.keys(state.rows).forEach(k => {
            const r = state.rows[k];
            const isCurrent = k !== null && k === target;
            if (k === "nationalCode") { r.save.classList.add("hidden"); return; }
            if (!isCurrent || !complete) { r.save.classList.add("hidden"); return; }
            r.save.classList.remove("hidden");
        });
        if (state.hint && !state.found && code && minimumComplete()) state.hint.textContent = "";
        // کدِ ملی کامل شد؟ بی‌درنگ جوس‌وجوی جدول بیمارها (فقط برایِ همان فیلدِ کدِ ملی)
        if (key === "nationalCode" && code) { clearTimeout(state._t); state._t = setTimeout(() => { lookupWarcode(key); }, 400); }
    }

    async function lookupWarcode(key) {
        const code = validCode();
        if (!code) { state.found = null; state.notFoundCode = null; onAnyChange(key); return; }
        const token = ++state.lookupToken;
        const x = await (async () => {
            try { return await fetch(`/api/patients/lookup?nationalCode=${code}`, { cache: "no-store" }).then(readJson); } catch { return {}; }
        })();
        if (token !== state.lookupToken) return; // پاسخِ درخواستِ قدیمی، نادیده
        const found = x && x.exists && x.patient ? x.patient : null;
        await loadContext();
        if (found) {
            state.notFoundCode = null;
            state.found = found;
            fillPatientFields(found);
            if (found.hasAnyStudy) {
                // بیمار سابقهٔ مراجعه دارد (از هر پزشکی) ⇒ در فهرست دیده می‌شود؛
                // ردیفش را نشان بده تا با کلیک، پرونده (فقط مراجعه‌های همین پزشک)
                // باز شود و «مراجعهٔ جدید» در دسترس باشد.
                try {
                    await window.loadPatients && window.loadPatients(code);
                    const tr = document.querySelector(`.patient-list-row[data-patient-id="${found.patientID}"]`);
                    if (tr) {
                        tr.scrollIntoView({ behavior: "smooth", block: "center" });
                        tr.classList.add("patient-row-flash");
                        setTimeout(() => tr.classList.remove("patient-row-flash"), 1800);
                    }
                } catch { }
                if (state.hint) state.hint.textContent = SAME_HINT;
            } else {
                // بدونِ هیچ مراجعه‌ای ⇒ اطلاعات بیمار در همین باکس‌ها نمایش داده
                // می‌شود و «ثبت مراجعه» پرونده را برای اولین مراجعه باز می‌کند.
                if (state.hint) state.hint.textContent = found.isActive === false
                    ? "بیمار غیرفعال است — برای فعال‌سازی پرونده را باز کنید"
                    : NO_STUDY_HINT;
            }
        } else {
            state.found = null;
            // بیمار در جدول نیست ⇒ بقیه فیلدها باز بمانند (تا تعیینِ «ثبت»).
            state.notFoundCode = code;
            if (state.hint) state.hint.textContent = "بیمار نیست — فیلدها باز شد؛ حداقلِ اطلاعات لازم و «ثبت» را بزن";
        }
        onAnyChange(state.found ? null : state.lastKey);
    }


    // اطلاعاتِ هویتِ بیمار در باکس‌های معرفی (پرونده مشترک است).
    function fillPatientFields(p) {
        const put = (k, v) => { const r = state.rows[k]; if (r && v != null && v !== "") r.input.value = String(v); };
        put("nationalCode", p.nationalCode);
        put("firstName", p.firstName);
        put("lastName", p.lastName);
        put("mobile", p.mobile);
        if (state.rows.gender.input) state.rows.gender.input.value = p.gender ? String(p.gender) : "";
        put("birthDate", p.birthDate ? fmtDate(p.birthDate) : "");
    }

    // بیمارِ شناسایی‌شده: پرونده باز و فرمِ «مراجعهٔ جدید» مستقیم باز می‌شود.
    async function openFoundPatient() {
        const pid = Number(state.found && state.found.patientID);
        if (!Number.isInteger(pid) || pid <= 0) return;
        const ok = await window.openPatient(pid);
        if (ok === false) return;
        if (window.openNewStudyForm) window.openNewStudyForm();
        reset();
    }

    async function register() {
        const code = validCode();
        if (!code) { hintError(state.rows.nationalCode.row, "کد ملی معتبر ۱۰ رقمی را وارد کنید."); return; }
        // بیمارِ موجود (مثلاً هم‌زمان ثبت شده): دوباره نساز؛ پرونده را باز کن.
        if (state.found && state.found.patientID) { await openFoundPatient(); return; }
        const payload = {
            nationalCode: code,
            firstName: state.rows.firstName.input.value.trim(),
            lastName: state.rows.lastName.input.value.trim(),
            gender: state.rows.gender.input.value ? Number(state.rows.gender.input.value) : null,
            mobile: state.rows.mobile.input.value ? window.normalizePhone ? window.normalizePhone(state.rows.mobile.input.value) : state.rows.mobile.input.value : null,
            birthDate: toBackDate(state.rows.birthDate.input.value),
            address: null,
            description: null,
            bloodType: null,
            mobile2: null,
            emergencyContactName: null,
            emergencyContactRelation: null,
            emergencyContactPhone: null,
            baseInsuranceTypeID: null,
            baseInsuranceNo: null,
            supp1InsuranceTypeID: null,
            supp1InsuranceNo: null,
            supp2InsuranceTypeID: null,
            supp2InsuranceNo: null,
            fileNumber: null,
            contactPreference: null
        };
        // اعتبارسنجیِ حداقل
        if (!payload.firstName) { hintError(state.rows.firstName.row, "نام را وارد کنید."); return; }
        if (!payload.lastName) { hintError(state.rows.lastName.row, "نام خانوادگی را وارد کنید."); return; }
        if (!payload.gender) { hintError(state.rows.gender.row, "جنسیت را انتخاب کنید."); state.rows.gender.input.focus(); return; }

        hint("", "در حال ثبت…");
        console.info("[معرفیِ بیمار] ارسال ثبت…", payload.nationalCode);
        try {
            const r = await fetch("/api/patients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
            const x = await readJson(r);
            console.info("[معرفیِ بیمار] پاسخِ سرور:", r.status, x);
            if (r.status === 409 && x.duplicate) {
                const go = window.askConfirmation ? await window.askConfirmation({
                    title: "بیمار موجود است",
                    message: "بیمار با همین کد ملی از قبل ثبت شده است. پروندهٔ موجود باز شود؟",
                    confirmText: "باز کردن پرونده", danger: false
                }) : true;
                if (go && x.existing && x.existing.patientID) { state.found = null; await lookupAfterCreate(x.existing.patientID, payload.nationalCode); }
                return;
            }
            if (!r.ok || !x.success) throw new Error(x.message || "ثبت بیمار انجام نشد.");
            const newID = x.patientID || (x.patient && x.patient.patientID);
            if (window.showToast) window.showToast("بیمار ثبت شد.");
            // پرونده باز می‌شود و فرمِ «مراجعهٔ جدید» مستقیم باز است.
            await window.openPatient(newID);
            if (window.openNewStudyForm) window.openNewStudyForm();
            reset();
            if (state.hint) state.hint.textContent = "پرونده باز شد — آمادهٔ ثبتِ مراجعه";
        } catch (e) {
            console.error("[معرفیِ بیمار] خطای ثبت:", e && (e.message || e), e && e.stack || "");
            const msg = (e && e.message) || "ثبت بیمار انجام نشد.";
            hint("", msg);
            if (window.showToast) window.showToast(msg, "error", "ثبتِ بیمار");
            else alert && alert(msg);
        }
    }

    async function lookupAfterCreate(pid, code) {
        // مسابقهٔ ثبت (۴۰۹): بیمار همین حالا ساخته شده — همان شناساییِ کد ملی
        // را دوباره اجرا کن تا اطلاعات/اقدامِ درست نمایش داده شود.
        await lookupWarcode("nationalCode");
    }

    function hintError(row, msg) {
        let m = row.querySelector(".visit-field-error-text");
        if (!m) { m = el("small", "visit-field-error-text"); row.appendChild(m); }
        m.textContent = msg;
    }
    function hint(target, text) {
        if (typeof target === "string" && state.hint) { state.hint.textContent = target; return; }
        if (state.hint) state.hint.textContent = text || "";
    }

    function reset() {
        Object.keys(state.rows).forEach(k => {
            const r = state.rows[k];
            r.input.value = "";
            r.save.classList.add("hidden");
            r.row.classList.remove("visit-field-error");
        });
        state.found = null;
        if (state.actionBar) state.actionBar.classList.add("hidden");
        Object.keys(state.rows).forEach(k => { if (k !== "nationalCode") state.rows[k].input.readOnly = true; });
        refreshGenderOptions();
    }

    // نمایش/مخفیِ ناحیه: در فهرستِ بیماران (showPatientsScreen) همیشه بالایِ فهرست است.
    function mount() {
        const hostEl = document.getElementById("patientDraftHost");
        if (!hostEl) return;
        if (state.card && hostEl.contains(state.card)) { onAnyChange("nationalCode"); return; } // همین است
        hostEl.replaceChildren();
        state.card = build();
        hostEl.appendChild(state.card);
        window.ReSiRaiJalali && window.ReSiRaiJalali.enhanceAll(state.card); // تاریخِ تولد هم تقویم بگیرد
        loadContext().then(() => {
            refreshGenderOptions();
            onAnyChange("nationalCode");
        });
    }

    window.ReSiRaiPatientDraft = { mount, reset, __state: state }; // __state فقط برایِ عیب‌یابی/دود
})();