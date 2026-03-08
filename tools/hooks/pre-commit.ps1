param()

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\\..")).Path
$fastMode = $env:MAILPILOT_HOOK_FAST

Write-Host "[mailpilot] running frontend checks..."
Push-Location (Join-Path $repoRoot "mailpilot-desktop")
try {
  npm run lint:ci
  if ($fastMode -ne "1") {
    npm run format:check
    npm run build
  }
} finally {
  Pop-Location
}

Write-Host "[mailpilot] running backend checks..."
Push-Location (Join-Path $repoRoot "mailpilot-server")
try {
  if ($fastMode -eq "1") {
    ./mvnw -q -DskipTests compile
  } else {
    ./mvnw -q spotless:check
    ./mvnw -q test
  }
} finally {
  Pop-Location
}

Write-Host "[mailpilot] pre-commit checks passed."
