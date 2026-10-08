// ReSiRai — کارتِ مراجعه بدونِ ناوبری
//
// قرارداد (توافقِ ۱۴۰۵/۰۷/۱۶، فازِ پزشکِ عمومی):
//  - بالایِ لیستِ مراجعات یک «پیش‌نویس» هست (بدونِ رکورد) که با انتخابِ بیمار
//    ساخته می‌شود و با دکمهٔ «+ مراجعهٔ جدید» برایِ مراجعاتِ بعدی دوباره می‌آید.
//  - فیلدهایِ ثابتِ مراجعه در هر کارت (پیش‌نویس یا واقعی) مستقیم‌قابلِ ویرایش‌اند؛
//    هر تغییر کلیدِ «ثبت» را کنارِ همان فیلد ظاهر می‌کند و «ثبت» کلِ همان کارت را
//    ذخیره می‌کند (اولین بار = ساختِ رکورد، بعدی‌ها = به‌روزرسانی).
//  - مقادیرِ ذخیره‌نشده در مرورگر می‌ماند (localStorage، به تفکیکِ بیمار) تا رفرش
//    چیزی را گم نکند؛ با موفقیتِ «ثبت» پاک می‌شود.
//  - مطب و پزشک از GET /api/visit-context می‌آیند تا ثبت بدونِ انتخابِ دستی ممکن باشد.
(() => {
    "use strict";

    const DRAFT_KEY = "resirai-visit-draft-";
    const OTHER_TYPE_NAME = "سایر";

    const el = (tag, cls, text) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    };
    const readJson = async r => { try { return await r.json(); } catch { return {}; } };
    const fmtDate = v => (window.formatPersianDateForInput ? window.formatPersianDateForInput(v) : "");
    const fmtDateTime = v => (window.formatPersianDateTimeForInput ? window.formatPersianDateTimeForInput(v) : "");
    const toBackDate = (v, withTime) => (window.parsePersianDateForBackend ? window.parsePersianDateForBackend(v, withTime) : null);
    const nullIfEmpty = v => (window.emptyToNull ? window.emptyToNull(String(v == null ? "" : v)) : (String(v || "").trim() ? v : null));
    const fail = (msg, fallback) => (window.getApiError ? window.getApiError(msg, fallback) : (msg && msg.message) || fallback);

    // ---- زمینهٔ مراجعه (مطب/پزشک/رشته) ------------------------------------
    const ctx = { clinicID: null, doctorStaffID: null, specialtyID: null, canPickDoctor: false, doctors: [], ready: false };
    let ctxPromise = null;

    function loadContext() {
        if (ctxPromise) return ctxPromise;
        ctxPromise = (async () => {
            try {
                const [visit, docs] = await Promise.all([
                    fetch("/api/visit-context", { cache: "no-store" }).then(readJson),
                    fetch("/api/staff/doctors", { cache: "no-store" }).then(readJson)
                ]);
                ctx.clinicID = visit.clinicID ?? null;
                ctx.doctorStaffID = visit.doctorStaffID ?? null;
                ctx.specialtyID = visit.specialtyID ?? null;
                ctx.canPickDoctor = !!visit.canPickDoctor;
                ctx.doctors = docs.doctors || [];
            } catch { /* بدونِ زمینه هم فرم کار می‌کند؛ فقط ثبتِ کاربرِ عادی رد می‌شود */ }
            ctx.ready = true;
            return ctx;
        })();
        return ctxPromise;
    }

    async function loadTypes(specialtyID) {
        const url = specialtyID ? `/api/studytypes?specialtyID=${specialtyID}` : "/api/studytypes";
        try {
            const x = await fetch(url, { cache: "no-store" }).then(readJson);
            return x.studyTypes || [];
        } catch { return []; }
    }

    async function loadWaitStages(specialtyID) {
        const url = specialtyID ? `/api/waitstages?specialtyID=${specialtyID}` : "/api/waitstages";
        try {
            const x = await fetch(url, { cache: "no-store" }).then(readJson);
            return x.waitStages || [];
        } catch { return []; }
    }

    // ---- ساختِ فیلدها -------------------------------------------------------
    // یک ردیف: برچسب + ورودی + کلیدِ «ثبت» (که فقط بعد از تغییر دیده می‌شود).
    function addRow(host, key, label, input, extra) {
        const row = el("div", "visit-field-row");
        row.dataset.key = key;
        const lab = el("label", "visit-field-label", label);
        const box = el("div", "visit-field-input");
        box.appendChild(input);
        if (extra) box.appendChild(extra);
        const save = el("button", "visit-field-save hidden", "ثبت");
        save.type = "button";
        save.title = "ذخیرهٔ همهٔ تغییراتِ این کارت";
        row.append(lab, box, save);
        host.appendChild(row);
        const rec = { row, input, save };
        host.__rows[key] = rec;
        save.addEventListener("click", () => saveCard(host, key));
        const onChange = () => markDirty(host, key);
        input.addEventListener("input", onChange);
        input.addEventListener("change", onChange);
        if (host.__draft) input.setAttribute("data-dic", "1"); // میکروفن و ✕ (dictation.js)
        return rec;
    }

    function makeSelect(id) {
        const s = el("select", "visit-input");
        if (id) s.id = id;
        return s;
    }
    function makeText(id, placeholder, attrs) {
        const t = el("input", "visit-input");
        t.type = "text";
        if (id) t.id = id;
        if (placeholder) t.placeholder = placeholder;
        (attrs || []).forEach(a => t.setAttribute(a, ""));
        return t;
    }
    function makeArea(id, rows) {
        const t = el("textarea", "visit-input");
        if (id) t.id = id;
        t.rows = rows || 2;
        return t;
    }

    function fillSelect(select, items, value) {
        const current = value !== undefined ? value : select.value;
        select.replaceChildren();
        const none = el("option", "", select.dataset.emptyLabel || "انتخاب نشده");
        none.value = "";
        select.appendChild(none);
        items.forEach(it => {
            const o = el("option", "", it.text);
            o.value = String(it.value);
            select.appendChild(o);
        });
        select.value = current == null ? "" : String(current);
        if (select.value === "" && current != null && String(current) !== "") {
            // مقدارِ قدیمیِ خارج از فهرست (مثلاً پزشکِ غیرفعال) هم باید دیده شود.
            const o = el("option", "", String(current));
            o.value = String(current);
            select.appendChild(o);
            select.value = String(current);
        }
    }

    // فیلدهایِ ثابتِ مراجعه — هم برایِ پیش‌نویس و هم برایِ کارتِ واقعی.
    function buildFields(study, opts) {
        opts = opts || {};
        const host = el("div", "visit-fields");
        host.__study = study && study.studyID ? study : null;
        host.__rows = {};
        host.__dirty = {};
        host.__draft = !!opts.draft;

        const bar = el("div", "visit-fields-bar");
        const state = el("span", "visit-fields-state");
        bar.appendChild(state);
        host.appendChild(bar);
        host.__state = state;

        const type = makeSelect(opts.draft ? "visitType" : null);
        type.dataset.emptyLabel = "— انتخاب کنید —";
        const typeRow = addRow(host, "type", "دلیلِ مراجعه", type);

        const note = makeText(opts.draft ? "visitTypeNote" : null, "منظور از «سایر» را بنویسید…");
        const noteRow = addRow(host, "studyTypeNote", "توضیحِ سایر", note);
        noteRow.row.classList.add("hidden");

        const studyDate = makeText(opts.draft ? "visitStudyDate" : null, "مثال: 1405/06/22 14:30", ["data-jalali-datetime", "maxlength"]);
        studyDate.maxLength = 16;
        addRow(host, "studyDate", "تاریخ و ساعت", studyDate);

        const doctor = makeSelect(opts.draft ? "visitDoctor" : null);
        addRow(host, "doctorStaffID", "پزشک", doctor);

        const bodyPart = makeText(opts.draft ? "visitBodyPart" : null, "مثلاً گلو، شکم، کمر…");
        bodyPart.maxLength = 100;
        addRow(host, "bodyPart", "ناحیه", bodyPart);

        const status = makeSelect(opts.draft ? "visitStatus" : null);
        fillSelect(status, [
            { value: 1, text: "باز — کار در جریان است" },
            { value: 2, text: "تمام‌شده" },
            { value: 3, text: "در انتظار" }
        ], 1);
        addRow(host, "status", "وضعیت", status);

        const waitStage = makeSelect(opts.draft ? "visitWaitStage" : null);
        const waitRow = addRow(host, "waitStage", "مرحلهٔ انتظار", waitStage);
        const followUpDate = makeText(opts.draft ? "visitFollowUpDate" : null, "مثال: 1405/07/15", ["data-jalali-date"]);
        followUpDate.maxLength = 10;
        const followUpRow = addRow(host, "followUpDate", "تاریخِ پیگیری", followUpDate);
        const followUpNote = makeText(opts.draft ? "visitFollowUpNote" : null, "یادداشتِ پیگیری");
        followUpNote.maxLength = 500;
        const followNoteRow = addRow(host, "followUpNote", "یادداشتِ پیگیری", followUpNote);

        const workEnd = makeText(opts.draft ? "visitWorkEndDate" : null, "مثال: 1405/06/22 15:10", ["data-jalali-datetime"]);
        workEnd.maxLength = 16;
        const nowBtn = el("button", "secondary-button visit-now", "الان");
        nowBtn.type = "button";
        nowBtn.title = "ساعتِ همین حالا را به‌عنوانِ پایانِ کار ثبت کنید (بعد از «ثبت» ذخیره می‌شود)";
        nowBtn.addEventListener("click", ev => {
            ev.preventDefault();
            workEnd.value = fmtDateTime(new Date().toISOString());
            markDirty(host, "workEndDate");
        });
        addRow(host, "workEndDate", "پایانِ کار", workEnd, nowBtn);

        const description = makeArea(opts.draft ? "visitDescription" : null, 2);
        description.maxLength = 1000;
        addRow(host, "description", "توضیحات", description);

        const diagnosis = makeArea(opts.draft ? "visitDiagnosis" : null, 2);
        diagnosis.maxLength = 1000;
        addRow(host, "diagnosis", "تشخیص", diagnosis);

        // شرطی‌ها: توضیحِ «سایر» فقط برایِ نوعِ سایر، پیگیری فقط برایِ وضعیتِ ۳.
        const syncConditionals = () => {
            const selectedType = type.options[type.selectedIndex];
            noteRow.row.classList.toggle("hidden", !selectedType || selectedType.value === "" || selectedType.text !== OTHER_TYPE_NAME);
            const waiting = status.value === "3";
            waitRow.row.classList.toggle("hidden", !waiting);
            followUpRow.row.classList.toggle("hidden", !waiting);
            followNoteRow.row.classList.toggle("hidden", !waiting);
        };
        type.addEventListener("change", syncConditionals);
        status.addEventListener("change", syncConditionals);
        host.__syncConditionals = syncConditionals;

        hydrate(host, study).then(syncConditionals).catch(() => { });
        syncConditionals();
        return host;
    }

    // پُر کردنِ گزینه‌ها و مقدارها (آسنکرون): نوع‌ها بر اساسِ رشتهٔ پزشکِ انتخابی.
    async function hydrate(host, study) {
        await loadContext();
        const rows = host.__rows;

        fillSelect(rows.doctorStaffID.input, ctx.doctors.map(d => ({
            value: d.staffID,
            text: `${d.firstName || ""} ${d.lastName || ""}`.trim() + (d.specialtyName ? ` — ${d.specialtyName}` : "")
        })), study ? (study.doctorStaffID ?? "") : (ctx.doctorStaffID ?? ""));

        // واحدِ «فقط پزشک»: وقتی پزشک خودکار آمده (یا هنوز پزشکی ثبت نشده)،
        // فیلدِ پزشک اصلاً دیده نمی‌شود — مقدار همچنان همان است و ارسال می‌شود.
        rows.doctorStaffID.row.classList.toggle("hidden", !ctx.canPickDoctor);

        const chosenDoctor = ctx.doctors.find(d => Number(d.staffID) === Number(rows.doctorStaffID.input.value));
        const specialtyID = (chosenDoctor && chosenDoctor.specialtyID) || ctx.specialtyID || 0;

        fillSelect(rows.type.input, (await loadTypes(specialtyID)).map(t => ({
            value: t.StudyTypeID, text: t.StudyTypeName
        })), study ? (study.studyTypeID ?? "") : "");

        fillSelect(rows.waitStage.input, (await loadWaitStages(specialtyID)).map(w => ({
            value: w.waitStageID, text: w.name
        })), study ? (study.waitStageID ?? "") : "");

        // مقادیر: مراجعهِ بازشده، یا پیش‌نویسِ محفوظ در مرورگر.
        let values = null;
        if (study) {
            values = {
                studyTypeNote: study.studyTypeNote || "",
                studyDate: fmtDateTime(study.studyDate),
                bodyPart: study.bodyPart || "",
                status: study.status ?? 1,
                waitStageID: study.waitStageID ?? "",
                followUpDate: study.followUpDate ? fmtDate(study.followUpDate) : "",
                followUpNote: study.followUpNote || "",
                workEndDate: study.workEndDate ? fmtDateTime(study.workEndDate) : "",
                description: study.description || "",
                diagnosis: study.diagnosis || ""
            };
        } else if (host.__draft) {
            values = readDraft();
            if (!values) values = { studyDate: fmtDateTime(new Date().toISOString()), status: 1 };
        }
        if (values) applyValues(host, values);
        host.__syncConditionals && host.__syncConditionals();

        // تغییرِ پزشک یعنی شاید رشته عوض شود؛ فهرستِ نوع‌ها باید تازه شود.
        rows.doctorStaffID.input.addEventListener("change", async () => {
            const doc = ctx.doctors.find(d => Number(d.staffID) === Number(rows.doctorStaffID.input.value));
            const sid = (doc && doc.specialtyID) || ctx.specialtyID || 0;
            const keep = rows.type.input.value;
            fillSelect(rows.type.input, (await loadTypes(sid)).map(t => ({ value: t.StudyTypeID, text: t.StudyTypeName })), keep);
            fillSelect(rows.waitStage.input, (await loadWaitStages(sid)).map(w => ({ value: w.waitStageID, text: w.name })), rows.waitStage.input.value);
            host.__syncConditionals && host.__syncConditionals();
        });
    }

    function applyValues(host, values) {
        const set = (key, value) => {
            const rec = host.__rows[key];
            if (!rec) return;
            if (value === undefined || value === null) return;
            rec.input.value = String(value);
        };
        Object.keys(values).forEach(k => set(k, values[k]));
    }

    // ---- علامتِ «ذخیره‌نشده» -------------------------------------------------
    function markDirty(host, key) {
        const rec = host.__rows[key];
        if (!rec) return;
        host.__dirty[key] = true;
        rec.save.classList.remove("hidden");
        rec.row.classList.remove("visit-field-error");
        const msg = rec.row.querySelector(".visit-field-error-text");
        if (msg) msg.remove();
        const n = Object.keys(host.__dirty).length;
        host.__state.textContent = `${n.toLocaleString("fa-IR")} تغییرِ ذخیره‌نشده`;
        host.__state.classList.remove("hidden");
        if (host.__draft) persistDraft(host);
    }

    function clearDirty(host) {
        host.__dirty = {};
        Object.values(host.__rows).forEach(r => r.save.classList.add("hidden"));
        host.__state.textContent = "";
        host.__state.classList.add("hidden");
    }

    function fieldError(host, key, message) {
        const rec = host.__rows[key];
        if (!rec) return;
        rec.row.classList.add("visit-field-error");
        let msg = rec.row.querySelector(".visit-field-error-text");
        if (!msg) { msg = el("small", "visit-field-error-text"); rec.row.appendChild(msg); }
        msg.textContent = message;
        rec.input.focus && rec.input.focus();
    }

    // ---- خواندنِ مقادیر و ذخیره ---------------------------------------------
    function collect(host) {
        const v = k => (host.__rows[k] ? host.__rows[k].input.value : "");
        const status = Number(v("status")) || 1;
        return {
            studyTypeID: Number((host.__rows.type.input.options[host.__rows.type.input.selectedIndex] || {}).value) || 0,
            studyTypeNote: host.__rows.type.input.value && host.__rows.type.input.options[host.__rows.type.input.selectedIndex]?.text === OTHER_TYPE_NAME
                ? nullIfEmpty(v("studyTypeNote")) : null,
            studyDate: toBackDate(v("studyDate"), true),
            doctorStaffID: Number(v("doctorStaffID")) || null,
            bodyPart: nullIfEmpty(v("bodyPart")),
            status,
            waitStageID: status === 3 ? (Number(v("waitStageID")) || null) : null,
            followUpDate: status === 3 ? toBackDate(v("followUpDate"), false) : null,
            followUpNote: status === 3 ? nullIfEmpty(v("followUpNote")) : null,
            workEndDate: toBackDate(v("workEndDate"), true),
            description: nullIfEmpty(v("description")),
            diagnosis: nullIfEmpty(v("diagnosis"))
        };
    }

    function rawValues(host) {
        const out = {};
        Object.keys(host.__rows).forEach(k => {
            const i = host.__rows[k].input;
            out[k] = i ? i.value : "";
        });
        return out;
    }

    async function saveCard(host, key) {
        const payload = collect(host);
        // الزامی‌ها: دلیلِ مراجعه و تاریخ — همان چیزی که سرور هم می‌پذیرد.
        if (!payload.studyTypeID) { fieldError(host, "type", "دلیلِ مراجعه را انتخاب کنید."); return null; }
        if (!payload.studyDate) { fieldError(host, "studyDate", "تاریخ مراجعه را وارد کنید."); return null; }

        const isNew = !host.__study;
        const url = isNew ? "/api/radiologystudies" : `/api/radiologystudies/${host.__study.studyID}`;
        const body = isNew
            ? { ...payload, patientID: Number(window.selectedPatientID) || 0, clinicID: ctx.clinicID, toothNumbers: [] }
            : payload;

        const saveBtn = key && host.__rows[key] ? host.__rows[key].save : null;
        const label = saveBtn ? saveBtn.textContent : "";
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "در حال ثبت…"; }
        host.__state.textContent = "در حال ذخیره…";
        host.__state.classList.remove("hidden");
        try {
            const r = await fetch(url, {
                method: isNew ? "POST" : "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            });
            const x = await readJson(r);
            if (!r.ok || !x.success) throw new Error(fail(x, isNew ? "مراجعه ثبت نشد." : "ذخیره انجام نشد."));

            const saved = x.study || { ...payload, studyID: host.__study ? host.__study.studyID : 0 };
            clearDirty(host);

            if (isNew) {
                const studyID = saved.studyID || x.studyID;
                // پیش‌نویسِ مراجعه: بخش‌ها و شرایطِ فعلی که در همین کارت بافر شده‌اند،
                // حالا که رکورد ساخته شد باید به همان رکورد بچسبند.
                try { window.ReSiRaiFactors && window.ReSiRaiFactors.commitPending && await window.ReSiRaiFactors.commitPending(studyID); } catch { }
                try { window.ReSiRaiStudySections && window.ReSiRaiStudySections.flushPending && await window.ReSiRaiStudySections.flushPending(studyID); } catch { }
                forgetDraft();
                suppress();
                host.__study = saved;
                window.dispatchEvent(new CustomEvent("resirai-visit-created", { detail: { studyID, study: saved } }));
            } else {
                host.__study = { ...(host.__study || {}), ...saved };
                window.dispatchEvent(new CustomEvent("resirai-visit-saved", { detail: { study: host.__study } }));
            }
            if (window.showToast) window.showToast(isNew ? "مراجعه ثبت شد." : "ذخیره شد.");
            return saved;
        } catch (e) {
            host.__state.textContent = (e && e.message) || "ذخیره انجام نشد.";
            host.__state.classList.add("is-error");
            if (window.showToast) window.showToast((e && e.message) || "ذخیره انجام نشد.", "error");
            return null;
        } finally {
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = label; }
        }
    }

    // ---- حفظِ پیش‌نویس در مرورگر --------------------------------------------
    function draftKey() {
        const id = Number(window.selectedPatientID);
        return id > 0 ? DRAFT_KEY + id : null;
    }
    // هر خالی‌کردنِ ناحیهٔ پیش‌نویس باید اول پنلِ «بخش‌های مراجعه» را به خانه‌اش
    // برگرداند؛ آن پنل «تکی» است و اگر داخلِ همین ناحیه باشد با replaceChildren
    // از بین می‌رود (و دیگر هیچ مراجعه‌ای بخشِ تیک‌محور نخواهد داشت).
    function clearDraftHost() {
        const host = document.getElementById("visitDraftHost");
        if (!host) return;
        if (window.restoreSectionsPanel) window.restoreSectionsPanel();
        host.replaceChildren();
        delete host.dataset.patientId;
    }
    function persistDraft(host) {
        const key = draftKey();
        if (!key) return;
        try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), values: rawValues(host) })); } catch { }
    }
    function readDraft() {
        const key = draftKey();
        if (!key) return null;
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return parsed && parsed.values ? parsed.values : null;
        } catch { return null; }
    }
    function forgetDraft() {
        const key = draftKey();
        if (!key) return;
        try { localStorage.removeItem(key); } catch { }
    }

    // ---- پیش‌نویس: کارتِ بالایِ لیست ----------------------------------------
    let suppressed = false;      // بعد از ثبت، کارتِ خالی دوباره ساخته نشود
    let draftPatientID = null;

    function createDraftCard() {
        const card = el("article", "study-draft-card");
        const head = el("header", "study-draft-head");
        const title = el("div", "study-draft-title");
        const badge = el("span", "study-draft-badge", "پیش‌نویس");
        title.append(badge, " ", document.createTextNode("مراجعهٔ جدید"));
        const discard = el("button", "secondary-button study-draft-discard", "پاک کردن");
        discard.type = "button";
        discard.title = "این پیش‌نویس و مقادیرِ محفوظِ آن در این مرورگر پاک شود";
        discard.addEventListener("click", () => {
            forgetDraft();
            suppress();          // خودش ناحیه را خالی و پنلِ بخش‌ها را به خانه برمی‌گرداند
        });
        head.append(title, discard);

        const body = el("div", "study-draft-body");
        const fields = buildFields(null, { draft: true });
        body.appendChild(fields);

        // همان بخش‌های تیک‌محور و شرایط فعلیِ کارتِ واقعی، این‌جا هم هستند.
        const sectionsHost = el("div", "study-card-sections");
        body.appendChild(sectionsHost);
        const factorsHost = el("div", "factors-panel");
        factorsHost.id = "visitDraftFactors";
        body.appendChild(factorsHost);

        card.append(head, body);
        card.__sectionsHost = sectionsHost;
        card.__factorsHost = factorsHost;
        card.__fields = fields;
        return card;
    }

    function wireDraft(card) {
        // پنلِ بخش‌ها (تکی) به داخلِ کارت منتقل می‌شود؛ در خانه‌اش نگه داشته می‌شود
        // تا هنگامِ رندرِ دوبارهٔ لیست از بین نرود.
        if (window.ReSiRaiMoveSections) window.ReSiRaiMoveSections(card.__sectionsHost);
        if (window.ReSiRaiStudySections && window.ReSiRaiStudySections.render) {
            Promise.resolve(window.ReSiRaiStudySections.render(0)).catch(() => { });
        }
        if (window.ReSiRaiFactors && window.ReSiRaiFactors.render) {
            try { window.ReSiRaiFactors.render({ studyID: 0 }, card.__factorsHost); } catch { }
        }
    }

    // ساخت/نمایشِ پیش‌نویس؛ true یعنی کارت آماده شد.
    function showNew(force) {
        const host = document.getElementById("visitDraftHost");
        const pid = Number(window.selectedPatientID);
        if (!host || pid <= 0) return false;
        suppressed = false;
        draftPatientID = pid;
        host.dataset.patientId = String(pid);
        const card = createDraftCard();
        host.replaceChildren(card);
        wireDraft(card);
        card.scrollIntoView && card.scrollIntoView({ behavior: "smooth", block: "nearest" });
        const first = card.querySelector("select, input, textarea");
        if (force !== false && first) first.focus({ preventScroll: true });
        return true;
    }

    function suppress() {
        suppressed = true;
        clearDraftHost();
    }

    // با هر رندرِ صفحهٔ بیمار صدا زده می‌شود.
    function mount() {
        const host = document.getElementById("visitDraftHost");
        const pid = Number(window.selectedPatientID);
        if (!host) return;
        if (!pid) { clearDraftHost(); return; }
        if (host.dataset.patientId === String(pid) && host.firstElementChild) return; // همین ساخته شده
        host.dataset.patientId = String(pid);
        if (pid !== draftPatientID) { suppressed = false; draftPatientID = pid; }

        const stored = readDraft();
        if (!stored && suppressed) { clearDraftHost(); return; } // بعد از ثبت، بدونِ کارتِ خالی

        const card = createDraftCard();
        host.replaceChildren(card);
        wireDraft(card);
    }

    window.ReSiRaiVisitDraft = { mount, showNew, suppress, hideDraft, buildFields, forget: forgetDraft, saveCard, loadContext };

 function hideDraft() { clearDraftHost(); suppressed = true; }
})();
