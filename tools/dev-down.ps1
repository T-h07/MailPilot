Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

Write-Host "[MailPilot] Stopping docker compose services..." -ForegroundColor Cyan
docker compose down
Write-Host "[MailPilot] dev-down completed." -ForegroundColor Green

