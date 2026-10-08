// دیکتهٔ همهٔ فیلدهایِ متنی: هر input و textarea که هنوز میکروفن نداشته باشد
// میکروفن و ✕ می‌گیرد — بدونِ واژهٔ بیداری؛ هر جملهٔ قطعی به فیلد اضافه می‌شود
// و چیزی خودکار ثبت نمی‌شود — کاربر متن را بازبینی و خودش ذخیره می‌کند.
(() => {
 "use strict";

 let recognition = null;
 let listening = false;
 let currentInput = null;
 let currentBtn = null;
 let lastActivity = 0;

 // تکست‌های «آزاد»: هر input و textarea که متنِ آزاد می‌گیرد (نام، موبایل،
 // توضیحات، شرحِ اقدام و …) و هنوز میکروفنِ خودش را ندارد. هیچ شناسهٔ ثابتی
 // نمی‌خواهیم — چون فرم‌ها به‌صورتِ پویا دیده می‌شوند (کارتِ پیش‌نویسِ مراجعه،
 // کارت‌های بازشونده، پنل‌ها) — پس برش می‌کنیم به «همهٔ تکست‌ها».
 const FREE_TEXT_SELECTOR = [
  'input[type="text"]',
  'input[type="search"]',
  'input[type="tel"]',
  'input:not([type])',
  'textarea'
 ].map(s => s + ":not(.gsec-txt)").join(","); // آیکنِ خودِ بخش‌ها دارند (attachTools)

 const isRootSelector = "#host, #patientsSection, #patientDetailsSection, #studyDetailsSection, #studyImagesSection, #newPatientSection, #editPatientSection, #mergePatientSection, #uploadImageSection, #visitDraftHost, #studiesContainer, .visit-fields";

 function isDictatable(el) {
  if (!el || !el.matches(FREE_TEXT_SELECTOR)) return false;
  if (el.type === "password" || el.type === "number" || el.type === "email" || el.type === "checkbox" || el.type === "radio" || el.type === "submit") return false;
  if (el.dataset.dicOff === "1") return false;               // برچسبِ خاموش
  if (el.hasAttribute("data-dictate-off")) return false;     // برچسبِ قدیمی
  if (wrapOf(el)) return false;                              // قبلاً پیچیده شده
  if (el.readOnly || el.disabled) return false;              // صرفاً نمایش (حالتِ نمایشِ کارت)
  if (!el.offsetHeight) return false;                        // پنهان (فرمِ بسته یا کارتِ بسته)
  if (el.closest("#loginSection")) return false;             // صفحهٔ ورود طرحِ خودش را دارد
  return !!el.closest(isRootSelector);                       // فقط صفحه‌هایِ محصول، نه مدال‌ها و دایالوگ‌ها
 }

 // همهٔ تکست‌هایِ آزادِ دیده‌شده (بدونِ آن‌هایی که باکسِ میکروفن/✕ دارند)
 function freeTextTargets(root) {
  const out = [];
  const scope = root instanceof Element ? root : null;
  const roots = scope && scope.matches(isRootSelector) ? [scope] : Array.from(document.querySelectorAll(isRootSelector));
  for (const r of roots) {
   r.querySelectorAll(FREE_TEXT_SELECTOR).forEach(el => {
    if (isDictatable(el)) out.push(el);
   });
  }
  return out;
 }

 function wrapOf(el) { return el ? el.closest(".dictate-wrap") : null; }
 function hintOf(el) { return wrapOf(el)?.querySelector(".dictate-hint") || null; }

 function paint(btn, on) {
  if (!btn) return;
  btn.classList.toggle("is-listening", on);
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  btn.textContent = on ? "●" : "🎤";
  btn.title = on ? "در حال گوش دادن — کلیک یا Esc برای توقف" : "دیکته (کلیک برای شروع · Esc برای توقف)";
 }

 function hint(el, text) {
  const h = hintOf(el);
  if (h) h.textContent = text || "";
 }

 // دکمه (میکروفن) داخلِ خودِ فیلد پیچیده می‌شود تا چیدمانِ فرم به‌هم نریزد و ✕
 // پاک‌کننده هم همان‌جا باشد.
 function mount() {
  let targets;
  try { targets = freeTextTargets(document); }
  catch { return; } // مطمئن‌تر اگر کجای DOM عوض شده — دفعهٔ بعد دوباره تلاش می‌شود
  for (const el of targets) {
   if (wrapOf(el)) continue; // قبلاً پیچیده شده
   const wrap = document.createElement("span");
   wrap.className = "dictate-wrap";
   el.parentNode.insertBefore(wrap, el);
   wrap.appendChild(el);

   const btn = document.createElement("button");
   btn.type = "button";
   btn.className = "dictate-btn";
   btn.textContent = "🎤";
   btn.setAttribute("aria-pressed", "false");
   btn.title = "دیکته (کلیک برای شروع · Esc برای توقف)";

   // ✕ پاک‌کننده: فقط وقتی فیلد متنی دارد دیده می‌شود — همان الگویِ فیلدهایِ
   // بخش‌های مراجعه (attachTools در study-sections.js).
   const clr = document.createElement("button");
   clr.type = "button";
   clr.className = "dictate-clr";
   clr.textContent = "✕";
   clr.title = "پاک‌کردنِ همه";
   const syncClr = () => { clr.hidden = !el.value; };
   clr.addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation();
    el.value = "";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    syncClr();
    el.focus();
   });
   el.addEventListener("input", syncClr);
   syncClr();

   const hintEl = document.createElement("span");
   hintEl.className = "dictate-hint";

   wrap.append(clr, btn, hintEl);
   btn.addEventListener("click", () => {
    if (listening && currentInput === el) stop();
    else start(el);
   });
  }
 }

 function appendText(text) {
  if (!currentInput || !text) return;
  const t = String(text).trim();
  if (!t) return;
  const cur = currentInput.value;
  // بینِ تکه‌های پشت‌سرِهم فاصله می‌افتد تا جمله خوانا بماند.
  currentInput.value = cur ? cur.replace(/\s+$/, "") + " " + t : t;
  currentInput.dispatchEvent(new Event("input", { bubbles: true }));
 }

 function hardStop() {
  listening = false;
  const rec = recognition;
  recognition = null;
  if (rec) { try { rec.stop(); } catch { /* بی‌اثر */ } }
  if (currentInput) hint(currentInput, "دیکته متوقف شد");
  paint(currentBtn, false);
  currentInput = null;
  currentBtn = null;
 }

 function start(input) {
  if (input.readOnly || input.disabled) { hint(input, "اول «ویرایش» را بزنید"); return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { hint(input, "در این مرورگر نیست — از Chrome یا Edge استفاده کنید"); return; }

  if (listening) hardStop(); // یک فیلد در هر لحظه

  currentInput = input;
  currentBtn = wrapOf(input)?.querySelector(".dictate-btn") || null;
  lastActivity = Date.now();

  // دو شنوندهٔ همزمان در کروم با هم رقابت می‌کنند و میکروفن گیر می‌کند؛ پس
  // فرمانِ صوتی (در بیننده) اول بی‌سروصدا قطع می‌شود.
  try { if (window.ReSiRaiVoice?.isListening?.()) window.ReSiRaiVoice.stop(false); } catch { /* بی‌اثر */ }
  document.dispatchEvent(new CustomEvent("resirai-dictation-start"));

  const rec = new SR();
  recognition = rec;
  rec.lang = "fa-IR";
  rec.continuous = true;
  rec.interimResults = true;

  rec.onstart = () => {
   listening = true;
   lastActivity = Date.now();
   paint(currentBtn, true);
   hint(input, "در حال گوش دادن…");
  };

  rec.onresult = (event) => {
   let interim = "";
   for (let i = event.resultIndex; i < event.results.length; i++) {
    const res = event.results[i];
    if (res.isFinal) appendText(res[0].transcript);
    else interim += res[0].transcript;
   }
   lastActivity = Date.now();
   hint(input, interim ? "می‌شنوم: " + interim.trim() : "در حال گوش دادن…");
  };

  rec.onerror = (e) => {
   if (e.error === "not-allowed" || e.error === "service-not-allowed") {
    hardStop();
    hint(input, "دسترسی به میکروفن داده نشد؛ از نوارِ آدرس مرورگر مجوز بدهید.");
   } else if (e.error === "no-speech") {
    hint(input, "صدایی شنیده نشد… ادامه دهید.");
   } else if (e.error !== "aborted") {
    hint(input, "خطای دیکته: " + e.error);
   }
  };

  // مرورگر بعد از چند ثانیهِ سکوت جلسه را می‌بندد؛ اگر کاربر هنوز حرف می‌زند
  // دوباره وصل می‌شویم تا وسطِ جمله قطع نشود.
  rec.onend = () => {
   if (!listening) { paint(currentBtn, false); return; }
   // شروعِ همزمان با onend در بعضی نسخه‌های کروم خطا می‌دهد ⇒ کمی تأخیر.
   setTimeout(() => {
    if (!listening || recognition !== rec) return;
    try { rec.start(); } catch { listening = false; paint(currentBtn, false); hint(input, "گوش دادن قطع شد — دوباره بزنید"); }
   }, 150);
  };

  try { rec.start(); }
  catch { listening = false; paint(currentBtn, false); hint(input, "گوش دادن شروع نشد؛ دوباره تلاش کنید."); }
 }

 function stop() {
  if (!listening) return;
  listening = false;
  const rec = recognition;
  recognition = null;
  if (rec) { try { rec.stop(); } catch { /* بی‌اثر */ } }
  paint(currentBtn, false);
  hint(currentInput, "متوقف شد — متن را بازبینی کنید");
  currentInput = null;
  currentBtn = null;
 }

 // نگهبان: اگر گوش دادن روی کاغذ فعال باشد ولی ۱۴ ثانیه هیچ فعالیتی نرسد، یعنی
 // جلسهٔ مرورگر بی‌صدا مرده است — قطع می‌کنیم تا کاربر بفهمد و دوباره بزند.
 setInterval(() => {
  if (!listening || !currentInput) return;
  if (Date.now() - lastActivity < 14000) return;
  const el = currentInput;
  stop();
  hint(el, "گوش دادن قطع شد — دوباره بزنید");
 }, 2000);

 // توقف با Esc
 document.addEventListener("keydown", (e) => { if (e.key === "Escape" && listening) stop(); });

 // فرم‌ها هنگامِ باز شدنِ مراجعه ساخته می‌شوند ⇒ دکمه‌ها هم همان‌جا ساخته می‌شوند.
 // MutationObserver با مهلکهٔ کوتاه: کارت‌هایِ تازه (پیش‌نویسِ مراجعه، کارت‌های
 // بازشده) هم میکروفن و ✕ می‌گیرند و کاربر هرگز «فیلدِ بدونِ میکروفن» نمی‌بیند.
 let debounced = null;
 const observer = new MutationObserver(() => {
  if (debounced) return;
  debounced = setTimeout(() => { debounced = null; mount(); }, 120);
  if (listening && currentInput && !document.contains(currentInput)) stop();
 });
 observer.observe(document.body, { childList: true, subtree: true });
 // برای اینکه فرمانِ صوتی بداند دیکته فعال است و ساکت بماند.
 window.ReSiRaiDictation = { isListening: () => listening, remount: mount };
 mount();
})();
