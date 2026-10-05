// ReSiRai - «نوعِ مراجعه» (عللِ مراجعه): autocomplete + فیلترِ تخصصِ پزشک.
//
// باکس همان الگویِ باکسِ تخصص در staff-ui.js است: متن + datalist با حفظِ شناسه.
// متنِ دیده‌شده در #newStudyType می‌ماند و شناسه در #newStudyTypeID (سلکتِ
// پنهان) نگه داشته می‌شود، پس payload همچنان StudyTypeID می‌گیرد و «required»
// هم رویِ فیلدِ دیده‌شده می‌نشیند.
//
// قواعد (docs/design/visit-types.md):
//   ۱) تایپ، فهرست را زنده فیلتر می‌کند و «سایر» همیشه آخر است.
//   ۲) اگر تایپ به هیچ گزینه‌ای نخورد، پیشنهادِ «سایر» نمایش داده می‌شود و
//      فیلدِ «توضیحِ سایر» باز می‌شود؛ خروج از فیلد همان انتخاب را قطعی می‌کند
//      و متنِ تایپ‌شده در فیلدِ توضیح می‌نشیند تا چیزی گم نشود.
//   ۳) نوعِ قدیمیِ خارج از فهرستِ فیلترشده هم نمایش داده می‌شود: فیلتر مجاز
//      نیست مراجعهٔ ثبت‌شده را نامرئی کند.
(function () {
    'use strict';

    const OTHER_NAME = 'سایر';
    const HINT_SUGGEST = 'پیشنهاد: «سایر» — توضیح بنویسید';
    const HINT_DEFAULT = 'نام را بنویسید؛ فهرست با تخصصِ پزشک فیلتر می‌شود.';

    // [{id, name, other}] — مرتب‌شده با «سایر» در انتها.
    let entries = [];

    const el = id => document.getElementById(id);
    const norm = v => String(v ?? '').replace(/\u200c/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

    function parts() {
        return {
            input: el('newStudyType'),
            list: el('newStudyTypeList'),
            idSelect: el('newStudyTypeID'),
            hint: el('newStudyTypeHint'),
            noteBox: el('studyTypeOtherBox'),
            note: el('studyTypeNote')
        };
    }

    const otherEntry = () => entries.find(e => e.other) || null;
    const entryByID = id => entries.find(e => e.id === Number(id)) || null;

    // متنِ تایپ‌شده ← ردیف: اول تطبیقِ دقیق، بعد شامل‌شدن (در هر دو جهت).
    function matchEntry(want) {
        if (!want) return null;
        return entries.find(e => norm(e.name) === want)
            || entries.find(e => norm(e.name).includes(want) || want.includes(norm(e.name)))
            || null;
    }

    // فیلدِ توضیح فقط برای «سایر» (یا پیشنهادِ در جریانِ آن) باز می‌شود.
    function syncNoteBox(show) {
        const p = parts();
        p.noteBox?.classList.toggle('hidden', !show);
    }

    // نوشتنِ نامِ ردیف در فیلدِ دیده‌شده + شناسه در سلکتِ پنهان.
    // فقط در change/setTypes صدا زده می‌شود؛ هرگز حینِ تایپ (caret نباید بپرد).
    function apply(entry) {
        const p = parts();
        if (p.input) p.input.value = entry ? entry.name : '';
        if (p.idSelect) p.idSelect.value = entry ? String(entry.id) : '';
        syncNoteBox(!!entry && entry.other);
    }

    // فهرستِ datalist از رویِ متنِ فعلی: منطبق‌ها («سایر» آخر) و اگر هیچ
    // منطبقی نبود، خودِ «سایر» با همان متن. دلیلِ دوم: مرورگر datalist را با
    // متنِ تایپ‌شده فیلتر می‌کند، پس گزینه باید آن متن را داشته باشد تا دیده شود.
    function refreshList() {
        const p = parts();
        if (!p.list) return;
        const raw = (p.input?.value || '').trim();
        const want = norm(raw);
        const hits = want ? entries.filter(e => norm(e.name).includes(want)) : entries.slice();
        const names = [...hits.filter(e => !e.other), ...hits.filter(e => e.other)].map(e => e.name);
        const suggesting = !!want && !hits.length && !!otherEntry();
        if (suggesting) names.push(`${OTHER_NAME} — ${raw}`);

        p.list.replaceChildren();
        names.forEach(n => p.list.appendChild(new Option(n)));

        if (p.hint) {
            p.hint.textContent = suggesting ? HINT_SUGGEST : (want ? '' : HINT_DEFAULT);
            p.hint.dataset.suggest = suggesting ? '1' : '';
        }
    }

    // تایپ: شناسه و فیلدِ توضیح هم‌زمان به‌روز می‌شوند، متنِ دیده‌شده دست‌نخورده
    // می‌ماند تا کاربر بتواند تایپ کند (همان رفتارِ باکسِ تخصص).
    function onInput() {
        const p = parts();
        const want = norm(p.input?.value || '');
        const hit = matchEntry(want);
        if (p.idSelect) p.idSelect.value = hit ? String(hit.id) : '';
        syncNoteBox(hit ? !!hit.other : (!!want && !!otherEntry()));
        refreshList();
    }

    // خروج از فیلد: انتخاب قطعی می‌شود. متنِ نامتچ به «سایر» می‌رود و
    // اگر فیلدِ توضیح خالی است، همان متن در آنجا می‌نشیند (چیزی گم نمی‌شود).
    function commit() {
        const p = parts();
        if (!p.input) return null;
        const raw = p.input.value.trim();
        const want = norm(raw);
        if (!want) { apply(null); refreshList(); return null; }

        const hit = matchEntry(want);
        if (hit) { apply(hit); refreshList(); return hit; }

        const other = otherEntry();
        if (!other) { apply(null); refreshList(); return null; }
        apply(other);
        if (p.note && !p.note.value.trim()) p.note.value = raw;
        refreshList();
        return other;
    }

    function commitOther() {
        const p = parts();
        if (!p.input || !otherEntry()) return null;
        const raw = p.input.value.trim();
        apply(otherEntry());
        if (p.note && raw && !p.note.value.trim()) p.note.value = raw;
        refreshList();
        return otherEntry();
    }

    // آنچه payload می‌فرستد: شناسهٔ قطعی‌شده + متن (فقط برای «سایر»).
    function selection() {
        const entry = commit();
        const p = parts();
        const note = entry && entry.other && p.note ? emptyNote(p.note.value) : null;
        return { id: entry ? entry.id : 0, name: entry ? entry.name : '', note };
    }
    const emptyNote = v => String(v ?? '').trim() || null;

    // فهرستِ تازه از سرور (+ نوعِ قدیمیِ خارج از فهرست که باید همچنان دیده شود).
    function setTypes(types, selectedID, fallbackName) {
        entries = (types || [])
            .map(t => ({ id: Number(t.studyTypeID) || 0, name: String(t.studyTypeName || '') }))
            .filter(e => e.id && e.name)
            .map(e => ({ id: e.id, name: e.name, other: norm(e.name) === norm(OTHER_NAME) }))
            .sort((a, b) => (a.other === b.other ? 0 : (a.other ? 1 : -1)));

        // سلکتِ پنهان باید خودش ردیف داشته باشد (همان الگویِ staffSpecialtyID):
        // بدونِ <option>، نوشتنِ value بی‌اثر است و شناسه گم می‌شود.
        const p = parts();
        if (p.idSelect) {
            p.idSelect.replaceChildren(new Option('انتخاب دلیل مراجعه', ''));
            entries.forEach(e => p.idSelect.appendChild(new Option(e.name, String(e.id))));
        }

        let hit = selectedID ? entryByID(selectedID) : null;
        if (!hit && selectedID && fallbackName) {
            hit = { id: Number(selectedID), name: String(fallbackName), other: norm(fallbackName) === norm(OTHER_NAME) };
            entries.unshift(hit);
            p.idSelect?.appendChild(new Option(hit.name, String(hit.id)));
        }
        apply(hit || null);
        refreshList();
    }

    function setNote(text) {
        const p = parts();
        if (p.note) p.note.value = String(text ?? '');
    }

    // حالتِ نمایش: فیلدها فقط‌خواندنی و دکمه‌های میکروفون/✕ پنهان.
    function setEditable(editable) {
        const p = parts();
        const on = !!editable;
        if (p.input) p.input.readOnly = !on;
        if (p.note) p.note.readOnly = !on;
        [p.input?.parentElement, p.note?.parentElement].forEach(box =>
            box?.classList.toggle('study-type-readonly', !on));
    }

    function count() { return entries.length; }
    // همان فهرستِ فعلی، با شکلِ پاسخِ سرور — برایِ بازسازیِ فهرست وقتی درخواستِ
    // تازه شکست می‌خورد (فهرستِ قبلی از دست نرود).
    function types() { return entries.map(e => ({ studyTypeID: e.id, studyTypeName: e.name })); }

    function mount() {
        const p = parts();
        if (!p.input || p.input.dataset.studyTypeUi === '1') return;
        p.input.dataset.studyTypeUi = '1';

        // میکروفون + ✕ همان الگویِ فیلدهایِ متنیِ بخش‌هایِ مراجعه
        // (study-sections.js). اگر آن ماژول نبود، فیلد سالم می‌ماند.
        const attach = window.ReSiRaiStudySections?.attachTools;
        if (typeof attach === 'function') {
            if (p.input.parentElement?.classList.contains('gsec-micbox'))
                attach(p.input.parentElement, p.input);
            if (p.note?.parentElement?.classList.contains('gsec-micbox'))
                attach(p.note.parentElement, p.note);
        }

        p.input.addEventListener('input', onInput);
        p.input.addEventListener('change', () => commit());
        // Enter مثلِ باکسِ تخصص: انتخاب را قطعی می‌کند، نه اینکه فرم را بفرستد.
        p.input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); p.input.blur(); }
        });
        p.hint?.addEventListener('click', () => {
            if (p.hint.dataset.suggest === '1') { commitOther(); p.note?.focus(); }
        });
        refreshList();
    }

    window.ReSiRaiStudyTypeUI = { mount, setTypes, setNote, setEditable, selection, count, types };

    if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', mount);
    else
        mount();
})();
