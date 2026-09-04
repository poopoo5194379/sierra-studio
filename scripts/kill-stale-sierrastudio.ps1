$log = Join-Path (Split-Path -Parent $PSScriptRoot) "tmp\sierrastudio-kill.log"
"START $(Get-Date -Format o)" | Set-Content -LiteralPath $log -Encoding UTF8
Get-CimInstance Win32_Process | Where-Object {
  $_.Name -match '^SierraStudio(?: Setup 0\.3\.[45])?\.exe$|^old-uninstaller\.exe$' -or
  $_.ExecutablePath -like 'D:\SS\SierraStudio\*' -or
  $_.ExecutablePath -like '*\html-studio\release\win-unpacked\*'
} | ForEach-Object {
  taskkill.exe /F /T /PID $_.ProcessId 2>&1 |
    Add-Content -LiteralPath $log -Encoding UTF8
}
"DONE $(Get-Date -Format o)" | Add-Content -LiteralPath $log -Encoding UTF8
