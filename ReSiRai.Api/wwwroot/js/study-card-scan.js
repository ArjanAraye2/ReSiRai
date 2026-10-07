// Scan or photograph a legacy record card on the "new visit" form.
//
// The picture is read once by AI into a field-by-field review dialog; only ticked
// fields are copied into the form, and the picture itself is uploaded only after the
// visit exists — so cancelling the form leaves nothing behind, and a rejected
// consent means the image never leaves this machine.
(() => {
 "use strict";
 const esc = v => { const d = document.createElement("div"); d.textContent = v ?? ""; return d.innerHTML; };
 // مقدارِ داخلِ ویژگیِ HTML: نقل‌قول هم باید گِریخته شود تا value نشکند.
 const attr = v => esc(v).replace(/"/g, "&quot;");
 const CARD_TYPE = "کارت سابقه";
 let pendingFile = null, cardTypeID = 0;

 function status(msg, error) {
  const el = document.getElementById("studyCardScanStatus");
  if (!el) return;
  el.textContent = msg || "";
  el.classList.toggle("error", !!error);
 }

 // ---- the field itself, added to the new-visit form --------------------------
 function mount() {
  const grid = document.querySelector("#newStudyForm .form-grid");
  if (!grid || document.getElementById("studyCardScanField")) return;
  const field = document.createElement("div");
  field.className = "form-field full-width";
  field.id = "studyCardScanField";
  field.innerHTML =
   '<label for="studyCardScanInput">کارت سابقهٔ بیمار (عکس یا اسکن)</label>' +
   '<div class="file-picker"><input id="studyCardScanInput" type="file" accept="image/*" capture="environment" />' +
   '<span class="file-picker-face"><span class="file-picker-button">عکس یا اسکنِ کارت</span>' +
   '<span class="file-picker-name">فایلی انتخاب نشده</span></span></div>' +
   '<small class="field-hint">با هوش مصنوعی خوانده می‌شود و پس از تأییدِ شما فرم را پُر می‌کند؛ عکس فقط بعد از ثبتِ مراجعه ذخیره می‌شود.</small>' +
   '<div id="studyCardScanStatus" class="status-message"></div>';
  grid.appendChild(field);
  field.querySelector("#studyCardScanInput").addEventListener("change", e => onFile(e.target));
 }

 function resetPicker(input, name) {
  input.value = "";
  const label = input.closest(".file-picker")?.querySelector(".file-picker-name");
  if (label) label.textContent = "فایلی انتخاب نشده";
 }

 // ---- send the picture (consent first, enforced again by the server) ---------
 async function onFile(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const label = input.closest(".file-picker")?.querySelector(".file-picker-name");
  if (label) label.textContent = file.name;
  status("در حال آماده‌سازی…");
  if (window.ReSiRaiAIConsent) {
   const ok = await window.ReSiRaiAIConsent.ask();
   if (!ok) { resetPicker(input); status(""); return; }
  }
  status("در حال خواندنِ نوشته‌های کارت…");
  try {
   const fd = new FormData();
   fd.append("card", file, file.name || "card.jpg");
   const r = await fetch("/api/ai/study-card?consent=1", { method: "POST", body: fd });
   let x = {};
   try { x = await r.json(); } catch {}
   if (!r.ok || x.success === false) throw new Error(x.message || "خواندنِ کارت انجام نشد.");
   pendingFile = file;
   status("");
   review(x.extraction || {});
  } catch (e) {
   resetPicker(input);
   status(e.message || "خواندنِ کارت انجام نشد.", true);
  }
 }

 // ---- review dialog: one row per field, tick to use it ----------------------
 const ROWS = [
  ["studyDate", "تاریخ مراجعه", "input"],
  ["studyType", "دلیل مراجعه", "input"],
  ["bodyPart", "ناحیه", "input"],
  ["description", "توضیحات", "area"],
  ["report", "تشخیص", "area"]
 ];

 function review(x) {
  const s = x.study || {};
  const other = Array.isArray(x.otherNotes) ? x.otherNotes.filter(v => String(v ?? "").trim()) : [];
  const uncertain = Array.isArray(x.uncertainFields) ? x.uncertainFields : [];
  const teeth = Array.isArray(s.teeth) ? s.teeth.map(Number).filter(Number.isFinite) : [];
  const values = {
   studyDate: s.studyDateNormalized || s.studyDate || "",
   studyType: s.studyType || "",
   bodyPart: s.bodyPart || "",
   description: s.description || "",
   report: s.report || ""
  };
  const rows = ROWS.map(([key, label, kind]) => {
   const value = values[key];
   const on = String(value ?? "").trim() ? " checked" : "";
   const control = kind === "area"
    ? `<textarea rows="2">${esc(value)}</textarea>`
    : `<input type="text" value="${attr(value)}" />`;
   return `<div class="scan-row" data-key="${key}"><label class="scan-pick"><input type="checkbox"${on} /></label><div class="scan-cell"><span class="scan-label">${esc(label)}</span>${control}</div></div>`;
  }).join("");
  const teethRow = teeth.length
   ? `<div class="scan-row" data-key="teeth"><label class="scan-pick"><input type="checkbox" checked /></label><div class="scan-cell"><span class="scan-label">شمارهٔ دندان‌ها</span><input type="text" value="${attr(teeth.join("، "))}" /></div></div>`
   : "";

  const box = document.createElement("div");
  box.className = "card-extraction-overlay";
  box.innerHTML = `<div class="card-extraction-dialog" role="dialog" aria-modal="true">
   <header><div><h3>بازبینیِ اطلاعاتِ کارت</h3><span>فقط مواردِ تیک‌خورده در فرم استفاده می‌شود</span></div><button type="button" class="card-extraction-close">×</button></header>
   <div class="card-extraction-body">
    <p class="card-extraction-warning">این اطلاعات را هوش مصنوعی از روی کارت خوانده است. قبل از ثبت، حتماً با کارتِ اصلی تطبیق دهید.</p>
    ${rows}${teethRow}
    ${uncertain.length ? `<div class="card-extraction-uncertain"><strong>موارد نیازمند بررسی:</strong> ${esc(uncertain.join("، "))}</div>` : ""}
    ${other.length ? `<section><h4>یادداشت‌های دیگرِ کارت</h4><pre>${esc(other.join("\n"))}</pre></section>` : ""}
    <p class="field-hint">«دلیل مراجعه» فقط وقتی با لیستِ فرم بخواند انتخاب می‌شود؛ وگرنه همان‌جا گفته می‌شود.</p>
   </div>
   <footer><button type="button" class="secondary-button scan-cancel">انصراف</button><button type="button" class="scan-apply">استفاده از مواردِ تیک‌خورده</button></footer>
  </div>`;
  document.body.appendChild(box);
  const close = () => box.remove();
  box.querySelector(".card-extraction-close").onclick = close;
  box.querySelector(".scan-cancel").onclick = () => { close(); status("انصراف داده شد؛ فرم تغییری نکرد."); };
  box.addEventListener("click", e => { if (e.target === box) close(); });
  box.querySelector(".scan-apply").onclick = () => apply(box, close);
 }

 function normalizeDate(value) {
  const s = normalizeDigits(String(value ?? "").trim());
  const m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(\s+(\d{1,2}:\d{1,2}))?/);
  if (!m) return null;
  const pad = n => String(n).padStart(2, "0");
  return `${m[1]}/${pad(m[2])}/${pad(m[3])}${m[4] ? " " + m[4].trim() : ""}`;
 }

 // The reason for visit is a <select>; the card only holds free text, so the text
 // is matched against the list and reported instead of silently dropped.
 function matchStudyType(text) {
  const sel = document.getElementById("newStudyType");
  if (!sel) return false;
  const norm = v => normalizeDigits(String(v ?? "")).replace(/[‌‍]/g, "").replace(/\s+/g, " ").trim();
  const want = norm(text);
  if (!want) return false;
  const options = [...sel.options].filter(o => o.value);
  let hit = options.find(o => norm(o.textContent) === want);
  if (!hit) hit = options.find(o => norm(o.textContent).includes(want) || want.includes(norm(o.textContent)));
  if (!hit) return false;
  sel.value = hit.value;
  return true;
 }

 function apply(box, close) {
  const picked = {};
  box.querySelectorAll(".scan-row").forEach(row => {
   const key = row.dataset.key;
   const on = row.querySelector("input[type=checkbox]")?.checked;
   const field = row.querySelector("textarea, input[type=text]");
   picked[key] = { on: !!on, value: field ? field.value : "" };
  });
  const notes = [];
  let used = 0;

  if (picked.studyDate?.on) {
   const v = normalizeDate(picked.studyDate.value);
   if (v) { const el = document.getElementById("newStudyDate"); if (el) el.value = v; used++; }
   else if (String(picked.studyDate.value).trim()) notes.push(`تاریخ قابل استفاده نبود: ${picked.studyDate.value}`);
  }
  if (picked.studyType?.on && String(picked.studyType.value).trim()) {
   if (matchStudyType(picked.studyType.value)) used++;
   else notes.push(`دلیلِ مراجعهٔ پیشنهادی در لیست نیست: ${picked.studyType.value}`);
  }
  for (const [key, id] of [["bodyPart", "newBodyPart"], ["description", "newStudyDescription"], ["report", "newStudyDiagnosis"]]) {
   if (picked[key]?.on) { const el = document.getElementById(id); if (el) { el.value = picked[key].value; used++; } }
  }
  if (picked.teeth?.on) {
   const arr = String(picked.teeth.value).split(/[،,\s]+/)
    .map(v => Number(normalizeDigits(v))).filter(Number.isFinite);
   const chart = document.getElementById("newStudyTeethChart");
   if (arr.length && chart && window.ReSiRaiTeethChart) { window.ReSiRaiTeethChart.render(chart, arr); used++; }
   else if (arr.length) notes.push("نمودارِ دندان‌ها هنوز آماده نیست؛ شماره‌ها انتخاب نشدند.");
  }

  close();
  const count = Object.values(picked).filter(v => v.on).length;
  const msg = `${used} از ${count} موردِ تیک‌خورده در فرم قرار گرفت.`
   + (notes.length ? ` — ${notes.join(" — ")}` : "")
   + " — بعد از بازبینی، «ثبت مراجعه» را بزنید.";
  status(msg, false);
  document.getElementById("newStudySubmitButton")?.scrollIntoView({ block: "center", behavior: "smooth" });
 }

 // ---- upload the picture, but only after the visit exists -------------------
 async function uploadPending(studyID) {
  if (!pendingFile || !studyID) return false;
  try {
   if (!cardTypeID) {
    const r = await fetch("/api/imagetypes");
    let x = {};
    try { x = await r.json(); } catch {}
    const types = (x && x.imageTypes) || [];
    const hit = types.find(t => String(t.imageTypeName ?? "").trim() === CARD_TYPE);
    if (!hit) throw new Error(`نوعِ تصویرِ «${CARD_TYPE}» در سیستم پیدا نشد.`);
    cardTypeID = hit.imageTypeID;
   }
   const fd = new FormData();
   fd.append("file", pendingFile);
   const ur = await fetch(`/api/radiologyimages?studyID=${studyID}&imageTypeID=${cardTypeID}`, { method: "POST", body: fd });
   let ux = {};
   try { ux = await ur.json(); } catch {}
   if (!ur.ok || ux.success === false) throw new Error(ux.message || "ذخیره انجام نشد.");
   pendingFile = null;
   showToast("عکسِ کارتِ سابقه ذخیره شد.");
   return true;
  } catch (e) {
   showToast("مراجعه ثبت شد، ولی عکسِ کارت ذخیره نشد: " + (e.message || ""), "error");
   return false;
  }
 }

 window.ReSiRaiStudyCardScan = { mount, uploadPending, hasFile: () => !!pendingFile };
 if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
 else mount();
})();
