# چک‌لیست امنیتی ReSiRai

> این فایل «قاعدهٔ کار» است: هر تغییر/قابلیت جدید باید با این چک‌لیست سنجیده شود.
> وضعیت فعلی: استقرار تک‌سروری (docker + nginx)؛ دادهٔ واقعی هنوز وارد نشده است.

## قاعده‌های ثابت (همیشه)
- **ورود پیش‌فرض است**: هر endpoint تازه بدون `[AllowAnonymous]` محافظت می‌شود؛ عمومی‌کردن فقط با دلیل مشخص و بازبینی.
- **هیچ راز/رمز/کلیدی در ریپو کامیت نشود** (connection string، ApiKey، هش رمز). کانفیگ از `ProgramData\ReSiRai\ReSiRai.config.json` یا `ReSiRaiConfig` خوانده می‌شود.
- **خطا به کاربر کلی باشد**؛ جزئیات (`ex.Message`، stack، نام سرور) فقط در لاگ.
- **مالکیت داده چک شود**: هر endpoint که `studyId/patientId/imageId` می‌گیرد باید با `StudyAccessService` (یا معادلش) دسترسی را بسنجد — نه فقط «لاگین بودن».
- **توکن‌های عمومی** (لینک اشتراک، QR دریافت بیمار، جفت‌سازی گوشی): آنتروپی کافی + انقضا + محدودیت استفاده/ابطال.

## قبل از هر انتشار
1. `dotnet build ReSiRai.Api -c Release` و `dotnet test ReSiRai.Tests -c Release` — بدون خطا.
2. **آسیب‌پذیری پکیج‌ها**: هیچ هشدار `NU1902/NU1903` در بیلد نباشد؛ نسخهٔ وصله‌شده pin شود.
3. **Security Headers** در پاسخ‌ها: `Strict-Transport-Security`، `Content-Security-Policy`، `X-Content-Type-Options: nosniff`، `X-Frame-Options`/`frame-ancestors`، `Referrer-Policy`.
4. **Anti-CSRF** برای `POST/PUT/PATCH/DELETE` (چون احراز هویت کوکی است) — علاوه بر `SameSite=Lax`.
5. **آپلود**: محدودیت حجم/تعداد/نوع فایل؛ پردازش PDF/تصویر در مسیر امن و با محدودیت حافظه (nginx `client_max_body_size` هم پایین بیاید).
6. **rate limit ورود به‌ازای هر IP**؛ پشت nginx باید `UseForwardedHeaders` فعال و `X-Forwarded-For` ست شده باشد.
7. **کانتینر non-root** (کاربر `app` در ایمیج aspnet) + دسترسی درست به volumeها.
8. **لاگ رویدادهای حساس**: ورود ناموفق، قفل شدن، تغییر رمز، عملیات ادمین.
9. بازبینی سریع مسیرهای عمومی و شناسه‌محور (IDOR) و XSS در قالب‌های گزارش/دیکته.

## تغییرات اسکیما
- برای تغییرات جدید از **مهاجرت/اسکریپت نسخه‌دار** استفاده شود؛ `EnsureCreated` فقط برای نصب اولیه است.
- از `try { ... } catch { }` دور دستورات اسکیما استفاده نشود؛ خطا باید لاگ شود.

## استقرار (روال فعلی)
1. `dotnet publish ReSiRai.Api/ReSiRai.Api.csproj -c Release -o _deploy/publish`
2. ساخت ایمیج با تگ تاریخ: `docker build -t resirai:YYYYMMDD _deploy`
3. به‌روزرسانی `~/reSirai/docker-compose.yml` (با بکاپ) و `docker compose up -d`
4. بررسی: سایت ۲۰۰، `docker logs` بدون خطا، یک ورود آزمایشی، و ثبت **IP واقعی** در `tblAppEvents`.
