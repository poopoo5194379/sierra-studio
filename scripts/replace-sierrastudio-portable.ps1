$ErrorActionPreference = "Stop"
$workspace = Split-Path -Parent $PSScriptRoot
$source = Join-Path $workspace "release-035\win-unpacked"
$target = "D:\SS\SierraStudio"
$log = Join-Path $workspace "tmp\sierrastudio-portable-replace.log"
"START $(Get-Date -Format o)" | Set-Content -LiteralPath $log -Encoding UTF8

Get-CimInstance Win32_Process | Where-Object {
  $_.Name -match '^SierraStudio(?: Setup 0\.3\.[45])?\.exe$|^old-uninstaller\.exe$' -or
  $_.ExecutablePath -like "$target\*"
} | ForEach-Object {
  taskkill.exe /F /T /PID $_.ProcessId 2>&1 |
    Add-Content -LiteralPath $log -Encoding UTF8
}
Start-Sleep -Seconds 2

New-Item -ItemType Directory -Path $target -Force | Out-Null
robocopy.exe $source $target /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP 2>&1 |
  Add-Content -LiteralPath $log -Encoding UTF8
if ($LASTEXITCODE -ge 8) {
  throw "robocopy failed with exit code $LASTEXITCODE"
}
$sourceHash = (Get-FileHash (Join-Path $source "resources\app.asar") -Algorithm SHA256).Hash
$targetHash = (Get-FileHash (Join-Path $target "resources\app.asar") -Algorithm SHA256).Hash
"SOURCE_HASH $sourceHash" | Add-Content -LiteralPath $log -Encoding UTF8
"TARGET_HASH $targetHash" | Add-Content -LiteralPath $log -Encoding UTF8
if ($sourceHash -ne $targetHash) {
  throw "Installed app.asar hash does not match packaged app.asar"
}
"DONE $(Get-Date -Format o)" | Add-Content -LiteralPath $log -Encoding UTF8
