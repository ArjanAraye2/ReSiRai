$c = New-Object System.Net.Sockets.TcpClient
$c.Connect('whois.nic.ir', 43)
$s = $c.GetStream()
$b = [System.Text.Encoding]::UTF8.GetBytes("resirai.ir`r`n")
$s.Write($b, 0, $b.Length)
$s.ReadTimeout = 15000
$buf = New-Object byte[] 4096
$out = ''
try { while (($n = $s.Read($buf, 0, 4096)) -gt 0) { $out += [System.Text.Encoding]::UTF8.GetString($buf, 0, $n) } } catch {}
$c.Close()
if (-not $out) { $out = '(empty / timeout — possibly blocked)' }
Write-Output $out
