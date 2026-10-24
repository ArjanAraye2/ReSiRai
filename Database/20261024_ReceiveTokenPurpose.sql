-- هدفِ توکنِ دریافت تصویر: 1 = عکس رادیولوژی با دوربین گوشی،
-- 2 = دریافت لینک/پیامک رادیولوژی، 3 = عکس چهرهٔ بیمار.
-- توکن‌های موجود پیامک در نظر گرفته می‌شوند.
IF COL_LENGTH('dbo.tblReceiveTokens', 'Purpose') IS NULL
BEGIN
    ALTER TABLE dbo.tblReceiveTokens
        ADD Purpose smallint NOT NULL
            CONSTRAINT DF_tblReceiveTokens_Purpose DEFAULT (2);
END
GO
