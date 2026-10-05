/*
 20261010_StudyTypeSpecialties.sql - «نوعِ مراجعه» بر پایهٔ تخصصِ پزشکِ مطب

 Purpose:
   The visit form must offer only the reasons for visiting that belong to the
   specialty of the doctor who owns the visit, always with the cross-specialty
   rows (مشترک‌ها) and always with «سایر» last. «سایر» carries a free text, so
   the visit also needs StudyTypeNote.
   Content source: docs/design/visit-types.md (9 specialties + shared rows).

 Tables:
   tblStudyTypeSpecialties   StudyType <-> Specialty (many-to-many, both FKs CASCADE)
   tblRadiologyStudies.StudyTypeNote   the free text written for «سایر»

 Rules:
   - Every statement is idempotent: re-running the file changes nothing.
   - Names are the contract. StudyTypeID/SpecialtyID are IDENTITY, so rows are
     resolved by exact name (N'...') exactly as they are stored in the lookup
     tables; a pair whose specialty name does not exist is reported at the end
     instead of being silently dropped.
   - The shared rows (a) + «سایر» (b) are bound to ALL 130 specialties, the
     dental rows (c) to their dental specialty and the 9 specialties of the
     design document (d) to their own specialty. Shared rows are never bound
     twice: they already belong to every specialty.

 Usage:
   sqlcmd -S <server> -d ReSiRai -W -f 65001 -i 20261010_StudyTypeSpecialties.sql
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

/* =========================
   1. Relation table
   ========================= */
IF OBJECT_ID(N'dbo.tblStudyTypeSpecialties', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.tblStudyTypeSpecialties(
        -- tblStudyTypes.StudyTypeID is INT IDENTITY, so the link keeps INT.
        StudyTypeID INT NOT NULL,
        SpecialtyID INT NOT NULL,
        CONSTRAINT PK_tblStudyTypeSpecialties PRIMARY KEY(StudyTypeID, SpecialtyID),
        -- Deleting a lookup row must not leave orphan links behind.
        CONSTRAINT FK_tblStudyTypeSpecialties_StudyTypes FOREIGN KEY(StudyTypeID)
            REFERENCES dbo.tblStudyTypes(StudyTypeID) ON DELETE CASCADE,
        CONSTRAINT FK_tblStudyTypeSpecialties_Specialties FOREIGN KEY(SpecialtyID)
            REFERENCES dbo.tblSpecialties(SpecialtyID) ON DELETE CASCADE
    );
END;
GO

/* =========================
   2. Note of the «سایر» row
   ========================= */
IF COL_LENGTH(N'dbo.tblRadiologyStudies', N'StudyTypeNote') IS NULL
    ALTER TABLE dbo.tblRadiologyStudies ADD StudyTypeNote NVARCHAR(500) NULL;
GO

/* =========================
   3. Seeds
   ========================= */
BEGIN TRANSACTION;

/* --- 3a. بین‌رشته‌ای‌ها (مشترک‌ها) + «سایر» → همهٔ تخصص‌ها -------------------
      «سایر» ردیف ۳۸ است و از قبل می‌آید؛ بقیه اگر نبودند ساخته می شوند. */
INSERT INTO dbo.tblStudyTypes(StudyTypeName, IsActive)
SELECT v.StudyTypeName, 1
FROM (VALUES
    (N'ویزیت/معاینه'),
    (N'پیگیری'),
    (N'تفسیر آزمایش'),
    (N'تفسیر تصویر'),
    (N'ارجاع'),
    (N'اورژانس/فوریت')
) AS v(StudyTypeName)
WHERE NOT EXISTS (SELECT 1 FROM dbo.tblStudyTypes t WHERE t.StudyTypeName = v.StudyTypeName);

INSERT INTO dbo.tblStudyTypeSpecialties(StudyTypeID, SpecialtyID)
SELECT t.StudyTypeID, s.SpecialtyID
FROM dbo.tblStudyTypes t
CROSS JOIN dbo.tblSpecialties s
WHERE t.StudyTypeName IN (N'ویزیت/معاینه', N'پیگیری', N'تفسیر آزمایش', N'تفسیر تصویر',
                          N'ارجاع', N'اورژانس/فوریت', N'سایر')
  AND NOT EXISTS (SELECT 1 FROM dbo.tblStudyTypeSpecialties x
                  WHERE x.StudyTypeID = t.StudyTypeID AND x.SpecialtyID = s.SpecialtyID);

/* --- 3b. چهار ردیفِ دندانیِ جامانده از مرجع (دندانپزشک عمومی) -------------- */
INSERT INTO dbo.tblStudyTypes(StudyTypeName, IsActive)
SELECT v.StudyTypeName, 1
FROM (VALUES
    (N'چکاب/معاینهٔ دوره‌ای'),
    (N'مراقبت اورژانس دندان (درد)'),
    (N'بلیچینگ/زیبایی'),
    (N'رادیوگرافی/OPG')
) AS v(StudyTypeName)
WHERE NOT EXISTS (SELECT 1 FROM dbo.tblStudyTypes t WHERE t.StudyTypeName = v.StudyTypeName);

/* --- 3c + 3d. نگاشتِ (تخصص ← نوعِ مراجعه) --------------------------------
      نامِ تخصص باید دقیقاً مثل tblSpecialties باشد؛ نامِ نوع یکتا نگه داشته
      می شود (یک ردیف، چند تخصص). ردیف‌هایِ مشترکِ 3a دوباره اینجا نمی آیند. */
DECLARE @pairs TABLE(SpecialtyName NVARCHAR(300) NOT NULL, StudyTypeName NVARCHAR(300) NOT NULL);
INSERT INTO @pairs(SpecialtyName, StudyTypeName) VALUES
/* ---- دندانپزشکی: نگاشتِ هوشمندِ ۳۰ نوعِ موجود ---- */
(N'ارتودنسی', N'ارتودنسی'),
(N'اندودانتیکس (درمان ریشه)', N'عصب‌کشی'),
(N'اندودانتیکس (درمان ریشه)', N'درمان مجدد ریشه'),
(N'پریودانتیکس (بیماری‌های لثه)', N'جرم‌گیری'),
(N'پریودانتیکس (بیماری‌های لثه)', N'بروساژ'),
(N'پریودانتیکس (بیماری‌های لثه)', N'درمان لثه'),
(N'پریودانتیکس (بیماری‌های لثه)', N'جراحی لثه'),
(N'پروتزهای دندانی', N'روکش'),
(N'پروتزهای دندانی', N'بریج'),
(N'پروتزهای دندانی', N'ونیر / لمینت'),
(N'پروتزهای دندانی', N'پروتز متحرک'),
(N'پروتزهای دندانی', N'پروتز کامل'),
(N'پروتزهای دندانی', N'تنظیم یا تعمیر پروتز'),
(N'ایمپلنتولوژی (ایمپلنت)', N'ایمپلنت'),
(N'ایمپلنتولوژی (ایمپلنت)', N'پیوند استخوان'),
(N'ایمپلنتولوژی (ایمپلنت)', N'سینوس لیفت'),
(N'دندانپزشکی کودکان', N'درمان دندان شیری'),
(N'جراحی دهان، فک و صورت', N'جراحی دهان و فک'),
/* بقیهٔ ردیف‌های دندانی + چهار ردیفِ تازه → دندانپزشک عمومی */
(N'دندانپزشک عمومی', N'تعیین نشده'),
(N'دندانپزشک عمومی', N'معاینه و تشخیص'),
(N'دندانپزشک عمومی', N'مشاوره درمان'),
(N'دندانپزشک عمومی', N'پرکردن دندان'),
(N'دندانپزشک عمومی', N'ترمیم کامپوزیت'),
(N'دندانپزشک عمومی', N'کشیدن دندان'),
(N'دندانپزشک عمومی', N'کشیدن دندان عقل'),
(N'دندانپزشک عمومی', N'جراحی دندان عقل'),
(N'دندانپزشک عمومی', N'پالپوتومی'),
(N'دندانپزشک عمومی', N'فیشور سیلانت'),
(N'دندانپزشک عمومی', N'فلورایدتراپی'),
(N'دندانپزشک عمومی', N'چکاب/معاینهٔ دوره‌ای'),
(N'دندانپزشک عمومی', N'مراقبت اورژانس دندان (درد)'),
(N'دندانپزشک عمومی', N'بلیچینگ/زیبایی'),
(N'دندانپزشک عمومی', N'رادیوگرافی/OPG'),

/* ---- پزشک عمومی ---- */
(N'پزشکی عمومی', N'ویزیت/معاینهٔ عمومی'),
(N'پزشکی عمومی', N'پیگیری وضعیت'),
(N'پزشکی عمومی', N'شکایت حاد (تب/سرفه/درد)'),
(N'پزشکی عمومی', N'بررسی درد'),
(N'پزشکی عمومی', N'سرگیجه/سنکوپ'),
(N'پزشکی عمومی', N'مشکل گوارشی'),
(N'پزشکی عمومی', N'بررسی فشارخون'),
(N'پزشکی عمومی', N'بررسی قند/دیابت'),
(N'پزشکی عمومی', N'پیگیری بیماری مزمن'),
(N'پزشکی عمومی', N'ارزیابی سبک زندگی/تغذیه'),
(N'پزشکی عمومی', N'تفسیر تصویر/گزارش'),
(N'پزشکی عمومی', N'چکاب/غربالگری'),
(N'پزشکی عمومی', N'تجویز/تمدید نسخه'),
(N'پزشکی عمومی', N'تزریق/سرّم/پانسمان'),
(N'پزشکی عمومی', N'واکسیناسیون'),
(N'پزشکی عمومی', N'درمان زخم/بخیه'),
(N'پزشکی عمومی', N'ترک سیگار/اعتیاد'),
(N'پزشکی عمومی', N'مراقبت سالمند'),
(N'پزشکی عمومی', N'مراقبت کودک'),
(N'پزشکی عمومی', N'سلامت روان (غربالگری/ارجاع)'),
(N'پزشکی عمومی', N'ارجاع به متخصص'),
(N'پزشکی عمومی', N'اورژانس/اقدام فوری'),

/* ---- روان‌پزشکی ---- */
(N'روانپزشکی', N'ویزیت/تنظیم دارو'),
(N'روانپزشکی', N'ارزیابی اثربخشی'),
(N'روانپزشکی', N'عوارض دارویی'),
(N'روانپزشکی', N'ارزیابی اولیه'),
(N'روانپزشکی', N'پیگیری علائم'),
(N'روانپزشکی', N'مصاحبه تشخیصی'),
(N'روانپزشکی', N'تست/پرسشنامه'),
(N'روانپزشکی', N'روان‌درمانی/مشاوره'),
(N'روانپزشکی', N'خانواده‌درمانی'),
(N'روانپزشکی', N'درمان اضطراب/افسردگی'),
(N'روانپزشکی', N'مداخله بحران'),
(N'روانپزشکی', N'ارزیابی خطر (خودکشی/خشونت)'),
/* سه ردیفِ بخشِ «اعتیاد»: نامِ خالیِ «ارزیابی» برایِ فهرستِ تخت یکتا نیست. */
(N'روانپزشکی', N'ارزیابی اعتیاد'),
(N'روانپزشکی', N'درمان/کاهش آسیب'),
(N'روانپزشکی', N'ترک'),
(N'روانپزشکی', N'ارزیابی تکامل'),
(N'روانپزشکی', N'اختلالات یادگیری/رفتاری'),
(N'روانپزشکی', N'ارزیابی شغلی/اجتماعی'),
(N'روانپزشکی', N'بازگشت به کار'),
(N'روانپزشکی', N'ارجاع به روان‌شناسی/طب قانونی'),

/* ---- اطفال ---- */
(N'اطفال', N'چکاب رشد'),
(N'اطفال', N'واکسیناسیون'),
(N'اطفال', N'غربالگری شنوایی/بینایی'),
(N'اطفال', N'تب/عفونت تنفسی'),
(N'اطفال', N'اسهال/استفراغ'),
(N'اطفال', N'بثورات'),
(N'اطفال', N'درد گوش/گلو'),
(N'اطفال', N'آسم'),
(N'اطفال', N'آلرژی/اگزما'),
(N'اطفال', N'صرع'),
(N'اطفال', N'چاقی'),
(N'اطفال', N'تأخیر رشد'),
(N'اطفال', N'گفتار'),
(N'اطفال', N'ADHD/رفتار'),
(N'اطفال', N'کم‌وزنی'),
(N'اطفال', N'کمبود ویتامین'),
(N'اطفال', N'زردی'),
(N'اطفال', N'تغذیه با شیر مادر'),
(N'اطفال', N'واکسن نوزاد'),
(N'اطفال', N'تنفسی حاد'),
(N'اطفال', N'تشنج'),

/* ---- زنان و زایمان ---- */
(N'زنان و زایمان', N'چکاب/پاپ‌اسمیر'),
(N'زنان و زایمان', N'ماموگرافی'),
(N'زنان و زایمان', N'پیگیری بارداری'),
(N'زنان و زایمان', N'سونوگرافی'),
(N'زنان و زایمان', N'آزمایشات بارداری'),
(N'زنان و زایمان', N'مراقبت پیش از زایمان'),
(N'زنان و زایمان', N'عوارض (تهوع/فشار/قند)'),
(N'زنان و زایمان', N'زایمان'),
(N'زنان و زایمان', N'پیگیری پس از زایمان'),
(N'زنان و زایمان', N'مشاوره نازایی'),
(N'زنان و زایمان', N'IVF/کمک‌باروری'),
(N'زنان و زایمان', N'قاعدگی'),
(N'زنان و زایمان', N'اختلال هورمونی'),
(N'زنان و زایمان', N'یائسگی'),
(N'زنان و زایمان', N'عفونت'),
(N'زنان و زایمان', N'میوم/کیست'),
(N'زنان و زایمان', N'جراحی زنان'),
(N'زنان و زایمان', N'پیگیری سرطان/شیمی‌درمانی'),

/* ---- قلب و عروق ---- */
(N'بیماری‌های قلب و عروق', N'ویزیت قلب'),
(N'بیماری‌های قلب و عروق', N'درد سینه'),
(N'بیماری‌های قلب و عروق', N'تنگی نفس'),
(N'بیماری‌های قلب و عروق', N'فشارخون'),
(N'بیماری‌های قلب و عروق', N'آریتمی'),
(N'بیماری‌های قلب و عروق', N'بعد از استنت/عمل'),
(N'بیماری‌های قلب و عروق', N'نوار قلب'),
(N'بیماری‌های قلب و عروق', N'هولتر'),
(N'بیماری‌های قلب و عروق', N'اکو'),
(N'بیماری‌های قلب و عروق', N'تست ورزش'),
(N'بیماری‌های قلب و عروق', N'تنظیم دارو'),
(N'بیماری‌های قلب و عروق', N'پیگیری ضدانعقاد (وارفارین)'),
(N'بیماری‌های قلب و عروق', N'چکاب قلب'),
(N'بیماری‌های قلب و عروق', N'عوامل خطر'),
(N'بیماری‌های قلب و عروق', N'درد سینهٔ حاد'),

/* ---- چشم ---- */
(N'چشم', N'معاینه چشم'),
(N'چشم', N'تجویز عینک/لنز'),
(N'چشم', N'پیگیری نمره'),
(N'چشم', N'آب مروارید'),
(N'چشم', N'گلوکوم'),
(N'چشم', N'خشکی چشم'),
(N'چشم', N'التهاب/قرمزی'),
(N'چشم', N'شبکیه (دیابت/پارگی)'),
(N'چشم', N'لیزر'),
(N'چشم', N'تزریق داخل‌چشم'),
(N'چشم', N'جراحی'),
(N'چشم', N'جسم خارجی'),
(N'چشم', N'آسیب شیمیایی'),
(N'چشم', N'کاهش ناگهانی دید'),
(N'چشم', N'غربالگری تنبلی چشم'),

/* ---- پوست و مو ---- */
(N'پوست و مو', N'معاینه پوست'),
(N'پوست و مو', N'ارزیابی خال/ضایعه'),
(N'پوست و مو', N'درماتوسکوپی'),
(N'پوست و مو', N'جوش/آکنه'),
(N'پوست و مو', N'اگزما/درماتیت'),
(N'پوست و مو', N'قارچ'),
(N'پوست و مو', N'پسوریازیس'),
(N'پوست و مو', N'ریزش مو'),
(N'پوست و مو', N'ویتیلیگو'),
(N'پوست و مو', N'لیزر'),
(N'پوست و مو', N'تزریق (ژل/بوتاکس)'),
(N'پوست و مو', N'جراحی/بیوپسی/برداشتن خال'),
(N'پوست و مو', N'دارودرمانی'),
(N'پوست و مو', N'جوان‌سازی'),
(N'پوست و مو', N'لیزر موهای زائد'),
(N'پوست و مو', N'پیگیری درمان'),
(N'پوست و مو', N'عوارض'),

/* ---- ارتوپدی ---- */
(N'ارتوپدی', N'شکستگی'),
(N'ارتوپدی', N'دررفتگی'),
(N'ارتوپدی', N'پیچ‌خوردگی'),
(N'ارتوپدی', N'آسیب رباط/منیسک'),
(N'ارتوپدی', N'درد کمر/گردن'),
(N'ارتوپدی', N'آرتروز'),
(N'ارتوپدی', N'التهاب مفاصل'),
(N'ارتوپدی', N'آسیب تکرارشونده'),
(N'ارتوپدی', N'بورسیت'),
(N'ارتوپدی', N'معاینه'),
(N'ارتوپدی', N'دامنه حرکت'),
(N'ارتوپدی', N'رادیوگرافی/MRI'),
(N'ارتوپدی', N'گچ/بیسکوپ'),
(N'ارتوپدی', N'فیزیوتراپی/توانبخشی'),
(N'ارتوپدی', N'جراحی (آرتروسکوپی/تعویض مفصل)'),
(N'ارتوپدی', N'بعد از عمل'),
(N'ارتوپدی', N'شکستگی در حال ترمیم'),
(N'ارتوپدی', N'بازگشت به فعالیت'),

/* ---- داخلی (بیماری‌های داخلی) ---- */
(N'بیماری‌های داخلی', N'ویزیت داخلی'),
(N'بیماری‌های داخلی', N'پیگیری بیماری مزمن'),
(N'بیماری‌های داخلی', N'چکاب دوره‌ای'),
(N'بیماری‌های داخلی', N'فشارخون'),
(N'بیماری‌های داخلی', N'چربی'),
(N'بیماری‌های داخلی', N'سوءهاضمه/ریفلاکس'),
(N'بیماری‌های داخلی', N'کبد'),
(N'بیماری‌های داخلی', N'تیروئید'),
(N'بیماری‌های داخلی', N'دیابت/چاقی'),
(N'بیماری‌های داخلی', N'کم‌خونی'),
(N'بیماری‌های داخلی', N'تنفسی (آسم/COPD)'),
(N'بیماری‌های داخلی', N'تفسیر گزارش'),
(N'بیماری‌های داخلی', N'تب نامعلوم'),
(N'بیماری‌های داخلی', N'عفونت'),
(N'بیماری‌های داخلی', N'ارجاع به متخصص');

/* نوعِ نبوده را می‌سازد (IsActive=1)؛ ردیفِ موجود همان است که هست. */
INSERT INTO dbo.tblStudyTypes(StudyTypeName, IsActive)
SELECT DISTINCT p.StudyTypeName, 1
FROM @pairs p
WHERE NOT EXISTS (SELECT 1 FROM dbo.tblStudyTypes t WHERE t.StudyTypeName = p.StudyTypeName);

/* ربطِ (نوع، تخصص) — هر جفت دفعهٔ دوم ردیفِ تکراری نمی‌سازد. */
INSERT INTO dbo.tblStudyTypeSpecialties(StudyTypeID, SpecialtyID)
SELECT DISTINCT t.StudyTypeID, s.SpecialtyID
FROM @pairs p
JOIN dbo.tblSpecialties s ON s.SpecialtyName = p.SpecialtyName
JOIN dbo.tblStudyTypes  t ON t.StudyTypeName = p.StudyTypeName
WHERE NOT EXISTS (SELECT 1 FROM dbo.tblStudyTypeSpecialties x
                  WHERE x.StudyTypeID = t.StudyTypeID AND x.SpecialtyID = s.SpecialtyID);

/* نگهبانِ نام: هیچ جفتی نباید بی‌تخصص بماند (فایلِ UTF-8 بدونِ -f 65001
   دقیقاً همین را بی‌صدا می‌سازد). */
IF EXISTS (SELECT 1 FROM @pairs p
           WHERE NOT EXISTS (SELECT 1 FROM dbo.tblSpecialties s WHERE s.SpecialtyName = p.SpecialtyName))
BEGIN
    SELECT p.SpecialtyName, p.StudyTypeName AS MissingSpecialty
    FROM @pairs p
    WHERE NOT EXISTS (SELECT 1 FROM dbo.tblSpecialties s WHERE s.SpecialtyName = p.SpecialtyName);
END;

COMMIT;
GO

/* گزارشِ اجرا: ردیفِ ساخته‌شده در هر دو جدول. */
SELECT 'tblStudyTypes' AS TableName, COUNT(*) AS Rows FROM dbo.tblStudyTypes
UNION ALL
SELECT 'tblStudyTypeSpecialties', COUNT(*) FROM dbo.tblStudyTypeSpecialties;

PRINT N'20261010_StudyTypeSpecialties: relation + StudyTypeNote + seeds created.';
GO
