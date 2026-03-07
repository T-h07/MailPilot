[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$desktopRoot = Join-Path $repoRoot "mailpilot-desktop"
$serverRoot = Join-Path $repoRoot "mailpilot-server"
$backendResourceRoot = Join-Path $desktopRoot "src-tauri\resources\backend"
$backendJarSource = Join-Path $serverRoot "target\mailpilot-server.jar"
$backendJarTarget = Join-Path $backendResourceRoot "mailpilot-server.jar"

Write-Host "[MailPilot] Preparing desktop frontend bundle..." -ForegroundColor Cyan
Set-Location $desktopRoot
npm.cmd run build
if ($LASTEXITCODE -ne 0) {
  throw "npm.cmd run build failed."
}

Write-Host "[MailPilot] Packaging bundled backend..." -ForegroundColor Cyan
Set-Location $serverRoot
& .\mvnw.cmd package "-DskipTests"
if ($LASTEXITCODE -ne 0) {
  throw "Backend package build failed."
}

if (-not (Test-Path $backendJarSource)) {
  throw "Expected backend JAR not found: $backendJarSource"
}

New-Item -Path $backendResourceRoot -ItemType Directory -Force | Out-Null
Copy-Item -Path $backendJarSource -Destination $backendJarTarget -Force

Write-Host "[MailPilot] Bundled backend prepared at $backendJarTarget" -ForegroundColor Green
