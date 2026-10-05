// Staff/person management UI for ReSiRai.
// Kept separate from app.js so Patient/Study behavior is not disturbed.

(() => {
    const main = document.querySelector(".page-container");
    if (!main) return;

    const section = document.createElement("section");
    section.id = "staffSection";
    section.className = "card hidden";
    section.innerHTML = `
        <div class="section-header">
            <div><h2>اشخاص و پرسنل</h2><p>ثبت و ویرایش کارمندان و دندانپزشکان</p></div>
            <button id="newStaffButton" type="button">+ پرسنل جدید</button>
        </div>
        <div class="search-container">
            <input id="staffSearch" type="text" placeholder="نام، نام خانوادگی یا کد ملی..." autocomplete="off">
            <button id="staffSearchButton" type="button">جستجو</button>
        </div>
        <div id="staffStatus" class="status-message"></div>
        <div class="table-container"><table class="patient-table">
            <thead><tr><th>نام</th><th>نام خانوادگی</th><th>کد ملی</th><th>نوع</th><th>عملیات</th></tr></thead>
            <tbody id="staffTableBody"></tbody>
        </table></div>
        <form id="staffForm" class="hidden" style="margin-top:20px">
            <input id="staffID" type="hidden">
            <div class="form-grid">
                <div class="form-field"><label for="staffFirstName">نام</label><input id="staffFirstName" maxlength="100" required></div>
                <div class="form-field"><label for="staffLastName">نام خانوادگی</label><input id="staffLastName" maxlength="100" required></div>
                <div class="form-field"><label for="staffNationalCode">کد ملی</label><input id="staffNationalCode" maxlength="10" inputmode="numeric" pattern="[0-9]{10}" required><small class="field-hint">کد ملی معتبر ۱۰ رقمی</small></div>
                <div class="form-field"><label for="staffType">نوع شخص</label><select id="staffType" required><option value="1">کارمند</option><option value="2">دندانپزشک</option></select></div>
                <div id="staffSpecialtyField" class="form-field hidden"><label for="staffSpecialtyInput">تخصص</label><input id="staffSpecialtyInput" type="text" list="staffSpecialtyList" autocomplete="off" placeholder="تایپ کنید؛ فهرست فیلتر می‌شود…" required><datalist id="staffSpecialtyList"></datalist><small id="staffSpecialtyHint" class="field-hint">نام تخصص را بنویسید و از فهرست انتخاب کنید.</small><select id="staffSpecialtyID" class="hidden"></select></div>
            </div>
            <div id="staffFormStatus" class="status-message"></div>
            <div class="form-actions"><button type="submit">ذخیره</button><button id="cancelStaffButton" type="button" class="secondary-button">انصراف</button></div>
        </form>`;
    main.appendChild(section);

    const header = document.querySelector(".header-content");
    if (header) {
        const b = document.createElement("button");
        b.id = "staffNavButton";
        b.type = "button";
        b.textContent = "مدیریت پرسنل";
        b.className = "secondary-button";
        header.appendChild(b);
        b.onclick = () => {
            document.querySelectorAll(".page-container > section").forEach(x => x.classList.add("hidden"));
            section.classList.remove("hidden");
            loadStaff();
        };
    }

    const $ = id => document.getElementById(id);
    const normalize = value => String(value ?? "").replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d));

    async function apiJson(url, options) {
        const r = await fetch(url, options);
        let x = {};
        try { x = await r.json(); } catch {}
        if (!r.ok || x.success === false) throw new Error(x.message || x.messageEn || "عملیات انجام نشد.");
        return x;
    }

    async function loadStaff() {
        try {
            $("staffStatus").textContent = "در حال دریافت اطلاعات...";
            const q = $("staffSearch").value.trim();
            const x = await apiJson("/api/staff" + (q ? "?search=" + encodeURIComponent(q) : ""));
            $("staffTableBody").innerHTML = "";
            (x.staff || []).forEach(s => {
                const tr = document.createElement("tr");
                [s.firstName, s.lastName, s.nationalCode, s.staffType === 2 ? "دندانپزشک" : "کارمند"].forEach(v => {
                    const td = document.createElement("td"); td.textContent = v ?? ""; tr.appendChild(td);
                });
                const td = document.createElement("td"), edit = document.createElement("button");
                edit.type = "button"; edit.textContent = "ویرایش"; edit.onclick = () => openForm(s);
                td.appendChild(edit); tr.appendChild(td); $("staffTableBody").appendChild(tr);
            });
            $("staffStatus").textContent = x.count ? "" : "شخصی ثبت نشده است.";
        } catch (e) { $("staffStatus").textContent = e.message; $("staffStatus").classList.add("error"); }
    }

    // --- انتخابِ تخصص با جست‌وجو (۱۳۰ ردیف) ---------------------------------
    // سلکتِ بلند با «متن + datalist» جایگزین شده تا تایپ، فهرست را فیلتر کند؛
    // شناسهٔ staffSpecialtyID رویِ همان selectِ پنهان می‌ماند (با کلاس hidden)
    // چون سریالیزاسیون فعلی `Number($("staffSpecialtyID").value)` است و باید
    // همچنان SpecialtyID صحیح بدهد.
    let specialtyEntries = [];
    const specNorm = v => String(v ?? "").replace(/\u200c/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

    function fillSpecialtyOptions() {
        const select = $("staffSpecialtyID");
        const list = $("staffSpecialtyList");
        select.replaceChildren(new Option("انتخاب تخصص", ""));
        list.replaceChildren();
        specialtyEntries.forEach(e => {
            select.appendChild(new Option(e.name, String(e.id)));
            list.appendChild(new Option(e.name)); // value = نام تخصص تا تایپ با نام فیلتر شود
        });
    }

    function setSpecialty(id) {
        const hit = specialtyEntries.find(e => e.id === Number(id));
        $("staffSpecialtyID").value = hit ? String(hit.id) : "";
        $("staffSpecialtyInput").value = hit ? hit.name : "";
    }

    // هنگامِ خروج از فیلد، متن به نامِ واقعیِ تخصصِ انتخاب‌شده می‌نشیند؛ اگر به
    // هیچ ردیفی نخورد فیلد پاک می‌شود تا «انتخاب نشده» دروغ نگوید.
    function commitSpecialty() {
        const input = $("staffSpecialtyInput");
        if (!input.value.trim()) { input.value = ""; return 0; }
        const id = resolveSpecialty();
        const hit = specialtyEntries.find(e => e.id === id);
        input.value = hit ? hit.name : "";
        return id;
    }

    // متنِ تایپ‌شده ← SpecialtyID: اول تطبیق دقیق، بعد شامل‌شدن؛ انتخاب‌نشده = خالی.
    function resolveSpecialty() {
        const input = $("staffSpecialtyInput");
        const select = $("staffSpecialtyID");
        const want = specNorm(input.value);
        if (!want) { select.value = ""; return 0; }
        const hit = specialtyEntries.find(e => specNorm(e.name) === want)
            || specialtyEntries.find(e => specNorm(e.name).includes(want) || want.includes(specNorm(e.name)));
        select.value = hit ? String(hit.id) : "";
        return hit ? hit.id : 0;
    }

    async function loadSpecialties(selected) {
        const select = $("staffSpecialtyID");
        select.innerHTML = '<option value="">در حال دریافت تخصص‌ها...</option>';

        try {
            const x = await apiJson("/api/staff/specialties");
            specialtyEntries = (x.specialties || [])
                .map(s => ({ id: Number(s.specialtyID) || 0, name: String(s.specialtyName || "") }))
                .filter(e => e.id && e.name);
            fillSpecialtyOptions();
            setSpecialty(selected != null ? Number(selected) : 0);
            $("staffSpecialtyHint").textContent = specialtyEntries.length
                ? `نام تخصص را بنویسید و از فهرست انتخاب کنید (${specialtyEntries.length.toLocaleString("fa-IR")} تخصص).`
                : "نام تخصص را بنویسید و از فهرست انتخاب کنید.";
        } catch (e) {
            specialtyEntries = [];
            select.innerHTML = '<option value="">دریافت تخصص‌ها ناموفق بود</option>';
            $("staffSpecialtyInput").value = "";
            $("staffFormStatus").textContent = e.message;
            $("staffFormStatus").classList.add("error");
        }
    }

    function updateSpecialtyVisibility() {
        const doctor = $("staffType").value === "2";
        $("staffSpecialtyField").classList.toggle("hidden", !doctor);
        // الزام رویِ فیلدِ دیده‌شده گذاشته می‌شود، نه رویِ selectِ پنهان؛
        // وگرنه مرورگر رویِ فیلدِ نامرئی خطای بدونِ پیام می‌دهد و فرم ارسال نمی‌شود.
        $("staffSpecialtyInput").required = doctor;
        if (!doctor) { $("staffSpecialtyID").value = ""; $("staffSpecialtyInput").value = ""; }
    }

    function openForm(s = null) {
        $("staffForm").reset();
        $("staffID").value = s?.staffID || "";
        $("staffFirstName").value = s?.firstName || "";
        $("staffLastName").value = s?.lastName || "";
        $("staffNationalCode").value = s?.nationalCode || "";
        $("staffType").value = String(s?.staffType || 1);
        updateSpecialtyVisibility();
        loadSpecialties(s?.specialtyID);
        $("staffFormStatus").textContent = "";
        $("staffForm").classList.remove("hidden");
        $("staffFirstName").focus();
    }

    $("staffType").onchange = updateSpecialtyVisibility;
    // تایپ، فهرستِ datalist را فیلتر می‌کند و شناسهٔ انتخاب‌شده را همیشه با
    // متنِ دیده‌شده هم‌گام نگه می‌دارد؛ خروج از فیلد (change) انتخاب را قطعی می‌کند.
    $("staffSpecialtyInput").addEventListener("input", () => resolveSpecialty());
    $("staffSpecialtyInput").addEventListener("change", () => commitSpecialty());
    $("staffSpecialtyInput").addEventListener("keydown", e => {
        if (e.key === "Enter") { e.preventDefault(); $("staffSpecialtyInput").blur(); }
    });
    $("newStaffButton").onclick = () => openForm();
    $("cancelStaffButton").onclick = () => $("staffForm").classList.add("hidden");
    $("staffSearchButton").onclick = loadStaff;
    $("staffSearch").onkeydown = e => { if (e.key === "Enter") loadStaff(); };

    $("staffForm").onsubmit = async e => {
        e.preventDefault();
        try {
            const nationalCode = normalize($("staffNationalCode").value.trim());
            if (!/^\d{10}$/.test(nationalCode)) throw new Error("کد ملی باید دقیقاً ۱۰ رقم باشد.");
            // «required» فقط متنِ پر را می‌سنجد؛ اینجا مطمئن می‌شویم متن واقعاً
            // به یکی از ردیف‌های فهرست خورده و SpecialtyID درست است.
            if ($("staffType").value === "2" && !resolveSpecialty())
                throw new Error("تخصص را از فهرست انتخاب کنید.");
            const id = Number($("staffID").value || 0);
            const body = {
                staffID: id,
                nationalCode,
                firstName: $("staffFirstName").value.trim(),
                lastName: $("staffLastName").value.trim(),
                staffType: Number($("staffType").value),
                specialtyID: $("staffType").value === "2" ? Number($("staffSpecialtyID").value) || null : null
            };
            $("staffFormStatus").textContent = "در حال ذخیره...";
            await apiJson(id ? `/api/staff/${id}` : "/api/staff", {
                method: id ? "PUT" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            });
            $("staffForm").classList.add("hidden");
            await loadStaff();
            if (window.showToast) window.showToast("اطلاعات شخص ذخیره شد.");
        } catch (e2) {
            $("staffFormStatus").textContent = e2.message;
            $("staffFormStatus").classList.add("error");
        }
    };
})();
