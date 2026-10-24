-- مرکز پیام: پیام‌های کاربر ↔ مدیریت (شناسهٔ مدیریت ۰ است).
IF OBJECT_ID(N'dbo.tblUserMessages', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.tblUserMessages (
        MessageID bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_tblUserMessages PRIMARY KEY,
        SenderUserID int NOT NULL,
        RecipientUserID int NOT NULL,
        Body nvarchar(2000) NOT NULL,
        ReplyToMessageID bigint NULL,
        CreatedDate datetime2(0) NOT NULL CONSTRAINT DF_tblUserMessages_Created DEFAULT (SYSDATETIME()),
        ReadAt datetime2(0) NULL
    );
    CREATE INDEX IX_tblUserMessages_Recipient_Read
        ON dbo.tblUserMessages (RecipientUserID, ReadAt);
    CREATE INDEX IX_tblUserMessages_Sender
        ON dbo.tblUserMessages (SenderUserID);
END
GO
