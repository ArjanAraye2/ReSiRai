// ReSiRai - dedicated QR links for one patient / one Study.
//
// سه کارِ جدا، سه توکن و سه کیوآرکدِ مستقل:
//   ۱) عکس رادیولوژی با دوربین گوشی  (به همین Study وصل می‌شود)
//   ۲) دریافت لینک/پیامک رادیولوژی از گوشی  (به همین Study وصل می‌شود)
//   ۳) عکس چهرهٔ بیمار  (روی پروندهٔ خودِ بیمار ذخیره می‌شود)
//
// صفحهٔ عمومی هر توکن فقط کارتِ مربوط به همان هدف را نشان می‌دهد؛
// سرور هم در endpointها هدفِ توکن را بررسی می‌کند.
(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const PURPOSE_CAMERA = 1;
  const PURPOSE_SMS = 2;
  const PURPOSE_PHOTO = 3;

  let current = { purpose: PURPOSE_SMS, study: null, patientID: null };

  function buildDialog() {
    if ($("studyReceiveDialog")) return;
    const wrap = document.createElement("div");
    wrap.id = "studyReceiveDialog";
    wrap.className = "confirm-overlay hidden";
    wrap.innerHTML = `
      <div class="confirm-dialog">
        <h3 id="studyReceiveDialogTitle">دریافت تصویر برای این Study</h3>
        <p class="share-dialog-hint" id="studyReceiveInfo"></p>

        <div class="inbox-card" id="studyReceiveQrCard">
          <strong id="studyReceiveQrTitle">کیوآرکد اختصاصی</strong>
          <p class="share-dialog-hint" id="studyReceiveQrHint"></p>
          <div class="pair-qr" id="studyReceiveQr"></div>
          <div class="pair-payload" id="studyReceiveUrl"></div>
          <div class="form-actions">
            <button id="studyReceiveCopy" type="button" class="secondary-button">کپی لینک</button>
          </div>
        </div>

        <div class="inbox-card" id="studyReceiveClinicCard">
          <strong>روش ۲ — فوروارد به گوشی مطب</strong>
          <p class="share-dialog-hint">
            شمارهٔ مطب: <strong id="studyClinicMobile">—</strong><br />
            به بیمار بگویید پیامک رادیولوژیست را به این شماره <strong>فوروارد</strong> کند،
            بعد این دکمه را بزنید تا از گوشی مطب گرفته شود.
          </p>
          <div class="form-actions">
            <button id="studyPullInbox" type="button">دریافت پیامک‌های مطب برای همین Study</button>
          </div>
          <div id="studyPullStatus" class="status-message"></div>
        </div>

        <div class="inbox-card" id="studyReceiveManualCard">
          <strong>روش ۳ — لینکی که خودتان دارید</strong>
          <p class="share-dialog-hint">
            لینک را از پیامک، ایمیل یا هرجای دیگر کپی کنید و اینجا بچپانید؛
            تصاویر دانلود و به <strong>همین Study</strong> وصل می‌شود.
            می‌توانید چند لینک را هم با فاصله در همین جعبه بگذارید.
          </p>
          <textarea id="manualLinkInput" rows="3" dir="ltr"
                    placeholder="http://…"
                    style="width:100%;box-sizing:border-box;direction:ltr;text-align:left;font-family:Consolas,monospace;font-size:13px;border:1px solid #d8e7ec;border-radius:10px;padding:10px"></textarea>
          <div class="form-actions">
            <button id="manualImportButton" type="button">دانلود و وصل کردن به این Study</button>
          </div>
          <div id="manualImportStatus" class="status-message"></div>
        </div>

        <div class="form-actions">
          <button id="studyReceiveClose" type="button" class="secondary-button">بستن</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    wrap.addEventListener("click", e => { if (e.target === wrap) closeDialog(); });
    $("studyReceiveClose").onclick = closeDialog;
    $("manualImportButton").onclick = importFromLink;
    $("studyReceiveCopy").onclick = async () => {
      const url = $("studyReceiveUrl").textContent;
      if (!url) return;
      try {
        await navigator.clipboard.writeText(url);
        $("studyReceiveCopy").textContent = "کپی شد";
        setTimeout(() => { $("studyReceiveCopy").textContent = "کپی لینک"; }, 1500);
      } catch { window.prompt("لینک را کپی کنید:", url); }
    };
    $("studyPullInbox").onclick = pullFromClinicPhone;
  }

  function closeDialog() {
    $("studyReceiveDialog")?.classList.add("hidden");
    $("studyReceiveQr")?.replaceChildren();
  }

  function selectedStudy() {
    return window.selectedStudy || null;
  }

  function patientName() {
    const p = window.selectedPatient;
    return p ? `${p.firstName || ""} ${p.lastName || ""}`.trim() : "";
  }

  function open(options) {
    const opts = options || {};
    const purpose = [PURPOSE_CAMERA, PURPOSE_SMS, PURPOSE_PHOTO].includes(Number(opts.purpose))
      ? Number(opts.purpose)
      : PURPOSE_SMS;
    const study = opts.study || selectedStudy();
    const patientID = Number(opts.patientID)
      || Number(window.selectedPatient?.patientID)
      || Number(study?.patientID)
      || 0;

    if (!patientID) { window.showToast?.("اول پروندهٔ بیمار را باز کنید.", "error"); return; }
    if ((purpose === PURPOSE_CAMERA || purpose === PURPOSE_SMS) && !study) {
      window.showToast?.("ابتدا Study را باز کنید.", "error");
      return;
    }

    current = { purpose, study, patientID };
    buildDialog();

    const title = purpose === PURPOSE_CAMERA
      ? "عکس رادیولوژی با دوربین گوشی"
      : purpose === PURPOSE_PHOTO
        ? "عکس بیمار (چهره)"
        : "دریافت لینک رادیولوژی از گوشی";
    $("studyReceiveDialogTitle").textContent = title;
    $("studyReceiveQrTitle").textContent = purpose === PURPOSE_PHOTO
      ? "کیوآرکد عکس چهره"
      : "کیوآرکد اختصاصی این کار";
    $("studyReceiveQrHint").textContent = purpose === PURPOSE_CAMERA
      ? "این کد را با دوربین گوشی اسکن کنید و از فیلم/عکس رادیولوژی عکس بگیرید؛ عکس مستقیماً به همین مراجعه وصل می‌شود."
      : purpose === PURPOSE_PHOTO
        ? "این کد را با دوربین گوشی اسکن کنید و از چهرهٔ بیمار عکس بگیرید؛ عکس روی پروندهٔ همین بیمار ذخیره می‌شود."
        : "این کد را با دوربین گوشی اسکن کنید و متن پیامک رادیولوژی را در صفحه بچسبانید؛ تصاویر به همین مراجعه می‌آیند.";

    const who = patientName() || "همین بیمار";
    $("studyReceiveInfo").textContent = purpose === PURPOSE_PHOTO
      ? `بیمار: ${who}`
      : `بیمار: ${who} — Study شمارهٔ ${study.studyID}`;

    $("studyReceiveClinicCard").hidden = purpose !== PURPOSE_SMS;
    $("studyReceiveManualCard").hidden = purpose !== PURPOSE_SMS;

    $("studyReceiveUrl").textContent = "";
    $("studyReceiveQr").replaceChildren();
    $("studyPullStatus").textContent = "";
    if ($("manualLinkInput")) $("manualLinkInput").value = "";
    if ($("manualImportStatus")) $("manualImportStatus").textContent = "";

    $("studyReceiveDialog").classList.remove("hidden");
    if (purpose === PURPOSE_SMS) loadClinicMobile();
    issueToken(patientID, purpose === PURPOSE_PHOTO ? null : study.studyID, purpose);
  }

  async function issueToken(patientID, studyID, purpose) {
    try {
      const res = await fetch(`/api/patients/${patientID}/receive-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiresInDays: 1, studyID, purpose })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "ساخت کیوآرکد انجام نشد.");

      $("studyReceiveUrl").textContent = data.url;
      if (typeof qrcode === "function") {
        const code = qrcode(0, "M");
        code.addData(data.url);
        code.make();
        $("studyReceiveQr").innerHTML = code.createSvgTag({
          cellSize: 4, margin: 16, scalable: true, alt: "کیوآرکد دریافت تصویر"
        });
      }
    } catch (e) {
      $("studyReceiveUrl").textContent = e.message || "ساخت کیوآرکد انجام نشد.";
    }
  }

  async function loadClinicMobile() {
    try {
      // فقط شمارهٔ مطب برمی‌گردد؛ تنظیمات کامل پیامک SuperAdmin-only است.
      const res = await fetch("/api/communications/clinic-mobile");
      if (!res.ok) return;
      const data = await res.json();
      $("studyClinicMobile").textContent = (data.mobile && data.mobile.trim()) || "در تنظیمات پیامک ثبت نشده";
    } catch {
      $("studyClinicMobile").textContent = "در تنظیمات پیامک ثبت نشده";
    }
  }

  async function pullFromClinicPhone() {
    const study = current.study || selectedStudy();
    if (!study) return;
    const status = $("studyPullStatus");
    const button = $("studyPullInbox");
    button.disabled = true;
    status.classList.remove("error");
    status.textContent = "در حال دریافت از گوشی مطب…";
    try {
      const res = await fetch(`/api/studies/${study.studyID}/pull-inbox`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "دریافت انجام نشد.");
      status.textContent = data.message;
      if (data.imported > 0 || data.fetched > 0) {
        window.showToast?.(data.message);
        if (typeof window.openStudyImages === "function") window.openStudyImages(study);
      }
    } catch (e) {
      status.textContent = e.message || "دریافت انجام نشد.";
      status.classList.add("error");
    } finally {
      button.disabled = false;
    }
  }

  /** روش ۳: لینک از قبل در دست است و داخل همین Study دانلود می‌شود. */
  async function importFromLink() {
    const study = current.study || selectedStudy();
    if (!study) return;
    const status = $("manualImportStatus");
    const button = $("manualImportButton");
    const url = $("manualLinkInput").value.trim();

    if (!url) { status.textContent = "اول لینک را وارد کنید."; status.classList.add("error"); return; }
    if (!/https?:\/\//i.test(url)) { status.textContent = "لینک باید با http:// یا https:// شروع شود."; status.classList.add("error"); return; }

    button.disabled = true;
    status.classList.remove("error");
    status.textContent = "در حال دریافت تصاویر از لینک…";
    try {
      const res = await fetch(`/api/studies/${study.studyID}/import-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "دریافت انجام نشد.");
      status.textContent = data.message;
      if (data.fetched > 0) {
        window.showToast?.(data.message);
        if (typeof window.openStudyImages === "function") window.openStudyImages(study);
      }
    } catch (e) {
      status.textContent = e.message || "دریافت انجام نشد.";
      status.classList.add("error");
    } finally {
      button.disabled = false;
    }
  }

  function addButton() {
    const toolbar = document.querySelector("#studyDetailsSection .details-toolbar");
    if (!toolbar || $("studyReceiveImagesButton")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "studyReceiveImagesButton";
    btn.className = "secondary-button";
    btn.textContent = "دریافت لینک رادیولوژی از گوشی";
    btn.onclick = () => open({ purpose: PURPOSE_SMS, study: selectedStudy() });
    toolbar.appendChild(btn);
  }

  // دکمه‌ها در index.html هستند؛ اگر جایی حذف شدند دوباره ساخته می‌شوند.
  function wire() {
    const sms = $("studyReceiveImagesButton");
    if (sms) sms.onclick = () => open({ purpose: PURPOSE_SMS, study: selectedStudy() });
    else addButton();

    const camera = $("studyCameraPhoneButton");
    if (camera) camera.onclick = () => open({ purpose: PURPOSE_CAMERA, study: selectedStudy() });

    const imagesSms = $("imagesToolbarReceiveButton");
    if (imagesSms && !imagesSms.dataset.wired) {
      imagesSms.dataset.wired = "1";
      imagesSms.onclick = () => open({ purpose: PURPOSE_SMS, study: selectedStudy() });
    }
    const imagesCamera = $("imagesToolbarCameraButton");
    if (imagesCamera && !imagesCamera.dataset.wired) {
      imagesCamera.dataset.wired = "1";
      imagesCamera.onclick = () => open({ purpose: PURPOSE_CAMERA, study: selectedStudy() });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();

  const observer = new MutationObserver(wire);
  const host = document.getElementById("studyDetailsSection");
  if (host) observer.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });

  // برای کارتِ مراجعه در پروندهٔ بیمار: فراخواننده اول selectedStudy را روی
  // همان مراجعه تنظیم می‌کند، بعد این را با {purpose, study, patientID} صدا می‌زند.
  window.ReSiRaiReceive = { open };
})();
