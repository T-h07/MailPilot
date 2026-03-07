[CmdletBinding()]
param(
  [switch]$CopyToDesktop
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$desktopRoot = Join-Path $repoRoot "mailpilot-desktop"
$bundleRoot = Join-Path $desktopRoot "src-tauri\target\release\bundle"
$desktopPath = Join-Path $env:USERPROFILE "Desktop"
$protectedPaths = @(
  "mailpilot-desktop/src-tauri/Cargo.toml",
  "mailpilot-desktop/package-lock.json"
)

function Get-ProtectedDirtyPaths {
  $statusLines = @(git -C $repoRoot status --porcelain -- $protectedPaths)
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to inspect protected file status."
  }

  $dirtyPaths = @()
  foreach ($line in $statusLines) {
    foreach ($path in $protectedPaths) {
      if ($line -match ([regex]::Escape($path) + "$")) {
        $dirtyPaths += $path
        break
      }
    }
  }

  return $dirtyPaths
}

Set-Location $desktopRoot

Write-Host "[MailPilot] Desktop app: $desktopRoot" -ForegroundColor Cyan

$protectedDirtyBefore = @(Get-ProtectedDirtyPaths)

if (Test-Path "node_modules") {
  Write-Host "[MailPilot] node_modules detected. Skipping npm.cmd install." -ForegroundColor Yellow
} else {
  Write-Host "[MailPilot] Installing frontend dependencies..." -ForegroundColor Cyan
  npm.cmd install
  if ($LASTEXITCODE -ne 0) {
    throw "npm.cmd install failed."
  }
}

Write-Host "[MailPilot] Building Windows installer artifacts..." -ForegroundColor Cyan
npm.cmd run tauri build
if ($LASTEXITCODE -ne 0) {
  throw "npm.cmd run tauri build failed."
}

$protectedDirtyAfter = @(Get-ProtectedDirtyPaths)
$protectedDrift = @($protectedDirtyAfter | Where-Object { $_ -notin $protectedDirtyBefore })

if ($protectedDrift.Count -gt 0) {
  Write-Host "[MailPilot] Restoring protected files to HEAD after build drift..." -ForegroundColor Yellow
  git -C $repoRoot restore --source=HEAD -- $protectedDrift
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to restore protected files after build."
  }
}

if (-not (Test-Path $bundleRoot)) {
  throw "Bundle output directory not found: $bundleRoot"
}

$installerFiles = Get-ChildItem -Path $bundleRoot -Recurse -File |
  Where-Object { $_.Extension -in @(".msi", ".exe") } |
  Sort-Object LastWriteTime -Descending

if (-not $installerFiles) {
  throw "No installer artifacts found under $bundleRoot"
}

Write-Host "[MailPilot] Installer artifacts:" -ForegroundColor Green
foreach ($file in $installerFiles) {
  Write-Host (" - {0}" -f $file.FullName)
}

if ($CopyToDesktop) {
  $newestInstaller = $installerFiles | Select-Object -First 1
  $destination = Join-Path $desktopPath $newestInstaller.Name
  Copy-Item -Path $newestInstaller.FullName -Destination $destination -Force
  Write-Host ("[MailPilot] Copied newest installer to Desktop: {0}" -f $destination) -ForegroundColor Green
}
