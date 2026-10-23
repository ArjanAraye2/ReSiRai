// ============================================================
// ReSiRai — «تنظیمات مطب» و «پروفایل من» (پنلِ پزشک/پرسنل)
// ============================================================
// این صفحه فقط برای پزشک و پرسنل است؛ تنظیماتِ سراسریِ پیامک (API Key و …)
// جای دیگری و مخصوصِ مدیرِ سیستم است. شمارهٔ مطب همان شماره‌ای است که بیمار
// پیامکِ رادیولوژیست را به آن فوروارد می‌کند.
(() => {
    "use strict";

    const $ = id => document.getElementById(id);
    const isSuper = () => window.reSiRaiCurrentUser?.isSuperAdmin === true;

    const link = document.createElement("a");
    link.href = "#";
    link.className = "sidebar-link hidden";
    link.dataset.nav = "clinicSettings";
    link.innerHTML = '<span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V9.5L12 4l8 5.5V20"/><path d="M9 20v-6h6v6"/></svg></span>تنظیمات مطب';

    const section = document.createElement("section");
    section.id = "clinicSettingsSection";
    section.className = "card hidden shell-page";
    section.innerHTML = `
      <div class="section-header"><div><h2>تنظیمات مطب</h2><p>شمارهٔ مطب و اطلاعاتِ پروفایلِ خودتان</p></div></div>

      <section class="settings-card">
        <h3>مطب</h3>
        <div class="form-grid">
          <div class="form-field"><label for="clinicName">نام مطب</label><input id="clinicName" maxlength="200" /></div>
          <div class="form-field"><label for="clinicPhone">شمارهٔ تلفن مطب</label><input id="clinicPhone" inputmode="tel" maxlength="30" placeholder="۰۹…" /><small class="field-hint">بیمار پیامکِ رادیولوژیست را به همین شماره فوروارد می‌کند.</small></div>
          <div class="form-field full-width"><label for="clinicAddress">نشانی (اختیاری)</label><input id="clinicAddress" maxlength="500" /></div>
        </div>
        <div class="form-actions"><button id="clinicSaveButton" type="button" class="primary-button">ذخیرهٔ تنظیمات مطب</button></div>
        <div id="clinicStatus" class="status-message"></div>
      </section>

      <section class="settings-card">
        <h3>پروفایل من</h3>
        <p class="field-hint">نام، کد ملی و تخصص از ثبت‌نام/مدیریتِ پرسنل می‌آید و فقط‌خواندنی است؛ <strong>موبایل شخصی</strong> و <strong>عکسِ پروفایل</strong> قابلِ ویرایش‌اند.</p>
        <div class="profile-photo-row">
          <div class="profile-photo" id="profilePhotoBox"></div>
          <div class="profile-photo-actions">
            <input id="profilePhotoInput" type="file" accept="image/*" capture="environment" class="hidden" />
            <button id="profilePhotoButton" type="button" class="secondary-button">انتخاب/تغییر عکس</button>
            <small class="field-hint">عکس روی داشبورد نمایش داده می‌شود (حداکثر ۸ مگابایت).</small>
            <div id="profilePhotoStatus" class="status-message"></div>
          </div>
        </div>
        <div class="form-grid">
          <div class="form-field"><label for="profileFirstName">نام</label><input id="profileFirstName" maxlength="100" readonly /></div>
          <div class="form-field"><label for="profileLastName">نام خانوادگی</label><input id="profileLastName" maxlength="100" readonly /></div>
          <div class="form-field"><label for="profileMobile">موبایل شخصی</label><input id="profileMobile" inputmode="tel" maxlength="30" placeholder="۰۹…" /><button id="profileMobileSaveButton" type="button" class="secondary-button">ذخیرهٔ موبایل</button><div id="profileMobileStatus" class="status-message"></div></div>
          <div class="form-field"><label for="profileNationalCode">کد ملی (ورود)</label><input id="profileNationalCode" readonly /></div>
          <div class="form-field"><label for="profileSpecialty">تخصص</label><input id="profileSpecialty" readonly /></div>
        </div>
      </section>`;

    function syncAuth() {
        const nav = document.querySelector(".sidebar-nav");
        if (nav && !nav.querySelector('[data-nav="clinicSettings"]')) {
            const before = nav.querySelector('[data-nav="settings"]');
            nav.insertBefore(link, before);
        }
        if (!section.isConnected) document.querySelector(".page-container")?.appendChild(section);

        const superAdmin = isSuper();
        link.classList.toggle("hidden", superAdmin);
        // «تنظیمات»ِ موجود، تنظیماتِ مدیرِ سیستم است؛ پزشک/پرسنل آن را نمی‌بیند.
        document.querySelector('.sidebar-link[data-nav="settings"]')?.classList.toggle("hidden", !superAdmin);
        if (superAdmin && !section.classList.contains("hidden")) show("dashboard");
    }

    function setStatus(id, text, isError) {
        const el = $(id);
        if (!el) return;
        el.textContent = text || "";
        el.classList.toggle("error", !!isError);
    }

    function show(name) {
        document.querySelectorAll(".page-container > section").forEach(x => x.classList.add("hidden"));
        const target = name === "clinicSettings" ? section : document.getElementById("dashboardSection");
        target?.classList.remove("hidden");
        document.querySelectorAll(".sidebar-link").forEach(x => x.classList.toggle("active", x.dataset.nav === name));
        window.scrollTo(0, 0);
    }
    async function load() {
        try {
            const r = await fetch("/api/profile", { cache: "no-store" });
            const x = await r.json();
            if (!r.ok || !x.success) throw new Error(x.message || "دریافت اطلاعات ناموفق بود.");

            if (!x.profile && !x.clinic) {
                link.classList.add("hidden");
                return;
            }
            const p = x.profile || {}, c = x.clinic || {};
            if ($("clinicName")) $("clinicName").value = c.clinicName || "";
            if ($("clinicPhone")) $("clinicPhone").value = c.phone || "";
            if ($("clinicAddress")) $("clinicAddress").value = c.address || "";
            if ($("profileFirstName")) $("profileFirstName").value = p.firstName || "";
            if ($("profileLastName")) $("profileLastName").value = p.lastName || "";
            if ($("profileMobile")) $("profileMobile").value = p.mobile || "";
            if ($("profileNationalCode")) $("profileNationalCode").value = p.nationalCode || "";
            if ($("profileSpecialty")) $("profileSpecialty").value = p.specialtyName || "—";
            paintPhoto(p);

            if (!x.clinic) {
                $("clinicName")?.closest(".settings-card")?.classList.add("hidden");
            }
            if (!x.profile) {
                $("profileFirstName")?.closest(".settings-card")?.classList.add("hidden");
            }
            setStatus("clinicStatus", "", false);
            setStatus("profileMobileStatus", "", false);
        } catch (e) {
            setStatus("clinicStatus", e.message || "دریافت اطلاعات ناموفق بود.", true);
        }
    }

    async function saveClinic() {
        const button = $("clinicSaveButton");
        button.disabled = true;
        setStatus("clinicStatus", "در حال ذخیره…", false);
        try {
            const r = await fetch("/api/profile/clinic", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    clinicName: $("clinicName").value.trim(),
                    phone: $("clinicPhone").value.trim(),
                    address: $("clinicAddress").value.trim()
                })
            });
            const x = await r.json().catch(() => ({}));
            if (!r.ok || !x.success) throw new Error(x.message || "ذخیره انجام نشد.");
            setStatus("clinicStatus", x.message || "ذخیره شد.", false);
            window.showToast?.("تنظیمات مطب ذخیره شد.");
        } catch (e) {
            setStatus("clinicStatus", e.message || "ذخیره انجام نشد.", true);
        } finally {
            button.disabled = false;
        }
    }

    async function saveMobile() {
        const button = $("profileMobileSaveButton");
        button.disabled = true;
        setStatus("profileMobileStatus", "در حال ذخیره…", false);
        try {
            const r = await fetch("/api/profile/mobile", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mobile: $("profileMobile").value.trim() })
            });
            const x = await r.json().catch(() => ({}));
            if (!r.ok || !x.success) throw new Error(x.message || "ذخیره انجام نشد.");
            $("profileMobile").value = x.mobile || "";
            setStatus("profileMobileStatus", x.message || "ذخیره شد.", false);
            if (window.reSiRaiCurrentUser) window.reSiRaiCurrentUser.mobile = x.mobile;
            window.showToast?.("موبایلِ شخصی ذخیره شد.");
        } catch (e) {
            setStatus("profileMobileStatus", e.message || "ذخیره انجام نشد.", true);
        } finally {
            button.disabled = false;
        }
    }

    function paintPhoto(profile) {
        const box = $("profilePhotoBox");
        if (!box) return;
        const photo = profile?.photoRelativePath;
        if (photo) {
            box.classList.add("has-photo");
            box.style.backgroundImage = `url("/api/profile/photo?v=${encodeURIComponent(photo)}")`;
            box.textContent = "";
        } else {
            box.classList.remove("has-photo");
            box.style.backgroundImage = "";
            const first = (profile?.firstName || "").trim();
            const last = (profile?.lastName || "").trim();
            box.textContent = ((first ? first[0] : "") + (last ? last[0] : "")) || "R";
        }
    }

    async function uploadPhoto() {
        const input = $("profilePhotoInput");
        const file = input?.files?.[0];
        if (!file) return;
        const button = $("profilePhotoButton");
        button.disabled = true;
        setStatus("profilePhotoStatus", "در حال ارسال عکس…", false);
        try {
            const form = new FormData();
            form.append("file", file);
            const r = await fetch("/api/profile/photo", { method: "POST", body: form });
            const x = await r.json().catch(() => ({}));
            if (!r.ok || !x.success) throw new Error(x.message || "ذخیرهٔ عکس انجام نشد.");
            paintPhoto({ photoRelativePath: x.photoRelativePath });
            setStatus("profilePhotoStatus", x.message || "عکس ذخیره شد.", false);
            // داشبورد دفعهٔ بعد عکسِ تازه را نشان دهد.
            window.ReSiRaiDashboardProfileChanged?.();
            window.showToast?.("عکس پروفایل ذخیره شد.");
        } catch (e) {
            setStatus("profilePhotoStatus", e.message || "ذخیرهٔ عکس انجام نشد.", true);
        } finally {
            button.disabled = false;
            if (input) input.value = "";
        }
    }

    function init() {
        syncAuth();
        link.addEventListener("click", e => {
            e.preventDefault();
            show("clinicSettings");
            load();
        });
        $("clinicSaveButton")?.addEventListener("click", saveClinic);
        $("profileMobileSaveButton")?.addEventListener("click", saveMobile);
        $("profilePhotoButton")?.addEventListener("click", () => $("profilePhotoInput")?.click());
        $("profilePhotoInput")?.addEventListener("change", uploadPhoto);
        document.addEventListener("resirai-auth-changed", syncAuth);
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();
