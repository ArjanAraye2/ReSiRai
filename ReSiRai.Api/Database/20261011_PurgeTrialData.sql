-- ReSiRai — پاک‌سازیِ کاملِ دادهٔ آزمایشیِ مطب (بیمارها، مراجعات، تصاویر، مالی، پیام‌ها...)
-- فقط جداولِ پایه دست نمی‌خورند: تخصص‌ها، نوعِ مراجعه و ربطش، فاکتورها و ربط به تخصص،
-- مرحلهٔ انتظار، بیمه، نوعِ تصویر، تنظیمات POS، کاربران (خالی)، پرسنل (خالی)، مطب.
-- اجرا: sqlcmd -S ".\ARJANARAYE" -d ReSiRai -W -f 65001 -i 20261011_PurgeTrialData.sql
-- همراهش: فایل‌های دیسکی (تصاویر/پروفایل در D:\ReSiRaiData) هم پاک می‌شوند.

SET NOCOUNT ON;

-- ۱۴۰۵/۰۷/۱۶: رکوردهای واگذارشده به بیرون (لینک/توکن) هم حذف می‌شوند
-- تا لینکِ صادرشده به دادهٔ خالی برخورد نکند.
DELETE FROM tblStudyShareLinks;
DELETE FROM tblReceiveTokens;

DELETE FROM tblRadiologyStudyImages;
DELETE FROM tblLabReportExtractions;
DELETE FROM tblAIImageAnalyses;
DELETE FROM tblStudyFactorValues;
DELETE FROM tblStudySections;
DELETE FROM tblStudyActions;
DELETE FROM tblStudyPayments;
DELETE FROM tblPatientMessages;
DELETE FROM tblInboxMessages;
DELETE FROM tblAppointments;
DELETE FROM tblPairedDevices;
DELETE FROM tblRadiologyStudyTeeth;

-- تصاویر: پوشهٔ بیماران در دیسک (D:\ReSiRaiData) پاک می‌شود — نه جداولِ پایه.
DELETE im FROM tblRadiologyImages im WHERE 1=1;

-- مراجعات و پرونده‌ها
DELETE FROM tblRadiologyStudies;
DELETE FROM tblPatients;

-- رویدادهای ثبت‌شده هم آزمایشی‌اند
DELETE FROM tblAppEvents;

-- هویت‌سازِ پرونده و مراجعه از ۱ شروع شود تا عددِ رکوردهای واقعی هم از اول شروع شود
IF EXISTS (SELECT 1 FROM sys.identity_columns WHERE object_id = OBJECT_ID('dbo.tblPatients') AND last_value IS NOT NULL)
    DBCC CHECKIDENT ('dbo.tblPatients', RESEED, 0);
IF EXISTS (SELECT 1 FROM sys.identity_columns WHERE object_id = OBJECT_ID('dbo.tblRadiologyStudies') AND last_value IS NOT NULL)
    DBCC CHECKIDENT ('dbo.tblRadiologyStudies', RESEED, 0);
