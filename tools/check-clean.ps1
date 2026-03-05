param()

$ErrorActionPreference = "Stop"

$statusLines = git status --porcelain
if ($LASTEXITCODE -ne 0) {
  throw "Failed to read git status."
}

$blockedPaths = @(
  "mailpilot-desktop/src-tauri/Cargo.toml",
  "mailpilot-desktop/package-lock.json"
)

$violations = @()
foreach ($line in $statusLines) {
  foreach ($path in $blockedPaths) {
    if ($line -match [regex]::Escape($path) + "$") {
      $violations += $line
      break
    }
  }
}

if ($violations.Count -gt 0) {
  Write-Error "Dependency drift detected in protected files:"
  $violations | ForEach-Object { Write-Error "  $_" }
  Write-Error "Restore unintended changes before committing."
  exit 1
}

Write-Host "OK: no protected dependency drift detected."
