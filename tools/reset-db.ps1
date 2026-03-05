param(
  [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

$volumeName = "mailpilot_mailpilot_pg"

if (-not $Force) {
  Write-Host "WARNING: This will delete local postgres data volume '$volumeName'." -ForegroundColor Yellow
  $answer = Read-Host "Type RESET to continue"
  if ($answer -ne "RESET") {
    Write-Host "[MailPilot] reset-db aborted." -ForegroundColor Yellow
    exit 0
  }
}

Write-Host "[MailPilot] Stopping stack..." -ForegroundColor Cyan
docker compose down

Write-Host "[MailPilot] Removing volume $volumeName..." -ForegroundColor Cyan
docker volume rm $volumeName

Write-Host "[MailPilot] Starting stack..." -ForegroundColor Cyan
docker compose up -d

Write-Host "[MailPilot] reset-db completed." -ForegroundColor Green

