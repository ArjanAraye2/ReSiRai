SELECT count(*) AS insurance_rows FROM "tblInsuranceTypes";
SELECT ImageTypeName FROM "tblImageTypes" WHERE "ImageTypeName"='کارت سابقه';
SELECT count(*) AS app_events FROM "tblAppEvents";
SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname LIKE 'UX_%' OR indexname LIKE 'IX_tblAppEvents%';
SELECT "UserName" IS NOT NULL AS has_users FROM "tblUsers" LIMIT 1;
