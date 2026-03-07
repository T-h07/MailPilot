# MailPilot API Parity Checklist

This checklist tracks frontend API usage and verifies parity between:

- dev backend run (`spring.profiles.active=dev`)
- packaged desktop runtime (`spring.profiles.active=desktop`) launched from installer output

## Repeatable Smoke Test

Use the parity smoke script against any running backend:

```powershell
cd $env:USERPROFILE\Documents\MailPilot
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\api-parity-smoke.ps1 -BaseUrl http://127.0.0.1:8082
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\api-parity-smoke.ps1 -BaseUrl http://127.0.0.1:8082 -IncludeMutating
```

Validated on this machine:

- Dev smoke: `22/22` passed (including mailbox/detail/full body/PDF export)
- Packaged smoke (installed NSIS app): `22/22` passed

## Frontend API Inventory Audited

| Feature area | Frontend callsite | Method | Endpoint |
| --- | --- | --- | --- |
| Startup | `src/api/client.ts` | `GET` | `/api/health` |
| App state | `src/lib/api/app-state.ts` | `GET` | `/api/app/state` |
| App auth | `src/lib/api/app-state.ts` | `POST` | `/api/app/password/set` |
| App auth | `src/lib/api/app-state.ts` | `POST` | `/api/app/password/change` |
| App auth | `src/lib/api/app-state.ts` | `POST` | `/api/app/login` |
| App auth | `src/lib/api/app-state.ts` | `POST` | `/api/app/lock` |
| App auth | `src/lib/api/app-state.ts` | `POST` | `/api/app/unlock` |
| App auth | `src/lib/api/app-state.ts` | `POST` | `/api/app/logout` |
| Recovery | `src/lib/api/app-state.ts` | `GET` | `/api/app/recovery/options` |
| Recovery | `src/lib/api/app-state.ts` | `POST` | `/api/app/recovery/request` |
| Recovery | `src/lib/api/app-state.ts` | `POST` | `/api/app/recovery/verify` |
| Accounts | `src/lib/api/accounts.ts` | `GET` | `/api/accounts` |
| Accounts | `src/lib/api/accounts.ts` | `DELETE` | `/api/accounts/{accountId}?purge=true` |
| Accounts | `src/lib/api/accounts.ts` | `PATCH` | `/api/accounts/{accountId}/label` |
| OAuth | `src/lib/api/oauth.ts` | `GET` | `/api/oauth/gmail/config-check` |
| OAuth | `src/lib/api/oauth.ts` | `POST` | `/api/oauth/gmail/start` |
| OAuth | `src/lib/api/oauth.ts` | `GET` | `/api/oauth/gmail/status?state=...` |
| Sync | `src/lib/api/sync.ts` | `POST` | `/api/sync/gmail/{accountId}/run?maxMessages=...` |
| Sync | `src/lib/api/sync.ts` | `POST` | `/api/sync/gmail/run?maxMessages=...` |
| Sync | `src/lib/api/sync.ts` | `GET` | `/api/sync/status` |
| Dev repair | `src/lib/api/sync.ts` | `POST` | `/api/dev/repair/messages?days=...` |
| Mailbox | `src/lib/api/mailbox.ts` | `POST` | `/api/mailbox/query` |
| Mailbox | `src/lib/api/mailbox.ts` | `POST` | `/api/mailbox/query/view` |
| Message detail | `src/lib/api/mailbox.ts` | `GET` | `/api/messages/{id}` |
| Message state | `src/lib/api/mailbox.ts` | `POST` | `/api/messages/{id}/read` |
| Message state | `src/lib/api/mailbox.ts` | `POST` | `/api/messages/{id}/seen` |
| Message body | `src/lib/api/mailbox.ts` | `POST` | `/api/messages/{id}/body/load?force=...` |
| Compose | `src/lib/api/mail.ts` | `POST` | `/api/mail/send` |
| Drafts | `src/lib/api/drafts.ts` | `GET` | `/api/drafts` |
| Drafts | `src/lib/api/drafts.ts` | `GET` | `/api/drafts/{id}` |
| Drafts | `src/lib/api/drafts.ts` | `POST` | `/api/drafts` |
| Drafts | `src/lib/api/drafts.ts` | `PUT` | `/api/drafts/{id}` |
| Drafts | `src/lib/api/drafts.ts` | `DELETE` | `/api/drafts/{id}` |
| Attachments | `src/lib/api/exports.ts` | `GET` | `/api/attachments/{attachmentId}/download` |
| Export | `src/lib/api/exports.ts` | `GET` | `/api/messages/{messageId}/export/pdf` |
| Export | `src/lib/api/exports.ts` | `GET` | `/api/threads/{threadId}/export/pdf` |
| Badges | `src/lib/api/badges.ts` | `GET` | `/api/badges/summary` |
| Badges | `src/lib/api/badges.ts` | `POST` | `/api/badges/inbox/opened` |
| Badges | `src/lib/api/badges.ts` | `POST` | `/api/badges/views/{viewId}/opened` |
| Views | `src/lib/api/views.ts` | `GET` | `/api/views` |
| Views | `src/lib/api/views.ts` | `GET` | `/api/views/{id}` |
| Views | `src/lib/api/views.ts` | `POST` | `/api/views` |
| Views | `src/lib/api/views.ts` | `PUT` | `/api/views/{id}` |
| Views | `src/lib/api/views.ts` | `DELETE` | `/api/views/{id}` |
| View labels | `src/lib/api/views.ts` | `GET` | `/api/views/{id}/labels` |
| View labels | `src/lib/api/views.ts` | `POST` | `/api/views/{id}/labels` |
| View labels | `src/lib/api/views.ts` | `PUT` | `/api/views/{id}/labels/{labelId}` |
| View labels | `src/lib/api/views.ts` | `DELETE` | `/api/views/{id}/labels/{labelId}` |
| Message labels | `src/lib/api/views.ts` | `GET` | `/api/views/{viewId}/messages/{messageId}/labels` |
| Message labels | `src/lib/api/views.ts` | `PUT` | `/api/views/{viewId}/messages/{messageId}/labels` |
| Sender rules | `src/lib/api/sender-rules.ts` | `GET` | `/api/sender-rules` |
| Sender rules | `src/lib/api/sender-rules.ts` | `POST` | `/api/sender-rules` |
| Sender rules | `src/lib/api/sender-rules.ts` | `PUT` | `/api/sender-rules/{id}` |
| Sender rules | `src/lib/api/sender-rules.ts` | `DELETE` | `/api/sender-rules/{id}` |
| Followups | `src/lib/api/followups.ts` | `GET` | `/api/followups/{messageId}` |
| Followups | `src/lib/api/followups.ts` | `PUT` | `/api/followups/{messageId}` |
| Followups | `src/lib/api/followups.ts` | `POST` | `/api/followups/{messageId}/actions` |
| Dashboard | `src/lib/api/dashboard.ts` | `GET` | `/api/dashboard/summary` |
| Focus | `src/lib/api/focus.ts` | `GET` | `/api/focus/summary` |
| Focus | `src/lib/api/focus.ts` | `GET` | `/api/focus/queue?...` |
| Insights | `src/lib/api/insights.ts` | `GET` | `/api/insights/summary?range=...` |
| Onboarding | `src/lib/api/onboarding.ts` | `POST` | `/api/onboarding/start` |
| Onboarding | `src/lib/api/onboarding.ts` | `POST` | `/api/onboarding/primary-account/confirm` |
| Onboarding | `src/lib/api/onboarding.ts` | `POST` | `/api/onboarding/accounts/complete` |
| Onboarding | `src/lib/api/onboarding.ts` | `GET` | `/api/onboarding/view-proposals?...` |
| Onboarding | `src/lib/api/onboarding.ts` | `POST` | `/api/onboarding/view-proposals/apply` |
| Onboarding | `src/lib/api/onboarding.ts` | `POST` | `/api/onboarding/view-proposals/complete` |
| Onboarding | `src/lib/api/onboarding.ts` | `POST` | `/api/onboarding/complete` |
| System | `src/lib/api/system.ts` | `POST` | `/api/system/reset` |
| Live events | `src/lib/events/sse.ts` | `GET` | `/api/events/stream` |

## Issues Found And Fixed

1. `POST /api/messages/{id}/body/load` returned `500` in packaged mode for saved accounts with unreadable encrypted tokens.
   - Root cause from logs: `IllegalStateException: Failed to decrypt OAuth token` (`AEADBadTagException`).
   - Fix (already included in this branch history): unreadable token rows are cleared and surfaced as `401` reconnect-required instead of `500`.

2. `GET /api/messages/{id}/export/pdf` and `GET /api/threads/{threadId}/export/pdf` returned `500`.
   - Root causes from `%LOCALAPPDATA%\MailPilot\logs\backend.out.log`:
     - XML parsing failure: `The string "--" is not permitted within comments`
     - `ConcurrentModificationException` in `HtmlPdfRenderer.stripExternalAssets`
   - Fix:
     - Strip HTML comments before rendering.
     - Remove external-asset attributes using a copied attribute list (no mutation while iterating).
   - Result: both PDF export endpoints now return `200` in dev and packaged runs.

3. Smoke script portability gaps on Windows PowerShell 5.1.
   - Fix:
     - Removed dependency on `Invoke-WebRequest -SkipHttpErrorCheck`
     - Added `UseBasicParsing` compatibility and robust non-2xx handling
     - Added JSON parsing compatibility when `ConvertFrom-Json -Depth` is unavailable

4. Frontend API diagnostics were too opaque during dev.
   - Fix:
     - Added dev-only API client error logging with endpoint + HTTP status + message in `src/api/client.ts`.

## Packaged Verification Steps

1. Build installers:

```powershell
cd $env:USERPROFILE\Documents\MailPilot
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\build-desktop.ps1 -CopyToDesktop
```

2. Install NSIS build to a clean location for parity verification:

```powershell
Start-Process -FilePath .\mailpilot-desktop\src-tauri\target\release\bundle\nsis\MailPilot_0.1.0_x64-setup.exe -ArgumentList '/S','/D=C:\Users\taulanth\AppData\Local\Programs\MailPilotNew' -Wait
```

3. Launch packaged app and run smoke:

```powershell
Start-Process C:\Users\taulanth\AppData\Local\Programs\MailPilotNew\MailPilot.exe
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\api-parity-smoke.ps1 -BaseUrl http://127.0.0.1:8082 -IncludeMutating
```

Expected result: all checks pass and no `500` for full body or PDF export endpoints.
