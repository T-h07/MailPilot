param(
  [switch]$NoCompose
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

Write-Host "[MailPilot] Repo root: $repoRoot" -ForegroundColor Cyan

if (-not $NoCompose) {
  Write-Host "[MailPilot] Starting postgres with docker compose..." -ForegroundColor Cyan
  docker compose up -d
}

Write-Host ""
Write-Host "Start backend (new terminal):" -ForegroundColor Yellow
Write-Host "cd `"$repoRoot\mailpilot-server`"; .\mvnw.cmd `"\"-Dspring-boot.run.profiles=dev\""` spring-boot:run"
Write-Host ""
Write-Host "Start desktop (new terminal):" -ForegroundColor Yellow
Write-Host "cd `"$repoRoot\mailpilot-desktop`"; npm install; npm run tauri dev"
Write-Host ""
Write-Host "[MailPilot] dev-up completed." -ForegroundColor Green

