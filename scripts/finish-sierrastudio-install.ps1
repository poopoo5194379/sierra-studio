$ErrorActionPreference = "Continue"
$workspace = Split-Path -Parent $PSScriptRoot
$log = Join-Path $workspace "tmp\sierrastudio-install-admin.log"
"START $(Get-Date -Format o)" | Set-Content -LiteralPath $log -Encoding UTF8
$currentProcessId = $PID
Get-CimInstance Win32_Process | Where-Object {
  $_.ProcessId -ne $currentProcessId -and (
    $_.Name -match '^SierraStudio(?: Setup 0\.3\.[45])?\.exe$|^old-uninstaller\.exe$' -or
    $_.ExecutablePath -like 'D:\SS\SierraStudio\*' -or
    $_.ExecutablePath -like "$workspace\release\win-unpacked\*"
  )
} | ForEach-Object {
  taskkill.exe /F /T /PID $_.ProcessId 2>&1 |
    Add-Content -LiteralPath $log -Encoding UTF8
}
Start-Sleep -Seconds 2
$installer = Join-Path $workspace "release-035\SierraStudio Setup 0.3.5.exe"
$process = Start-Process -FilePath $installer `
  -ArgumentList "/allusers /S /D=D:\SS\SierraStudio" -PassThru -Wait
"INSTALL_EXIT $($process.ExitCode) $(Get-Date -Format o)" |
  Add-Content -LiteralPath $log -Encoding UTF8
$exe = Get-Item -LiteralPath "D:\SS\SierraStudio\SierraStudio.exe" `
  -ErrorAction SilentlyContinue
"EXE $($exe.Length) $($exe.LastWriteTime.ToString('o')) $($exe.VersionInfo.FileVersion)" |
  Add-Content -LiteralPath $log -Encoding UTF8
"DONE" | Add-Content -LiteralPath $log -Encoding UTF8
