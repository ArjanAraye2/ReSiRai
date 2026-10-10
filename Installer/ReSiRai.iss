#define MyAppName "ReSiRai"
#define MyAppVersion "1.1.0"
#define MyAppPublisher "Rahim Namazi"
#define MyAppExeName "ReSiRai.Api.exe"
; Release stamp shown in the installer file name. Override from the command line
; on release day, e.g. /DReleaseStamp=14050629, so the version never goes stale.
#ifndef ReleaseStamp
#define ReleaseStamp "14050629"
#endif
#ifndef SourceRoot
#define SourceRoot ".."
#endif

[Setup]
AppId={{03464487-C1B2-46F0-89E2-3AFAEE74FD1F}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\ReSiRai
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=Output
; Version plus the Persian (Jalali) release date, so build files are distinguishable.
OutputBaseFilename=ReSiRai_Setup_{#MyAppVersion}_{#ReleaseStamp}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern hidebevels
WizardBackColor=#F7FBFF
WizardImageBackColor=#DDF4F5
WizardSmallImageBackColor=#DDF4F5
WizardSizePercent=110
UninstallDisplayIcon={app}\{#MyAppExeName}
SetupIconFile={#SourceRoot}\ReSiRai\wwwroot\images\resirai.ico

[Languages]
Name: "persian"; MessagesFile: "Farsi.isl"

[LangOptions]
persian.LanguageName=فارسی
persian.DialogFontName=Segoe UI
persian.DialogFontSize=9
persian.WelcomeFontName=Segoe UI
persian.WelcomeFontSize=16
persian.RightToLeft=yes

[Files]
; SetupHelper is used before the normal file-copy stage, so keep it embedded and extract it on demand.
Source: "{#SourceRoot}\ReSiRai.SetupHelper\ReSiRai.SetupHelper.exe"; Flags: dontcopy noencryption
Source: "{#SourceRoot}\ReSiRai.SetupHelper\ReSiRai.Database.Install.sql"; Flags: dontcopy noencryption
Source: "{#SourceRoot}\ReSiRai\*"; DestDir: "{app}"; Excludes: "appsettings.json,appsettings.Development.json"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\ReSiRai"; Filename: "{sys}\rundll32.exe"; Parameters: "url.dll,FileProtocolHandler http://localhost:5202"; IconFilename: "{app}\wwwroot\images\resirai.ico"
Name: "{autodesktop}\ReSiRai"; Filename: "{sys}\rundll32.exe"; Parameters: "url.dll,FileProtocolHandler http://localhost:5202"; IconFilename: "{app}\wwwroot\images\resirai.ico"

[UninstallRun]
Filename: "{sys}\sc.exe"; Parameters: "stop ReSiRai"; Flags: runhidden waituntilterminated; RunOnceId: "StopReSiRaiService"
Filename: "{sys}\sc.exe"; Parameters: "delete ReSiRai"; Flags: runhidden waituntilterminated; RunOnceId: "DeleteReSiRaiService"

[Code]
const
    CRLF = #13#10;

var
    SqlPage: TInputQueryWizardPage;
    StoragePage: TInputDirWizardPage;
    CreateDatabaseConfirmed: Boolean;

function RunHiddenAndWait(FileName: String; Parameters: String; WorkingDirectory: String; var ResultCode: Integer): Boolean; forward;
function DiscoverReSiRaiSqlServer: Boolean; forward;
function PrepareReSiRaiDatabase: Boolean; forward;

function JsonEscape(Value: String): String;
begin
    StringChangeEx(Value, '\', '\\', True);
    StringChangeEx(Value, '"', '\"', True);
    StringChangeEx(Value, #13, '\r', True);
    StringChangeEx(Value, #10, '\n', True);
    Result := Value;
end;

function RunHiddenAndWait(FileName: String; Parameters: String; WorkingDirectory: String; var ResultCode: Integer): Boolean;
begin
    Result := Exec(FileName, Parameters, WorkingDirectory, SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

function EnsureSetupHelperExtracted: Boolean;
var
    HelperExe, ScriptPath: String;
begin
    Result := False;
    HelperExe := ExpandConstant('{tmp}\ReSiRai.SetupHelper.exe');
    ScriptPath := ExpandConstant('{tmp}\ReSiRai.Database.Install.sql');

    if FileExists(HelperExe) and FileExists(ScriptPath) then
    begin
        Result := True;
        Exit;
    end;

    try
        { The helper is published as a single-file executable, so only two
          temporary payload files are needed. ExtractTemporaryFile writes them
          directly under the installer temporary directory. }
        if not FileExists(HelperExe) then
            ExtractTemporaryFile('ReSiRai.SetupHelper.exe');
        if not FileExists(ScriptPath) then
            ExtractTemporaryFile('ReSiRai.Database.Install.sql');

        Result := FileExists(HelperExe) and FileExists(ScriptPath);
    except
        Result := False;
    end;

    if not Result then
        MsgBox('فایل‌های لازم برای آماده‌سازی ReSiRai از بسته نصب استخراج نشدند.' + CRLF + 'نصب متوقف شد.', mbError, MB_OK);
end;

function GetExistingStoragePath: String;
var
    ConfigFile, ConfigText: String;
    ConfigAnsi: AnsiString;
    Marker, ValueText: String;
    StartPos, EndPos: Integer;
begin
    Result := '';
    ConfigFile := ExpandConstant('{commonappdata}\ReSiRai\ReSiRai.config.json');

    if not FileExists(ConfigFile) then
        Exit;

    ConfigAnsi := '';
    if not LoadStringFromFile(ConfigFile, ConfigAnsi) then
        Exit;

    ConfigText := String(ConfigAnsi);
    Marker := '"RootPath": "';
    StartPos := Pos(Marker, ConfigText);
    if StartPos = 0 then
        Exit;

    StartPos := StartPos + Length(Marker);
    EndPos := StartPos;

    while (EndPos <= Length(ConfigText)) and (ConfigText[EndPos] <> '"') do
        Inc(EndPos);

    if EndPos <= Length(ConfigText) then
    begin
        ValueText := Copy(ConfigText, StartPos, EndPos - StartPos);
        StringChangeEx(ValueText, '\\', '\', True);
        StringChangeEx(ValueText, '"', '"', True);
        Result := Trim(ValueText);
    end;
end;

function DiscoverReSiRaiSqlServer: Boolean;
var
    HelperExe, HelperDirectory, OutputFile, Params, ServerText: String;
    ServerAnsi: AnsiString;
    ResultCode: Integer;
begin
    Result := False;
    HelperDirectory := ExpandConstant('{tmp}');
    HelperExe := HelperDirectory + '\ReSiRai.SetupHelper.exe';
    OutputFile := ExpandConstant('{tmp}\ReSiRai.SqlDiscovery.txt');

    if not FileExists(HelperExe) then begin MsgBox('ابزار آماده‌سازی ReSiRai پیدا نشد.' + CRLF + 'نصب متوقف شد.', mbError, MB_OK); Exit; end;
    DeleteFile(OutputFile);
    Params := '--discover --output "' + OutputFile + '"';
    if not RunHiddenAndWait(HelperExe, Params, HelperDirectory, ResultCode) then begin MsgBox('امکان اجرای بررسی SQL Server وجود ندارد.' + CRLF + 'نصب متوقف شد.', mbError, MB_OK); Exit; end;
    if (ResultCode = 20) or (ResultCode = 21) then begin MsgBox('SQL Server روی این رایانه نصب نیست یا هیچ نمونه قابل دسترسی از SQL Server پیدا نشد.' + CRLF + CRLF + 'نصب ReSiRai خاتمه یافت.', mbError, MB_OK); Exit; end;
    if ResultCode <> 0 then begin MsgBox('شناسایی SQL Server ناموفق بود.' + CRLF + 'کد خطا: ' + IntToStr(ResultCode) + CRLF + 'نصب متوقف شد.', mbError, MB_OK); Exit; end;
    ServerAnsi := '';
    if not LoadStringFromFile(OutputFile, ServerAnsi) then begin MsgBox('نام SQL Server دریافت نشد.' + CRLF + 'نصب متوقف شد.', mbError, MB_OK); Exit; end;
    ServerText := Trim(String(ServerAnsi));
    if Pos('|', ServerText) > 0 then
        ServerText := Trim(Copy(ServerText, 1, Pos('|', ServerText) - 1));
    if ServerText = '' then begin MsgBox('نمونه SQL Server شناسایی نشد.' + CRLF + 'نصب متوقف شد.', mbError, MB_OK); Exit; end;
    SqlPage.Values[0] := ServerText;
    Result := True;
end;

function PrepareReSiRaiDatabase: Boolean;
var
    HelperExe, HelperDirectory, ScriptPath, CheckFile, ErrorFile, StateText, Params, ErrorText: String;
    ErrorAnsi: AnsiString;
    StateAnsi: AnsiString;
    ResultCode: Integer;
begin
    Result := False;
    HelperDirectory := ExpandConstant('{tmp}');
    HelperExe := HelperDirectory + '\ReSiRai.SetupHelper.exe';
    ScriptPath := ExpandConstant('{tmp}\ReSiRai.Database.Install.sql');
    CheckFile := ExpandConstant('{tmp}\ReSiRai.DatabaseState.txt');
    CreateDatabaseConfirmed := False;

    if not FileExists(HelperExe) then begin MsgBox('ابزار آماده‌سازی ReSiRai پیدا نشد.' + CRLF + 'نصب متوقف شد.', mbError, MB_OK); Exit; end;
    if not FileExists(ScriptPath) then begin MsgBox('اسکریپت پایگاه داده ReSiRai در بسته نصب وجود ندارد.' + CRLF + 'نصب متوقف شد.', mbError, MB_OK); Exit; end;

    DeleteFile(CheckFile);
    Params := '--server "' + Trim(SqlPage.Values[0]) + '" --check-database --output "' + CheckFile + '"';
    if not RunHiddenAndWait(HelperExe, Params, HelperDirectory, ResultCode) then begin MsgBox('بررسی دیتابیس ReSiRai با خطا مواجه شد.' + CRLF + 'نصب متوقف شد.', mbError, MB_OK); Exit; end;
    if (ResultCode = 20) or (ResultCode = 21) then begin MsgBox('SQL Server روی این رایانه نصب نیست یا قابل دسترسی نیست.' + CRLF + CRLF + 'نصب ReSiRai خاتمه یافت.', mbError, MB_OK); Exit; end;
    if ResultCode <> 0 then begin MsgBox('بررسی SQL Server موفق نبود.' + CRLF + 'کد خطا: ' + IntToStr(ResultCode) + CRLF + 'نصب متوقف شد.', mbError, MB_OK); Exit; end;

    StateAnsi := '';
    if not LoadStringFromFile(CheckFile, StateAnsi) then begin MsgBox('نتیجه بررسی دیتابیس دریافت نشد.' + CRLF + 'نصب متوقف شد.', mbError, MB_OK); Exit; end;
    StateText := Trim(String(StateAnsi));

    if Pos('MISSING', UpperCase(StateText)) > 0 then begin
        { MISSING means neither ReSiRai nor the older ReSiRai database was found. }
        if MsgBox('دیتابیس ReSiRai در SQL Server انتخاب‌شده پیدا نشد.' + CRLF + CRLF + 'آیا می‌خواهید دیتابیس ReSiRai ایجاد و آماده‌سازی شود؟', mbConfirmation, MB_YESNO) <> IDYES then begin MsgBox('نصب توسط کاربر لغو شد.', mbInformation, MB_OK); Exit; end;
        CreateDatabaseConfirmed := True;
    end else if Pos('LEGACY', UpperCase(StateText)) > 0 then begin
        { A pre-rename installation: the old database holds the patient data and
          the upgrade script renames it in place, so nothing is lost. }
        if MsgBox('یک نصب قدیمی ReSiRai روی این سرور پیدا شد.' + CRLF + CRLF +
                  'داده‌های بیماران در همان دیتابیس نگهداری می‌شود و در جریان نصب فقط نام آن به ReSiRai تغییر می‌کند.' + CRLF +
                  'هیچ اطلاعاتی حذف یا کپی نمی‌شود.' + CRLF + CRLF +
                  'آیا ادامه می‌دهید؟', mbConfirmation, MB_YESNO) <> IDYES then begin MsgBox('نصب توسط کاربر لغو شد.', mbInformation, MB_OK); Exit; end;
    end else if Pos('EXISTS', UpperCase(StateText)) = 0 then begin MsgBox('وضعیت دیتابیس قابل تشخیص نیست.' + CRLF + 'نصب متوقف شد.', mbError, MB_OK); Exit; end;

    ErrorFile := ExpandConstant('{tmp}\ReSiRai.DatabaseError.txt');
    DeleteFile(ErrorFile);
    Params := '--server "' + Trim(SqlPage.Values[0]) + '" --script "' + ScriptPath + '" --error-output "' + ErrorFile + '"';
    if CreateDatabaseConfirmed then Params := Params + ' --create-database true';

    if not RunHiddenAndWait(HelperExe, Params, HelperDirectory, ResultCode) or (ResultCode <> 0) then begin
        if ResultCode = 20 then MsgBox('SQL Server قابل دسترسی نیست.' + CRLF + 'نصب متوقف شد.', mbError, MB_OK)
        else if ResultCode = 30 then MsgBox('دیتابیس ReSiRai وجود ندارد و ایجاد آن تأیید نشده است.' + CRLF + 'نصب متوقف شد.', mbError, MB_OK)
        else begin
            ErrorText := '';
            ErrorAnsi := '';
            if FileExists(ErrorFile) and LoadStringFromFile(ErrorFile, ErrorAnsi) then ErrorText := String(ErrorAnsi);
            if Trim(ErrorText) <> '' then
                MsgBox('آماده‌سازی دیتابیس ReSiRai ناموفق بود.' + CRLF + CRLF + ErrorText + CRLF + CRLF + 'کد خطا: ' + IntToStr(ResultCode) + CRLF + 'نصب متوقف شد.', mbError, MB_OK)
            else
                MsgBox('آماده‌سازی دیتابیس ReSiRai ناموفق بود.' + CRLF + 'کد خطا: ' + IntToStr(ResultCode) + CRLF + 'نصب متوقف شد.', mbError, MB_OK);
        end;
        Exit;
    end;
    Result := True;
end;

procedure InitializeWizard;
begin
    WizardForm.Color := $00FFFBF7;
    WizardForm.WelcomeLabel1.Font.Name := 'Segoe UI';
    WizardForm.WelcomeLabel1.Font.Size := 16;
    WizardForm.WelcomeLabel1.Font.Style := [fsBold];

    SqlPage := CreateInputQueryPage(wpSelectDir, 'تنظیم اتصال به SQL Server', 'نمونه SQL Server را مشخص کنید', 'اگر مقدار پیش‌فرض را نگه دارید، نصب‌کننده به‌صورت خودکار نمونه‌ای را که دیتابیس ReSiRai در آن قرار دارد پیدا می‌کند.');
    SqlPage.Add('SQL Server:', False);
    SqlPage.Values[0] := '.\ReSiRai';

    StoragePage := CreateInputDirPage(SqlPage.ID, 'محل ذخیره تصاویر رادیولوژی', 'پوشه ذخیره تصاویر را انتخاب کنید', 'مسیر ذخیره تصاویر ReSiRai را مشخص کنید. در صورت نیاز این پوشه ساخته می‌شود.', False, 'RadiologyData');
    StoragePage.Add('');
    StoragePage.Values[0] := GetExistingStoragePath;
    if StoragePage.Values[0] = '' then
        StoragePage.Values[0] := 'D:\RadiologyData';
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
    Result := True;
    if CurPageID = SqlPage.ID then begin
        if not EnsureSetupHelperExtracted then begin Result := False; Exit; end;
        if Trim(SqlPage.Values[0]) = '' then begin MsgBox('لطفاً نام SQL Server را وارد کنید.', mbError, MB_OK); Result := False; Exit; end;
        { Always discover the SQL Server instance automatically. The installer must not assume .\ReSiRai. }
        if not DiscoverReSiRaiSqlServer then begin Result := False; Exit; end;
        if not PrepareReSiRaiDatabase then begin Result := False; Exit; end;
    end else if CurPageID = StoragePage.ID then begin
        if Trim(StoragePage.Values[0]) = '' then begin MsgBox('لطفاً مسیر ذخیره تصاویر را مشخص کنید.', mbError, MB_OK); Result := False; end;
    end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var ResultCode: Integer;
begin
    Result := '';

    { فقط سرویس قبلی را متوقف می‌کنیم؛ حذف ثبت Service تا بعد از کپی موفق فایل‌ها انجام نمی‌شود. }
    if not RunHiddenAndWait(ExpandConstant('{sys}\sc.exe'), 'stop ReSiRai', '', ResultCode) then
    begin
        Result := 'امکان بررسی سرویس قبلی ReSiRai وجود ندارد.';
        Exit;
    end;

    { 1060: سرویس وجود ندارد؛ 1062: سرویس از قبل متوقف است. هر دو قابل قبول‌اند. }
    if (ResultCode <> 0) and (ResultCode <> 1060) and (ResultCode <> 1062) then
    begin
        Result := 'امکان توقف سرویس قبلی ReSiRai وجود ندارد.' + CRLF +
            'Exit Code: ' + IntToStr(ResultCode);
        Exit;
    end;
end;

procedure ConfigureReSiRai;
var
    SqlServer, StoragePath, HelperExe, HelperDirectory, ConfigDirectory, ConfigFile, ConfigText, ReSiRaiExe: String;
    ResultCode: Integer;
begin
    SqlServer := Trim(SqlPage.Values[0]);
    StoragePath := Trim(StoragePage.Values[0]);
    HelperDirectory := ExpandConstant('{tmp}');
    HelperExe := HelperDirectory + '\ReSiRai.SetupHelper.exe';

    { Database preparation is already completed in NextButtonClick. }
    if not ForceDirectories(StoragePath) then RaiseException('امکان ایجاد پوشه تصاویر وجود ندارد:' + CRLF + StoragePath);
    if not RunHiddenAndWait(ExpandConstant('{sys}\icacls.exe'), '"' + StoragePath + '" /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F"', '', ResultCode) then RaiseException('امکان تنظیم دسترسی پوشه تصاویر وجود ندارد.');
    if ResultCode <> 0 then RaiseException('تنظیم دسترسی پوشه تصاویر ناموفق بود.' + CRLF + 'Exit Code: ' + IntToStr(ResultCode));

    ConfigDirectory := ExpandConstant('{commonappdata}\ReSiRai');
    if not ForceDirectories(ConfigDirectory) then RaiseException('امکان ایجاد پوشه تنظیمات ReSiRai وجود ندارد.');
    ConfigFile := ConfigDirectory + '\ReSiRai.config.json';

    ConfigText := '{' + CRLF +
        '  "ConnectionStrings": {' + CRLF +
        '    "ReSiRai": "Server=' + JsonEscape(SqlServer) + ';Database=ReSiRai;Integrated Security=True;Encrypt=True;TrustServerCertificate=True;"' + CRLF +
        '  },' + CRLF +
        '  "RadiologyStorage": {' + CRLF +
        '    "RootPath": "' + JsonEscape(StoragePath) + '"' + CRLF +
        '  },' + CRLF +
        '  "SuperAdmin": {' + CRLF +
        '    "UserName": "1860271855",' + CRLF +
        '    "PasswordHash": "AQAAAAIAAYagAAAAELnpwIvALl43U+yMRAPtilnf87rZu7NznzoL/HIk1pwf1zROREXx6SyZ6fIQ0XHdTg=="' + CRLF +
        '  },' + CRLF +
        '  "Urls": "http://0.0.0.0:5202",' + CRLF +
        '  "RemoteAccess": {' + CRLF +
        '    "LocalScheme": "http",' + CRLF +
        '    "LocalPort": 5202,' + CRLF +
        '    "PublicHost": "",' + CRLF +
        '    "PublicScheme": "http",' + CRLF +
        '    "PublicPort": 5202' + CRLF +
        '  },' + CRLF +
        '  "Logging": {' + CRLF +
        '    "LogLevel": {' + CRLF +
        '      "Default": "Information",' + CRLF +
        '      "Microsoft.AspNetCore": "Warning"' + CRLF +
        '    }' + CRLF +
        '  },' + CRLF +
        '  "AllowedHosts": "*"' + CRLF +
        '}' + CRLF;

    if not SaveStringToFile(ConfigFile, ConfigText, False) then RaiseException('فایل تنظیمات ReSiRai ساخته نشد.');
    if not RunHiddenAndWait(ExpandConstant('{sys}\icacls.exe'), '"' + ConfigFile + '" /inheritance:r /grant:r "*S-1-5-18:F" "*S-1-5-32-544:F"', '', ResultCode) then RaiseException('امکان تنظیم دسترسی فایل ReSiRai.config.json وجود ندارد.');
    if ResultCode <> 0 then RaiseException('تنظیم دسترسی فایل ReSiRai.config.json ناموفق بود.' + CRLF + 'Exit Code: ' + IntToStr(ResultCode));

    ReSiRaiExe := ExpandConstant('{app}\ReSiRai.Api.exe');

    { اگر Service قبلی هنوز ثبت شده باشد، فقط مشخصات اجرایی آن را به نسخه جدید تغییر می‌دهیم. }
    if not RunHiddenAndWait(ExpandConstant('{sys}\sc.exe'), 'config ReSiRai binPath= "' + ReSiRaiExe + '" start= auto DisplayName= "ReSiRai"', '', ResultCode) then
        RaiseException('امکان تنظیم Windows Service وجود ندارد.');

    { 1060 یعنی Service وجود ندارد؛ در نصب جدید آن را ایجاد می‌کنیم. }
    if ResultCode = 1060 then
    begin
        if not RunHiddenAndWait(ExpandConstant('{sys}\sc.exe'), 'create ReSiRai binPath= "' + ReSiRaiExe + '" start= auto DisplayName= "ReSiRai"', '', ResultCode) then
            RaiseException('امکان اجرای دستور ایجاد Windows Service وجود ندارد.');
        if ResultCode <> 0 then
            RaiseException('Windows Service ReSiRai ایجاد نشد.' + CRLF + 'Exit Code: ' + IntToStr(ResultCode));
    end
    else if ResultCode <> 0 then
        RaiseException('تنظیم Windows Service ReSiRai ناموفق بود.' + CRLF + 'Exit Code: ' + IntToStr(ResultCode));

    if not RunHiddenAndWait(ExpandConstant('{sys}\sc.exe'), 'description ReSiRai "ReSiRai Dental Radiology Service"', '', ResultCode) then RaiseException('امکان تنظیم توضیحات Windows Service وجود ندارد.');
    if ResultCode <> 0 then RaiseException('توضیحات Windows Service تنظیم نشد.' + CRLF + 'Exit Code: ' + IntToStr(ResultCode));

    if not RunHiddenAndWait(ExpandConstant('{sys}\sc.exe'), 'start ReSiRai', '', ResultCode) then RaiseException('امکان اجرای Windows Service وجود ندارد.');
    if ResultCode <> 0 then RaiseException('Windows Service ReSiRai ایجاد شد ولی Start نشد.' + CRLF + 'Exit Code: ' + IntToStr(ResultCode));
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
    if CurStep = ssPostInstall then ConfigureReSiRai;
end;
