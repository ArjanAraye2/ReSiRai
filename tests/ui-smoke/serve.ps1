# ReSiRai - static smoke server (tests only). Serves this folder by file name
# on http://localhost:8765 so smoke pages can run outside the app (no auth).
param([int]$Port = 8765, [string]$Root = $PSScriptRoot)
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Output "smoke server on http://localhost:$Port ($Root)"
while ($true) {
  $ctx = $listener.GetContext()
  try {
    $name = [System.IO.Path]::GetFileName($ctx.Request.Url.LocalPath)
    if ([string]::IsNullOrWhiteSpace($name)) { $name = 'smoke2.html' }
    $file = Join-Path $Root $name
    if (Test-Path $file) {
      $bytes = [System.IO.File]::ReadAllBytes($file)
      if ($name.EndsWith('.js')) { $ctx.Response.ContentType = 'application/javascript; charset=utf-8' }
      elseif ($name.EndsWith('.html')) { $ctx.Response.ContentType = 'text/html; charset=utf-8' }
      elseif ($name.EndsWith('.css')) { $ctx.Response.ContentType = 'text/css; charset=utf-8' }
      elseif ($name.EndsWith('.png') -or $name.EndsWith('.jpg') -or $name.EndsWith('.jpeg') -or $name.EndsWith('.gif') -or $name.EndsWith('.svg') -or $name.EndsWith('.ico')) { $ctx.Response.ContentType = 'image/*' }
      else { $ctx.Response.ContentType = 'text/plain; charset=utf-8' }
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else { $ctx.Response.StatusCode = 404 }
  } catch { try { $ctx.Response.StatusCode = 500 } catch {} }
  try { $ctx.Response.Close() } catch {}
}
