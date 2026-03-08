# Runtime Parity Checklist (MP-HARDEN-01)

## 1) Critical Flows To Test

- Startup/app shell: app launch, backend readiness, UI boot completes.
- Mailbox core: inbox list, message detail, full body load, seen/new-dot clear persistence.
- Gmail account flows: accounts list, OAuth config/status, send-capable state, reconnect error handling.
- Attachments/exports: attachment metadata, attachment download, message PDF export, thread PDF export.
- Focus/dashboard/insights: summaries and charts endpoints load without API errors.
- Onboarding: onboarding state, view proposal fetch, view proposal apply, completion endpoints.
- Settings/auth/reset: app state, lock/login/logout/recovery options, system reset endpoint availability.

## 2) Dev vs Packaged Verification Checklist

Run these against both environments:

- Dev backend (`spring.profiles.active=dev`) on `http://127.0.0.1:8082`
- Packaged runtime (release/installed app launcher, `spring.profiles.active=desktop`)

Commands:

```powershell
cd $env:USERPROFILE\Documents\MailPilot
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\api-parity-smoke.ps1 -BaseUrl http://127.0.0.1:8082
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\api-parity-smoke.ps1 -BaseUrl http://127.0.0.1:8082 -IncludeMutating
```

Minimum endpoint coverage in smoke:

- `GET /api/health`, `GET /api/app/state`
- `POST /api/mailbox/query`, `GET /api/messages/{id}`, `POST /api/messages/{id}/body/load`
- `GET /api/focus/summary`
- `GET /api/views`
- `POST /api/onboarding/view-proposals/apply` (no-op payload)
- `GET /api/app/recovery/options`
- `GET /api/onboarding/view-proposals`
- attachment download path when attachment metadata exists

Current PT result snapshot (2026-03-08):

- Dev smoke: `23/23` pass (mutating mode)
- Packaged smoke (release binary launcher path): `23/23` pass (mutating mode)
- Packaged attachment probe: metadata + download `200` pass

## 3) Known Root Causes Fixed In This PT

- Packaged startup/readiness mismatch:
  - Root cause: launcher passed `\\?\` Windows extended path to Java for bundled JAR; Java 21 failed with `ClassNotFoundException: org.springframework.boot.loader.launch.JarLauncher`, causing false failed startup attempt before fallback.
  - Fix: normalize process paths in Tauri launcher before spawning Java.

- Full-body `500` on affected accounts:
  - Root cause: unreadable encrypted OAuth tokens (`AEADBadTagException`) from token-key drift; token decrypt threw `IllegalStateException` and bubbled as server error.
  - Fix: detect unreadable token rows, clear invalid tokens, return reconnect-required `401` instead of `500`.

- PDF export `500` parity failures:
  - Root causes: malformed comment blocks in HTML input and attribute mutation during iteration in renderer fallback path.
  - Fix: strip comments before render and avoid concurrent mutation by copying attributes first.

- Binary endpoint diagnosability:
  - Root cause: frontend binary fetch path did not consistently surface JSON/plain-text backend error payloads.
  - Fix: parse binary error responses safely and expose actionable UI messages.

## 4) Logs And Diagnostics

Packaged runtime logs:

- `%LOCALAPPDATA%\MailPilot\logs\backend-launcher.log`
- `%LOCALAPPDATA%\MailPilot\logs\backend.out.log`
- `%LOCALAPPDATA%\MailPilot\logs\backend.err.log`
- `%LOCALAPPDATA%\MailPilot\logs\backend.log`

Key checks:

- Startup attempts and health polling sequence in `backend-launcher.log`
- API exceptions and stack traces in `backend.out.log` / `backend.log`
- JVM/bootstrap errors in `backend.err.log`

## 5) Re-Run Installer Verification

Build installers and bundled backend:

```powershell
cd $env:USERPROFILE\Documents\MailPilot
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\build-desktop.ps1
```

Artifacts:

- `mailpilot-desktop\src-tauri\target\release\bundle\nsis\MailPilot_0.3.0_x64-setup.exe`
- `mailpilot-desktop\src-tauri\target\release\bundle\msi\MailPilot_0.3.0_x64_en-US.msi`

After install/launch, run smoke again against `http://127.0.0.1:8082` and confirm no parity regressions for startup, mailbox detail/full body, attachments, and onboarding routes.
