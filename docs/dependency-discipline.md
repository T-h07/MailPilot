# Dependency discipline

Use this policy to avoid accidental dependency drift in MailPilot.

## Rules

1. Only change `mailpilot-desktop/package-lock.json` when intentionally adding, removing, or updating npm dependencies.
2. Do not commit `mailpilot-desktop/src-tauri/Cargo.toml` changes unless a Tauri plugin/config update is explicitly part of the task.
3. In CI contexts, prefer `npm ci` (not `npm install`) for deterministic frontend installs.

## Recommended workflow

1. Before opening a PR, run:
   - `powershell -File .\\tools\\check-clean.ps1`
2. If drift is detected and not intentional, restore with:
   - `git restore --source=HEAD -- mailpilot-desktop/src-tauri/Cargo.toml`
   - `git restore --source=HEAD -- mailpilot-desktop/package-lock.json`
