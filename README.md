# MailPilot

## Backend (Spring Boot)

### Prereqs
- Docker Desktop running
- Java 21 installed

### Run DB
```powershell
docker compose up -d
docker ps
```
Expected container includes `mailpilot-db`.

### Run server (dev profile)
```powershell
cd mailpilot-server
.\mvnw.cmd "-Dspring-boot.run.profiles=dev" spring-boot:run
```

### Verify
```powershell
irm http://127.0.0.1:8082/api/health
irm http://127.0.0.1:8082/api/db/ping
```

Optional actuator:
```powershell
irm http://127.0.0.1:8082/actuator/health
```

## Desktop (Tauri)

### Prerequisites
- Node.js LTS
- Rust toolchain (`rustup`)
- Windows WebView2 runtime (usually already installed)
- Microsoft Visual C++ Build Tools (MSVC) for Tauri native builds

### Run (development)
```powershell
cd mailpilot-desktop
npm install
npm run tauri dev
```

The desktop queries the backend API directly (`http://127.0.0.1:8082` by default; override with `VITE_API_BASE`).

## MP-PT10: Gmail OAuth Setup

Google OAuth Desktop client JSON location (Windows dev default):

```text
C:\Users\taulanth\AppData\Local\MailPilot\google-oauth-client.json
```

### Google Cloud Console prerequisites (manual)
1. Create or select a Google Cloud project.
2. Enable Gmail API for that project.
3. Configure OAuth consent screen (Branding + Audience).
4. If Audience is `External`, add your Gmail account as a Test user.
5. Create OAuth client with Application type `Desktop app`.
6. Download JSON and place it at:
   `C:\Users\taulanth\AppData\Local\MailPilot\google-oauth-client.json`

### Required scopes for MP-PT10/MP-PT11
- `openid`
- `email`
- `profile`
- `https://www.googleapis.com/auth/gmail.readonly`

### Environment variables (PowerShell)
```powershell
$env:MAILPILOT_GOOGLE_OAUTH_CLIENT_JSON="C:\Users\taulanth\AppData\Local\MailPilot\google-oauth-client.json"
$env:MAILPILOT_TOKEN_KEY_B64="(base64 32-byte key)"
```

If `MAILPILOT_TOKEN_KEY_B64` is missing in `dev`, the server generates a key file at:
`C:\Users\taulanth\AppData\Local\MailPilot\token_key.b64`
and logs an instruction to set the env var from that file value.

### OAuth pitfalls
- Consent screen in `Testing` mode requires adding Gmail accounts as Test users.
- Redirect URI must match exactly:
  `http://127.0.0.1:8082/api/oauth/gmail/callback`
- OAuth requests include `prompt=consent` in dev to improve refresh token issuance.

## MP-PT11: Gmail Sync

### Prerequisites
- MP-PT10 OAuth setup complete.
- At least one Gmail account connected in Settings.

### Run flow (dev)
1. Start Postgres:
```powershell
docker compose up -d
```
2. Start backend in dev profile:
```powershell
cd mailpilot-server
.\mvnw.cmd "-Dspring-boot.run.profiles=dev" spring-boot:run
```
3. Start desktop:
```powershell
cd ..\mailpilot-desktop
npm install
npm run tauri dev
```
4. Open Settings and click `Connect Gmail` (if not connected yet).
5. Click `Sync all accounts` or `Sync` on a specific account.
6. Open Inbox/Views; mailbox now renders real Gmail metadata from the database.

### Sync endpoints
- `POST /api/sync/gmail/{accountId}/run?maxMessages=500`
- `POST /api/sync/gmail/run?maxMessages=500`
- `GET /api/sync/status`

### Troubleshooting
- `401` from Gmail API:
  - Token refresh is attempted automatically.
  - If refresh fails, reconnect Gmail to obtain a fresh refresh token.
- `historyId` too old/invalid:
  - Sync falls back to bounded bootstrap (metadata-first).
- `429` or `5xx` from Gmail:
  - Sync retries with exponential backoff.

## Live updates (MP-PT12)

MailPilot now streams live backend events over Server-Sent Events (SSE):

- `GET /api/events/stream`
- event types:
  - `heartbeat`
  - `badge_update`
  - `sync_status`
  - `new_mail`

Badges are server-side truth and are based on:

- `messages.created_at` (ingested into MailPilot time, not Gmail received time)
- `mailbox_seen.last_opened_at` for keys:
  - `INBOX`
  - `VIEW:<viewId>`

When Inbox or a View is opened, the app calls:

- `POST /api/badges/inbox/opened`
- `POST /api/badges/views/{viewId}/opened`

and receives updated badge state through SSE.

### MP-PT12 troubleshooting

- If badges/status do not update live:
  - verify backend is running and reachable from desktop dev origin.
  - verify `http://127.0.0.1:8082/api/events/stream` is reachable.
  - check browser/devtools network tab for an active `text/event-stream` request.
- If SSE disconnects:
  - desktop falls back to periodic polling (`/api/badges/summary`, `/api/sync/status`) until reconnect.

## Search (MP-PT13)

Mailbox search now uses PostgreSQL full-text search (FTS) with an indexed `messages.search_vector` column.
Search covers sender, subject, and snippet with weighted ranking:

- A: `subject`
- B: `sender_name`, `sender_email`
- C: `sender_domain`
- D: `snippet`

Results are sorted by `rank DESC`, then `received_at DESC`, then `id DESC`.

### Run and verify
1. Ensure DB has real messages (connect Gmail + sync).
2. Start backend and desktop as usual.
3. Type in the mailbox search input.
4. Confirm results return quickly and relevant matches appear near the top.

Dev diagnostic endpoint:

- `GET /api/search/health?q=invoice`

Expected shape:

```json
{
  "configured": true,
  "method": "fts",
  "matches": 123
}
```

Optional Postgres check (dev):

```powershell
docker exec -it mailpilot-db psql -U mailpilot -d mailpilot -c "EXPLAIN ANALYZE SELECT id FROM messages WHERE search_vector @@ websearch_to_tsquery('simple', 'invoice') LIMIT 20;"
```

### Troubleshooting
- If search returns zero unexpectedly:
  - confirm Gmail sync has inserted messages.
  - confirm migration `V9__messages_fts.sql` applied.
  - call `/api/search/health?q=test` and verify `configured=true`.
- If parsing errors occur with unusual query text:
  - backend automatically falls back from `websearch_to_tsquery` to `plainto_tsquery`, then to ILIKE as a last resort.

## Exports & attachments (MP-PT14)

MailPilot now supports:

- Attachment download by internal attachment ID:
  - `GET /api/attachments/{attachmentId}/download`
- Export single email to PDF:
  - `GET /api/messages/{messageId}/export/pdf`
- Export whole thread to PDF:
  - `GET /api/threads/{threadId}/export/pdf`

### Behavior
- Attachments are fetched from Gmail on demand using the stored OAuth tokens.
- Backend returns binary bytes with `Content-Disposition` filename.
- Desktop Preview panel provides:
  - `Download` button per attachment row.
  - `Export Email to PDF` and `Export Thread to PDF` in the overflow menu.

### Attachment cache
- Downloaded attachment bytes are cached server-side under:
  - `%LOCALAPPDATA%\\MailPilot\\cache\\attachments`
- Override root cache dir with:
  - `mailpilot.cacheDir`

### Quick test flow
1. Open a synced message with attachment metadata in Preview.
2. Click `Download` on an attachment and save it locally.
3. Use `Export Email to PDF`, then `Export Thread to PDF`.
4. Confirm files open successfully.

## Reset local DB (remove old demo rows)

If you previously used seed/demo data in older milestones, reset the local DB volume:

```powershell
docker compose down
docker volume rm mailpilot_mailpilot_pg
docker compose up -d
```

Then rerun server + desktop and sync Gmail again.
