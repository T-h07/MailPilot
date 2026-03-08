# Repo Hygiene

Use this guide to keep the repository limited to source, required build files, and practical project documentation.

## Never Commit

- Copied OAuth client JSON files
- `MAILPILOT_TOKEN_KEY_B64` values or generated `token_key.b64` files
- Access tokens, refresh tokens, recovery codes, or raw auth responses
- `node_modules`, `dist`, `target`, Tauri bundle output, or copied installer artifacts
- Local logs, cache exports, downloaded attachments, or message/body dumps
- IDE state such as `.idea/`, `.vscode/`, or `*.code-workspace`

## Generated-Only Paths

- `mailpilot-server/target/`
- `mailpilot-desktop/dist/`
- `mailpilot-desktop/src-tauri/target/`
- `mailpilot-desktop/src-tauri/gen/`
- `mailpilot-desktop/src-tauri/resources/backend/`
- root `tmp-*` directories and local `*.log` / `*.out` / `*.err` files

## Safe Workspace Checks

From the repo root:

```powershell
git status --short
powershell -ExecutionPolicy Bypass -File .\tools\check-clean.ps1
cd .\mailpilot-server; .\mvnw.cmd spotless:check; cd ..
cd .\mailpilot-desktop; npm run format:check; npm run lint:ci; cd ..
```

If ignored build output is piling up, remove only generated directories:

```powershell
Remove-Item .\mailpilot-server\target -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item .\mailpilot-desktop\dist -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item .\mailpilot-desktop\src-tauri\target -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item .\mailpilot-desktop\src-tauri\resources\backend -Recurse -Force -ErrorAction SilentlyContinue
```

## Tracked File Discipline

- Keep build descriptors and lockfiles intentional. If `Cargo.toml` or `package-lock.json` changed unexpectedly, restore them before committing.
- Do not commit copied release bundles or installers. Build them locally, verify them, then distribute from the generated output.
- Remove stale draft docs and one-off scripts once their replacement exists. Do not keep parallel copies of the same workflow.
