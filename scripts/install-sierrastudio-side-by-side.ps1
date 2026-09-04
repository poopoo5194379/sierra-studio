$ErrorActionPreference = "Stop"
$workspace = Split-Path -Parent $PSScriptRoot
$source = Join-Path $workspace "release-035\win-unpacked"
$target = "D:\SS\SierraStudio-0.3.5"
$log = Join-Path $workspace "tmp\sierrastudio-side-by-side.log"
"START $(Get-Date -Format o)" | Set-Content -LiteralPath $log -Encoding UTF8
New-Item -ItemType Directory -Path $target -Force | Out-Null
robocopy.exe $source $target /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP 2>&1 |
  Add-Content -LiteralPath $log -Encoding UTF8
if ($LASTEXITCODE -ge 8) {
  throw "robocopy failed with exit code $LASTEXITCODE"
}
$shell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcut = $shell.CreateShortcut((Join-Path $desktop "SierraStudio 0.3.5.lnk"))
$shortcut.TargetPath = Join-Path $target "SierraStudio.exe"
$shortcut.WorkingDirectory = $target
$shortcut.Save()
$sourceHash = (Get-FileHash (Join-Path $source "resources\app.asar") -Algorithm SHA256).Hash
$targetHash = (Get-FileHash (Join-Path $target "resources\app.asar") -Algorithm SHA256).Hash
"SOURCE_HASH $sourceHash" | Add-Content -LiteralPath $log -Encoding UTF8
"TARGET_HASH $targetHash" | Add-Content -LiteralPath $log -Encoding UTF8
if ($sourceHash -ne $targetHash) {
  throw "Installed app.asar hash does not match packaged app.asar"
}
"DONE $(Get-Date -Format o)" | Add-Content -LiteralPath $log -Encoding UTF8
