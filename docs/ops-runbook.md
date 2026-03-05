# MailPilot Ops Runbook

Operational recovery and debugging reference for local/dev environments.

## 1) Reset Database Safely

Use this when schema/data is corrupted or you need a clean state.

```powershell
cd $env:USERPROFILE\Documents\MailPilot
docker compose down
docker volume rm mailpilot_mailpilot_pg
docker compose up -d
```

Then restart backend and desktop.

## 2) Reset Local Caches

Safe-to-delete cache locations:

- `%LOCALAPPDATA%\MailPilot\cache`
- `%LOCALAPPDATA%\MailPilot\cache\attachments`

PowerShell:

```powershell
Remove-Item "$env:LOCALAPPDATA\MailPilot\cache" -Recurse -Force -ErrorAction SilentlyContinue
```

This does not remove DB rows; it only clears local cache files.

## 3) Gmail OAuth Re-Auth

Re-auth is required when:

- scopes changed (example: adding `gmail.send`)
- token refresh fails
- account status indicates `REAUTH_REQUIRED`

Steps:

1. In app `Settings`, detach the problematic account if needed.
2. Reconnect via `Connect Gmail`.
3. Approve requested scopes.
4. Trigger a sync and verify account status is `CONNECTED`.

## 4) Sync Troubleshooting

Checklist:

1. Backend reachable: `http://127.0.0.1:8082/api/health`
2. DB reachable: `http://127.0.0.1:8082/api/db/ping`
3. Sync status endpoint returns active account states:
   - `GET /api/sync/status`
4. Trigger manual sync:
   - `POST /api/sync/gmail/run?maxMessages=500`
5. Confirm mailbox pages refresh after sync.

Log locations vary by terminal session; check backend console logs first.

Verify metadata classification (if needed):

- INBOX messages should map to inbox mode
- SENT messages should map to sent mode
- DRAFT messages should map to draft mode

## 5) Release Troubleshooting

Common failures and actions:

- Migrations fail on startup:
  - inspect startup log for Flyway error
  - test on fresh DB volume
- Desktop cannot save exported files:
  - check `mailpilot-desktop/src-tauri/capabilities/default.json`
  - verify save dialog and fs write permissions
- Build mismatch between frontend/backend:
  - rebuild both modules from clean installs
  - verify API base URL used by desktop app

## 6) Quick Health Commands

```powershell
# backend
irm http://127.0.0.1:8082/api/health
irm http://127.0.0.1:8082/api/db/ping
irm http://127.0.0.1:8082/api/sync/status
```

