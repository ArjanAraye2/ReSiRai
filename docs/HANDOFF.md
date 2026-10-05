# تحویلِ کار به سشنِ تازه (آخرین به‌روزرسانی: ۱۴۰۵/۰۷/۱۵)

## وضعیتِ آماده و push‌شده
- **بخش‌های مراجعه**: `tblStudySections` + API + پنلِ تیک‌محور داخلِ فرمِ **واحد** (ادغامِ «مراجعه جدید» و «ویرایش» در یک فرم؛ `studyFormMode` = new/view/edit) — کامیت `280243b`.
- **شمای دندان مخفی** (`display:none`، کد پابرجاست) و **۱۳ فیلدِ اضافهِ بخش‌ها پشتِ پرچم** `SHOW_EXTRA_FIELDS=false` در `study-sections.js`.
- **تخصص‌ها**: `tblSpecialties` = **۱۳۰ ردیف** (۵۶ فوق‌تخصص؛ پزشکی عمومی، دندان، روان و …) — seed: `Database/20261008_*.sql` و `20261009_*.sql`.
- **نوعِ مراجعه**: جدولِ ربطِ `tblStudyTypeSpecialties` (**۱۱۰۴ ربط، ۱۹۵ نوع**) + فیلترِ `GET /api/studytypes?specialtyID=` (بدون پارامتر = رفتارِ قبلی) + **autocomplete** (`wwwroot/js/study-type-ui.js`) + «سایر» با فیلدِ `studyTypeNote` — کامیت `66740fe`. مرجعِ محتوا: `docs/design/visit-types.md`.
- **بارداری/شیردهی فقط برایِ زن — سه لایه** (۱۴۰۵/۰۷/۱۵): سطرِ پرونده در `index.html` **مخفیِ پیش‌فرض** است و فقط با جنسیتِ «زن» (۲) باز می‌شود (پس مرد/جنسیتِ ناشناخته/کلاینتِ کهنه آن را نمی‌بینند)؛ خروجیِ چاپ هم فقط برایِ زن سطر را دارد (`js/app.js`)؛ و سرور `HIST.PREG` را از `definitions` برایِ بیمارِ مرد حذف می‌کند و `pregnancyStatus` را برنمی‌گرداند (`ClinicalFactorsController` / `PatientsController`). نگهبان‌ها: `tests/ui-smoke/smoke11.html` (۹ چک) + ۵ تست در `ReSiRai.Tests/ClinicalFactorsControllerTests.cs`.
- **دو باگِ پیداشده و رفع‌شده در همین کار**: (۱) `factors-ui.js` می‌نوشت `input.list = …` که در strict mode استثنا می‌دهد و **کلِ پنلِ «شرایط فعلی» را می‌شکست** — حالا `setAttribute("list", …)` است؛ (۲) `smoke2` از `file:///D:/Application/DentalRay/...` بارگذاری می‌شد (مسیری که دیگر نیست) یعنی مدتهاست واقعاً آزموده نمی‌شد — حالا از کپیِ تازه بارگذاری می‌کند و verdict را رویِ عنوانِ سند می‌گذارد.
- **آزمون‌ها**: ۷۲ تست سبز + دودهای `tests/ui-smoke` (smoke2 تا smoke11 همه PASS).
- دانشنامهٔ طراحی: `docs/design-principles.md` · `docs/lab-tests-model.md` · `docs/design/gp-sections.md` · `docs/design/gp-visit-proto.html` (نمونهٔ تیک‌محور).

## مانده‌ها
1. **ری‌استارتِ VS + Ctrl+F5** برایِ دیدنِ API/UI جدید (اپ با باینریِ قدیمی اجراست) و **تستِ پذیرش** توسطِ کاربر — تغییرِ **سرور** (حذفِ `HIST.PREG` از definitions و خاموش‌شدنِ نمای بارداری) تا ری‌استارت اعمال نمی‌شود؛ تغییراتِ `wwwroot` همین حالا هم از سرور سرو می‌شوند.
2. سطرِ «بارداری/شیردهی» برایِ بیمارِ مرد: علتِ دیده‌شدنِ قبلی قطعی پیدا نشد — کدِ فعلی در هر سه لایه درست است و حالا نگهبان دارد؛ اگر کاربر دوباره دید، اول `Ctrl+F5` و بعد کنسولِ مرورگر را ببینیم.
3. گفت‌وگویِ بازِ طراحی: نمایِ مراجعه (خلاصه در برابر فرم)، معنای «گزارش» در برابر «توضیحات»، آمارِ ساعتِ شروع/پایان، دستیارِ حاضر.

## قواعدِ کار این پروژه (مهم)
- پاسخ‌ها فارسی و کوتاه؛ **توافق ← اجرا ← commit+push** با پیامِ فارسی.
- بیلد: `dotnet build ReSiRai.Api\ReSiRai.Api.csproj -c Debug --nologo -t:Compile` (صفر خطا). **هرگز exe نساز و پروسهٔ `ReSiRai.Api` را نکُش** (قفل است).
- تست با خروجِ جدا: `dotnet build ReSiRai.Tests -p:OutputPath=%LOCALAPPDATA%\Temp\opencode\resirai-tb\` سپس `dotnet test --no-build -p:همان‌مسیر`. **`tests\verify.ps1` همین کار را می‌کند** (بخشِ unit tests خروجیِ جدا می‌گیرد تا exeِ در حالِ اجرا قفل نشود) و خلاصهٔ سبزش `BUILD + TESTS GREEN` است. اگر `verify.ps1` خطایِ parse داد، فایل باید **UTF-8 with BOM** باشد.
- مهاجرت/seed فقط با `sqlcmd -S ".\ARJANARAYE" -d ReSiRai -W -f 65001 -i <file>`؛ فقط فایل‌های `Database/*.sql` نسخه‌بندی‌شده؛ **دادهٔ بیماری تغییر نکند**.
- هر تغییرِ wwwroot به `bin\Debug\net10.0\wwwroot` کپی شود؛ نسخهٔ `?v=` (الان `app.js` و `factors-ui.js` = `20261007.3`) یک پله بالا.
- دودِ UI: `tests/verify.ps1` (کپیِ تازه به `tests/ui-smoke`) + `tests/ui-smoke/serve.ps1` سپس عنوانِ هر `smokeN.html` باید `SMOKE-N-PASS` باشد (هر باگِ UI یک نگهبان دارد).
- اصولِ UX همیشگی: `docs/design-principles.md` (کمترین کلیک/اسکرول، بازشونده‌ها، دیکته، لغوِ انتخاب، «هیچکدام» آخر).

## پیشنهادِ سرعت
هر مورد = شروعِ فوری ← اجرا در همان پاسخ ← گزارشِ کوتاه؛ بدونِ سلسله‌سؤال مگر تصمیمِ واقعاً مالِ کاربر باشد. (این سشن به دلیلِ حجمِ زیاد کند و دچارِ خطایِ ارائه‌دهنده شد.)
