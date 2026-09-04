param(
  [string]$ReleaseDirectory = "release",
  [switch]$RequireSignature
)

$ErrorActionPreference = "Stop"
$releasePath = (Resolve-Path -LiteralPath $ReleaseDirectory).Path
$setupFiles = @(
  Get-ChildItem -LiteralPath $releasePath -File -Filter "SierraStudio Setup *.exe" |
    Where-Object { $_.Name -notmatch "__uninstaller" }
)
$unpackedExe = Join-Path $releasePath "win-unpacked\SierraStudio.exe"

if ($setupFiles.Count -ne 1) {
  throw "Expected exactly one SierraStudio installer in $releasePath; found $($setupFiles.Count)."
}
if (-not (Test-Path -LiteralPath $unpackedExe)) {
  throw "Missing unpacked executable: $unpackedExe"
}

$executables = @($setupFiles[0].FullName, $unpackedExe)
$signatureResults = foreach ($path in $executables) {
  $signature = Get-AuthenticodeSignature -LiteralPath $path
  [pscustomobject]@{
    path = $path.Substring($releasePath.Length).TrimStart("\").Replace("\", "/")
    status = $signature.Status.ToString()
    subject = $signature.SignerCertificate.Subject
    thumbprint = $signature.SignerCertificate.Thumbprint
  }
}

if ($RequireSignature) {
  $invalidSignatures = @($signatureResults | Where-Object { $_.status -ne "Valid" })
  if ($invalidSignatures.Count -gt 0) {
    throw "Release signing is required, but one or more executables do not have a valid Authenticode signature."
  }
}
$allSignaturesValid = (@(
  $signatureResults | Where-Object { $_.status -eq "Valid" }
)).Count -eq $signatureResults.Count
$signatureMessage = if ($allSignaturesValid) {
  "Authenticode status: Valid. The installer and unpacked executable are signed."
} else {
  @"
Authenticode status: UNSIGNED.
This build passed the automated dependency audit and Microsoft Defender scan,
but Windows may show an Unknown publisher / SmartScreen warning. Verify the
SHA-256 checksum and GitHub build attestation before running it.
"@.Trim()
}
Set-Content -LiteralPath (Join-Path $releasePath "SIGNING-STATUS.txt") `
  -Value $signatureMessage -Encoding utf8

if (-not (Get-Command Get-MpComputerStatus -ErrorAction SilentlyContinue)) {
  throw "Microsoft Defender cmdlets are unavailable; refusing to mark the release as scanned."
}
$defender = Get-MpComputerStatus
if (-not $defender.AntivirusEnabled) {
  throw "Microsoft Defender Antivirus is not enabled; refusing to mark the release as scanned."
}

Update-MpSignature
$scanStarted = Get-Date
Start-MpScan -ScanType CustomScan -ScanPath $releasePath
$scanFinished = Get-Date
$releasePattern = [regex]::Escape($releasePath)
$detections = @(
  Get-MpThreatDetection -ErrorAction SilentlyContinue |
    Where-Object {
      $_.InitialDetectionTime -ge $scanStarted.AddMinutes(-1) -and
      (($_.Resources -join "`n") -match $releasePattern)
    }
)
if ($detections.Count -gt 0) {
  $names = ($detections | ForEach-Object { $_.ThreatID } | Sort-Object -Unique) -join ", "
  throw "Microsoft Defender detected threats in the release output. Threat IDs: $names"
}

$hashTargets = @(
  Get-ChildItem -LiteralPath $releasePath -File |
    Where-Object { $_.Extension -in @(".exe", ".blockmap", ".yml", ".json") }
)
$hashTargets += Get-Item -LiteralPath $unpackedExe
$hashResults = @(
  $hashTargets |
    Sort-Object FullName -Unique |
    ForEach-Object {
      $hash = Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256
      $relative = $_.FullName.Substring($releasePath.Length).TrimStart("\").Replace("\", "/")
      [pscustomobject]@{ path = $relative; sha256 = $hash.Hash; bytes = $_.Length }
    }
)

$checksumLines = $hashResults | ForEach-Object { "$($_.sha256) *$($_.path)" }
Set-Content -LiteralPath (Join-Path $releasePath "SHA256SUMS.txt") `
  -Value $checksumLines -Encoding utf8

$commit = $env:GITHUB_SHA
if ([string]::IsNullOrWhiteSpace($commit)) {
  $commit = (git rev-parse HEAD).Trim()
}
$report = [ordered]@{
  product = "SierraStudio"
  version = (Get-Content -Raw -LiteralPath "package.json" | ConvertFrom-Json).version
  commit = $commit
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  builder = if ($env:GITHUB_ACTIONS -eq "true") { "github-actions/windows-latest" } else { "local-windows" }
  defender = [ordered]@{
    antivirusEnabled = $defender.AntivirusEnabled
    realTimeProtectionEnabled = $defender.RealTimeProtectionEnabled
    signatureVersion = $defender.AntivirusSignatureVersion
    signatureUpdatedAt = $defender.AntivirusSignatureLastUpdated
    scanStartedUtc = $scanStarted.ToUniversalTime().ToString("o")
    scanFinishedUtc = $scanFinished.ToUniversalTime().ToString("o")
    detections = $detections.Count
  }
  signatures = $signatureResults
  artifacts = $hashResults
}
$report | ConvertTo-Json -Depth 6 |
  Set-Content -LiteralPath (Join-Path $releasePath "SECURITY-MANIFEST.json") -Encoding utf8

Write-Output "Release security verification passed."
Write-Output "Installer: $($setupFiles[0].FullName)"
Write-Output "Signed: $allSignaturesValid"
Write-Output "Defender signatures: $($defender.AntivirusSignatureVersion)"
Write-Output "Checksums: $(Join-Path $releasePath 'SHA256SUMS.txt')"
