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

$blockedGeneratedPrefixes = @(
  "mailpilot-desktop/dist/",
  "mailpilot-desktop/src-tauri/gen/",
  "mailpilot-desktop/src-tauri/resources/backend/",
  "mailpilot-desktop/src-tauri/target/",
  "mailpilot-server/target/",
  "tmp-jar-"
)

$blockedGeneratedSuffixes = @(
  ".log",
  ".out",
  ".err"
)

$violations = @()
foreach ($line in $statusLines) {
  $statusCode = $line.Substring(0, 2)
  $pathText = $line.Substring(3).Trim()
  foreach ($path in $blockedPaths) {
    if ($pathText -eq $path) {
      $violations += $line
      break
    }
  }

  if ($statusCode -eq "D " -or $statusCode -eq " D") {
    continue
  }

  foreach ($prefix in $blockedGeneratedPrefixes) {
    if ($pathText.StartsWith($prefix)) {
      $violations += $line
      break
    }
  }

  if (
    $pathText.StartsWith(".idea/") -or
    $pathText.StartsWith(".vscode/") -or
    $pathText.Contains("/.idea/") -or
    $pathText.Contains("/.vscode/")
  ) {
    $violations += $line
    continue
  }

  foreach ($suffix in $blockedGeneratedSuffixes) {
    if ($pathText.EndsWith($suffix)) {
      $violations += $line
      break
    }
  }
}

if ($violations.Count -gt 0) {
  Write-Error "Protected dependency drift or generated-file pollution detected:"
  $violations | ForEach-Object { Write-Error "  $_" }
  Write-Error "Restore unintended changes before committing."
  exit 1
}

Write-Host "OK: no protected dependency drift or generated-file pollution detected."
