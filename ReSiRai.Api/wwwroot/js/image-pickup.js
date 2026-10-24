// الصاق تصویرِ موجود در پرونده به مراجعهٔ باز، تعیین نوع، یا حذف با تأیید کاربر؛
// فقط تصاویری که نوعشان تعیین نشده یا به این مراجعه وصل نیستند فهرست می‌شوند.
// داده از picker آمادهٔ سرور می‌آید: /api/radiologyimages/study/{id}/picker (با پرچم attached).
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  function toast(message, type) {
    if (typeof window.showToast === "function") window.showToast(message, type || "success");
  }

  function confirmAction({ title, message, confirmText, danger = true }) {
    if (typeof window.askConfirmation === "function") return window.askConfirmation({ title, message, confirmText, danger });
    return Promise.resolve(window.confirm(message));
  }

  function currentStudy() {
    if (typeof selectedStudy === "object" && selectedStudy) return selectedStudy;
    return window.selectedStudy || null;
  }

  function refreshGrid(study) {
    if (study && typeof window.loadStudyDetailsImages === "function") {
      try { window.loadStudyDetailsImages(study); } catch (e) { console.warn(e); }
    }
  }

  function readJson(r) { return r.json().catch(() => ({})); }

  function attachedLabel(image) {
    const total = (image.linkedStudyIDs || []).length;
    const others = Math.max(0, total - (image.attached ? 1 : 0));
    if (!image.attached) return others ? `به این مراجعه متصل نیست (${others} مراجعهٔ دیگر)` : "به این مراجعه متصل نیست";
    return others ? `به این مراجعه متصل است (+${others} مراجعهٔ دیگر)` : "به این مراجعه متصل است";
  }

  function mkButton(text, className) {
    const b = document.createElement("button");
    b.type = "button";
    if (className) b.className = className;
    b.textContent = text;
    return b;
  }

  let modal = null, listEl = null, statusEl = null, studyInDialog = null;
  const autoTried = new Set();

  // تشخیصِ نوع با بررسیِ خودِ تصویر؛ اگر سرویسِ AI تنظیم نشده باشد، دکمهٔ
  // انتخابِ دستیِ نوع سرِ جایش می‌ماند و چیزی خراب نمی‌شود.
  async function autoClassify(image, cardEl, typeEl) {
    if (image.imageTypeID || image.imageTypeName) return;
    if (autoTried.has(image.imageID)) return;
    autoTried.add(image.imageID);
    try {
      const r = await fetch(`/api/ai/images/${image.imageID}/classify`, { method: "POST" });
      const x = await readJson(r);
      if (!r.ok || !x.success || !x.imageTypeName) return;
      image.imageTypeName = x.imageTypeName;
      typeEl.textContent = "نوع تصویر: " + x.imageTypeName;
      const classifyBtn = cardEl.querySelector('[data-role="classify"]');
      if (classifyBtn) classifyBtn.remove();
      refreshGrid(studyInDialog);
    } catch { /* بدونِ AI: انتخابِ دستی */ }
  }

  function ensureModal() {
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "imagePickupModal";
    modal.className = "confirm-overlay hidden";
    modal.innerHTML =
      '<div class="confirm-dialog pickup-dialog">' +
      '<button class="modal-close-button pickup-close" type="button" aria-label="بستن">×</button>' +
      "<h3>الصاق تصویر موجود از پرونده</h3>" +
      '<p class="pickup-hint">تصاویر پروندهٔ این بیمار که به این مراجعه وصل نیستند. یک تصویر می‌تواند هم‌زمان در چند مراجعه معتبر باشد؛ «الصاق» فقط اضافه می‌کند و اتصال‌های دیگر را دست نمی‌زند.</p>' +
      '<div id="imagePickupStatus" class="status-message"></div>' +
      '<div id="imagePickupList" class="pickup-list"></div>' +
      "</div>";
    document.body.appendChild(modal);
    listEl = modal.querySelector("#imagePickupList");
    statusEl = modal.querySelector("#imagePickupStatus");
    modal.querySelector(".pickup-close").onclick = close;
    modal.addEventListener("click", (ev) => { if (ev.target === modal) close(); });
    return modal;
  }

  function close() { if (modal) modal.classList.add("hidden"); }

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && modal && !modal.classList.contains("hidden")) close();
  });

  function updateStatus() {
    const left = listEl.querySelectorAll(".pickup-card").length;
    statusEl.classList.remove("error");
    statusEl.textContent = left ? `تصاویر باقی‌مانده: ${left}` : "تصویر تعیین‌نشده یا غیرمتصلی باقی نماند.";
  }

  function startClassify(image, cardEl, typeEl) {
    const actions = cardEl.querySelector(".pickup-actions");
    if (!actions || cardEl.querySelector(".pickup-classify")) return;
    const classifyBtn = actions.querySelector('[data-role="classify"]');
    if (classifyBtn) classifyBtn.classList.add("hidden");
    fetch("/api/imagetypes").then(readJson).then((x) => {
      if (!x.success) throw new Error(x.message || "انواع تصویر دریافت نشد.");
      const types = x.imageTypes || [];
      if (!types.length) { toast("هنوز نوع تصویری ثبت نشده است.", "error"); if (classifyBtn) classifyBtn.classList.remove("hidden"); return; }
      const row = document.createElement("span");
      row.className = "pickup-classify";
      const sel = document.createElement("select");
      types.forEach((t) => {
        const o = document.createElement("option");
        o.value = t.imageTypeID;
        o.textContent = t.imageTypeName;
        sel.appendChild(o);
      });
      const ok = mkButton("ثبت", "secondary-button");
      const cancel = mkButton("انصراف", "secondary-button");
      row.append(sel, ok, cancel);
      actions.appendChild(row);
      cancel.onclick = () => { row.remove(); if (classifyBtn) classifyBtn.classList.remove("hidden"); };
      ok.onclick = async () => {
        ok.disabled = true;
        try {
          const r = await fetch(`/api/radiologyimages/${image.imageID}/type`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageTypeID: Number(sel.value) })
          });
          const y = await readJson(r);
          if (!r.ok || !y.success) throw new Error(y.message || "تعیین نوع تصویر انجام نشد.");
          image.imageTypeID = y.imageTypeID;
          image.imageTypeName = y.imageTypeName;
          typeEl.textContent = "نوع تصویر: " + y.imageTypeName;
          row.remove();
          if (classifyBtn) classifyBtn.remove();
          refreshGrid(studyInDialog);
          toast("نوع تصویر تعیین شد.");
        } catch (e) { toast(e.message || "تعیین نوع تصویر انجام نشد.", "error"); ok.disabled = false; }
      };
    }).catch((e) => {
      toast(e.message || "انواع تصویر دریافت نشد.", "error");
      if (classifyBtn) classifyBtn.classList.remove("hidden");
    });
  }

  function card(image) {
    const el = document.createElement("div");
    el.className = "pickup-card";

    let media;
    if (image.contentType === "application/pdf") {
      media = document.createElement("div");
      media.className = "pdf-thumbnail";
      media.textContent = "PDF";
    } else {
      media = document.createElement("img");
      media.className = "pickup-thumb";
      media.src = `/api/radiologyimages/${image.imageID}`;
      media.alt = image.fileName;
      media.loading = "lazy";
    }
    media.onclick = () => { if (typeof window.openLargeImage === "function") window.openLargeImage(image); };

    const name = document.createElement("div");
    name.className = "pickup-name";
    name.textContent = image.fileName;

    const typeEl = document.createElement("div");
    typeEl.className = "field-hint";
    typeEl.textContent = image.imageTypeName ? `نوع تصویر: ${image.imageTypeName}` : "نوع تصویر: تعیین‌نشده";

    const badge = document.createElement("div");
    badge.className = "pickup-badge" + (image.attached ? " is-attached" : "");
    badge.textContent = attachedLabel(image);

    const actions = document.createElement("div");
    actions.className = "pickup-actions";

    const linkCount = (image.linkedStudyIDs || []).length;

    if (!image.attached) {
      const attach = mkButton("الصاق به این مراجعه");
      attach.onclick = async () => {
        attach.disabled = true;
        try {
          const r = await fetch(`/api/radiologyimages/study/${studyInDialog.studyID}/attach`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify([image.imageID])
          });
          const x = await readJson(r);
          if (!r.ok || !x.success) throw new Error(x.message || "الصاق تصویر انجام نشد.");
          // فقط افزودن: یک تصویر ممکن است در چند مراجعهٔ مختلف معتبر باشد،
          // پس هیچ اتصال دیگری دست نمی‌خورد.
          image.attached = true;
          image.linkedStudyIDs = Array.from(new Set((image.linkedStudyIDs || []).concat([studyInDialog.studyID])));
          refreshGrid(studyInDialog);
          el.replaceWith(card(image));
          toast("تصویر به این مراجعه الصاق شد.");
        } catch (e) { toast(e.message || "الصاق تصویر انجام نشد.", "error"); attach.disabled = false; }
      };
      actions.appendChild(attach);
    } else if (linkCount > 1) {
      const detach = mkButton("جدا کردن از این مراجعه", "secondary-button");
      detach.onclick = async () => {
        const yes = await confirmAction({
          title: "جدا کردن تصویر",
          message: "تصویر فقط از این مراجعه جدا شود و در پرونده بماند؟",
          confirmText: "جدا شود",
          danger: false
        });
        if (!yes) return;
        detach.disabled = true;
        try {
          const r = await fetch(`/api/radiologyimages/study/${studyInDialog.studyID}/detach`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify([image.imageID])
          });
          const x = await readJson(r);
          if (!r.ok || !x.success) throw new Error(x.message || "جدا کردن تصویر انجام نشد.");
          image.attached = false;
          image.linkedStudyIDs = (image.linkedStudyIDs || []).filter((sid) => sid !== studyInDialog.studyID);
          refreshGrid(studyInDialog);
          el.replaceWith(card(image));
          toast("تصویر از این مراجعه جدا شد.");
        } catch (e) { toast(e.message || "جدا کردن تصویر انجام نشد.", "error"); detach.disabled = false; }
      };
      actions.appendChild(detach);
    }

    if (!image.imageTypeID) {
      const classifyBtn = mkButton("تعیین نوع تصویر", "secondary-button");
      classifyBtn.dataset.role = "classify";
      classifyBtn.onclick = () => startClassify(image, el, typeEl);
      actions.appendChild(classifyBtn);
    }

    // حذف فقط وقتی که تصویر حداکثر به یک مراجعه متصل باشد؛ در غیر این صورت
    // همان بالا کلید «جدا کردن از این مراجعه» داده می‌شود.
    if (linkCount <= 1) {
      const del = mkButton("حذف تصویر", "danger-button");
      del.onclick = async () => {
        const yes = await confirmAction({
          title: "حذف تصویر",
          message: image.attached
            ? "این تصویر فقط به همین مراجعه متصل است و از پرونده حذف خواهد شد. پس از حذف قابل بازگشت نیست."
            : "این تصویر فقط به یک مراجعهٔ دیگر متصل است و از پرونده حذف خواهد شد. پس از حذف قابل بازگشت نیست.",
          confirmText: "حذف شود",
          danger: true
        });
        if (!yes) return;
        del.disabled = true;
        try {
          const r = await fetch(`/api/radiologyimages/${image.imageID}`, { method: "DELETE" });
          const x = await readJson(r);
          if (!r.ok || !x.success) throw new Error(x.message || "حذف تصویر انجام نشد.");
          el.remove();
          refreshGrid(studyInDialog);
          updateStatus();
          toast("تصویر حذف شد.");
        } catch (e) { toast(e.message || "حذف تصویر انجام نشد.", "error"); del.disabled = false; }
      };
      actions.appendChild(del);
    }

    el.append(media, name, typeEl, badge, actions);
    autoClassify(image, el, typeEl);
    return el;
  }

  async function open() {
    const study = currentStudy();
    if (!study) { toast("ابتدا یک مراجعه را باز کنید.", "error"); return; }
    studyInDialog = study;
    ensureModal();
    modal.classList.remove("hidden");
    listEl.replaceChildren();
    statusEl.classList.remove("error");
    statusEl.textContent = "در حال دریافت تصاویر پرونده...";
    try {
      const r = await fetch(`/api/radiologyimages/study/${study.studyID}/picker`);
      const x = await readJson(r);
      if (!r.ok || !x.success) throw new Error(x.message || "فهرست تصاویر دریافت نشد.");
      const images = (x.images || [])
        .filter((i) => !i.attached)
        // کارتِ سابقه سند است و نباید به‌عنوان تصویرِ رادیولوژی الصاق شود.
        .filter((i) => String(i.imageTypeName ?? "").trim() !== "کارت سابقه")
        .sort((a, b) => (a.imageTypeID ? 1 : 0) - (b.imageTypeID ? 1 : 0));
      images.forEach((image) => listEl.appendChild(card(image)));
      updateStatus();
    } catch (e) {
      statusEl.textContent = e.message || "فهرست تصاویر دریافت نشد.";
      statusEl.classList.add("error");
    }
  }

  function wire() {
    const a = $("pickupUnlinkedImageButton");
    if (a) a.onclick = open;
    const b = $("pickupHeaderButton");
    if (b) b.onclick = open;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();

  window.ReSiRaiImagePickup = { open, close };
})();
