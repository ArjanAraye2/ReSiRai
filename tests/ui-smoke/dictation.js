// دیکتهٔ فیلدهای متنیِ مراجعه: ناحیه، توضیحات، گزارش (در فرمِ جدید و ویرایش)
// و شرحِ اقدام. بدونِ واژهٔ بیداری؛ هر جملهٔ قطعی به فیلد اضافه می‌شود و چیزی
// خودکار ثبت نمی‌شود — کاربر متن را بازبینی و خودش ذخیره می‌کند.
(() => {
 "use strict";

 const TARGET_IDS = [
  // فرمِ مراجعهٔ جدید
  "factorsQuickSearch",
   "newBodyPart", "newStudyDescription", "newStudyReport",
  // صفحهٔ جزئیات/ویرایشِ مراجعه
  "studyDetailsBodyPart", "studyDetailsDescription", "studyDetailsReport"
 ];
 const ACTION_DESC = '.study-actions-form input[type="text"]'; // placeholder در حالتِ بازپرداخت عوض می‌شود

 let recognition = null;
 let listening = false;
 let currentInput = null;
 let currentBtn = null;
 let lastActivity = 0;

 // فهرستِ فیلدهای در دسترس (هر بار ساخته می‌شود چون فرم‌ها بعداً ظاهر می‌شوند)
 function targets() {
  const list = [];
  for (const id of TARGET_IDS) {
   const el = document.getElementById(id);
   if (el) list.push(el);
  }
  const action = document.querySelector(ACTION_DESC);
  if (action) {
   if (!action.id) action.id = "actionDescInput"; // برای پیدا کردنِ نشانگر
   list.push(action);
  }
  return list;
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

 // دکمه داخلِ خودِ فیلد پیچیده می‌شود تا چیدمانِ فرم به‌هم نریزد.
 function mount() {
  for (const el of targets()) {
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

   const hintEl = document.createElement("span");
   hintEl.className = "dictate-hint";

   wrap.appendChild(btn);
   wrap.appendChild(hintEl);
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
 const observer = new MutationObserver(() => {
  mount();
  if (listening && currentInput && !document.contains(currentInput)) stop();
 });
 observer.observe(document.body, { childList: true, subtree: true });
 // برای اینکه فرمانِ صوتی بداند دیکته فعال است و ساکت بماند.
 window.ReSiRaiDictation = { isListening: () => listening };
 mount();
})();
