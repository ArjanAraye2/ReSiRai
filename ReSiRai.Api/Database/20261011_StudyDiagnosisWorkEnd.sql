-- ReSiRai — فیلدهایِ مراجعه بر اساسِ توافقِ ۱۴۰۵/۰۷/۱۶ (فازِ پزشکِ عمومی):
--   ۱) «گزارش» ← «تشخیص»: فقط نامِ ستون عوض می‌شود؛ داده جابه‌جا یا حذف نمی‌شود
--      (۶ مراجعه، همه خالی — و اگر بعداً پُر شده باشد sp_rename آن را نگه می‌دارد).
--   ۲) «پایانِ کار»: ستونِ زمانِ پایانِ کار، اختیاری؛ مدتِ کار = WorkEndDate − StudyDate.
--
-- اجرای اجباری با sqlcmd (طبق قواعدِ پروژه):
--   sqlcmd -S ".\ARJANARAYE" -d ReSiRai -W -f 65001 -i 20261011_StudyDiagnosisWorkEnd.sql
--
-- نکته: کدِ قدیمی ستونِ Report را می‌خواند؛ باید بلافاصله بعد از این فایل،
-- اپ ری‌استارت شود تا باینریِ تازه (Diagnosis) جایگزین شود.

IF COL_LENGTH('dbo.tblRadiologyStudies', 'Report') IS NOT NULL
   AND COL_LENGTH('dbo.tblRadiologyStudies', 'Diagnosis') IS NULL
    EXEC sp_rename 'dbo.tblRadiologyStudies.Report', 'Diagnosis', 'COLUMN';

IF COL_LENGTH('dbo.tblRadiologyStudies', 'WorkEndDate') IS NULL
    ALTER TABLE dbo.tblRadiologyStudies ADD WorkEndDate DATETIME NULL;
