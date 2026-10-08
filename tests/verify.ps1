# ReSiRai - one-shot verification: build + unit tests + UI smoke prep.
# Usage: powershell -File tests\verify.ps1
# Then open http://localhost:8765/smoke2.html .. smoke11.html and check the
# document titles say PASS (each smoke sets its own verdict in the title).
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$api = Join-Path $root 'ReSiRai.Api'
$smoke = Join-Path $root 'tests\ui-smoke'
$fail = 0

Write-Output '== build =='
dotnet build (Join-Path $api 'ReSiRai.Api.csproj') -c Debug --nologo -t:Compile
if ($LASTEXITCODE -ne 0) { $fail++ }

Write-Output '== unit tests (output to a separate folder: the running app locks its exe) =='
$testOut = Join-Path $env:LOCALAPPDATA 'Temp\opencode\resirai-tb\'
dotnet build (Join-Path $root 'ReSiRai.Tests\ReSiRai.Tests.csproj') -p:OutputPath=$testOut --nologo
if ($LASTEXITCODE -ne 0) { $fail++ }
dotnet test (Join-Path $root 'ReSiRai.Tests\ReSiRai.Tests.csproj') --no-build -p:OutputPath=$testOut --nologo
if ($LASTEXITCODE -ne 0) { $fail++ }

Write-Output '== smoke prep (fresh copies from wwwroot) =='
Copy-Item (Join-Path $api 'wwwroot\js\study-finance.js') $smoke -Force
Copy-Item (Join-Path $api 'wwwroot\js\study-lab-tests.js') $smoke -Force
Copy-Item (Join-Path $api 'wwwroot\js\login-ui.js') $smoke -Force
Copy-Item (Join-Path $api 'wwwroot\js\app.js') $smoke -Force
Copy-Item (Join-Path $api 'wwwroot\js\study-sections.js') $smoke -Force
# smoke10 (نوعِ مراجعه: autocomplete + سایر) کدِ واقعیِ باکس را از همین فایل می‌آزماید.
Copy-Item (Join-Path $api 'wwwroot\js\study-type-ui.js') $smoke -Force
# smoke11 (بارداری/شیردهی فقط برایِ زن) پنلِ «شرایط فعلی» را از همین فایل می‌آزماید.
Copy-Item (Join-Path $api 'wwwroot\js\factors-ui.js') $smoke -Force
# smoke13 (مراجعه بدونِ ناوبری) کارتِ پیش‌نویس و فیلدهایِ مستقیم‌ویرایش را از همین فایل می‌آزماید.
Copy-Item (Join-Path $api 'wwwroot\js\visit-draft.js') $smoke -Force
Copy-Item (Join-Path $api 'wwwroot\css\site.css') $smoke -Force
# smoke2 قبلاً از یک مسیرِ مطلقِ قدیمی (که دیگر وجود ندارد) بارگذاری می‌شد؛ حالا
# همین نسخه‌های تازه را می‌آزماید تا پنلِ فاکتورها واقعاً آزموده شود.
Copy-Item (Join-Path $api 'wwwroot\js\lab-extract-ui.js') $smoke -Force
Copy-Item (Join-Path $api 'wwwroot\js\dictation.js') $smoke -Force
Copy-Item (Join-Path $api 'wwwroot\css\study-sections.css') $smoke -Force
# smoke9 ساختارِ فرمِ ادغام‌شده را از خودِ index.html می‌خواند (یک نسخهٔ تازه کافی است).
Copy-Item (Join-Path $api 'wwwroot\index.html') $smoke -Force

# The fetch-gate lives inline in index.html; extract the real code so smoke5
# tests exactly what ships (never a stale copy).
$html = [IO.File]::ReadAllText((Join-Path $api 'wwwroot\index.html'))
$m = [regex]::Match($html, '(?s)<script>\s*/\* \u0646\u06af\u0647\u0628\u0627\u0646.*?</script>')
if (-not $m.Success) { Write-Output '!! fetch-gate script not found in index.html'; $fail++ }
else {
  $js = $m.Value -replace '^<script>', '' -replace '</script>$', ''
  [IO.File]::WriteAllText((Join-Path $smoke 'gate-under-test.js'), $js, (New-Object System.Text.UTF8Encoding $false))
  Write-Output 'gate-under-test.js extracted from index.html'
}

Write-Output ''
Write-Output ('== verify summary: ' + $(if ($fail -eq 0) { 'BUILD + TESTS GREEN' } else { "$fail step(s) FAILED" }) + ' ==')
Write-Output 'Next: powershell -File tests\ui-smoke\serve.ps1'
Write-Output 'Then check titles of: smoke2, smoke3, smoke4, smoke5, smoke6, smoke7 (patients list offset), smoke8 (visit sections), smoke9 (ادغامِ فرمِ مراجعه), smoke10 (autocompleteِ نوعِ مراجعه + سایر), smoke11 (بارداری/شیردهی فقط برایِ زن), smoke12 (تشخیص + پایانِ کار), smoke13 (مراجعه بدونِ ناوبری)'
