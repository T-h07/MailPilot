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

## Database schema

Flyway migrations are versioned in `mailpilot-server/src/main/resources/db/migration`:
- `V1__baseline.sql`
- `V2__core_schema.sql` (accounts/messages/views/followups/tags + indexes)

If you need to fully reset local DB and re-apply migrations:
```powershell
docker compose down
docker volume rm mailpilot_mailpilot_pg
docker compose up -d
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

The desktop now queries the backend API directly (`http://127.0.0.1:8082` by default; override with `VITE_API_BASE`).

## Run full stack (dev)

1. Start Postgres
```powershell
docker compose up -d
```

2. Start backend (dev profile)
```powershell
cd mailpilot-server
.\mvnw.cmd "-Dspring-boot.run.profiles=dev" spring-boot:run
```

3. Seed dev data
```powershell
irm -Method Post http://127.0.0.1:8082/api/dev/seed
```

4. Start desktop
```powershell
cd ..\mailpilot-desktop
npm install
npm run tauri dev
```

Quick checks:
```powershell
irm http://127.0.0.1:8082/api/health
irm -Method Post http://127.0.0.1:8082/api/dev/seed
```

## Followups + Focus API

Key endpoints:
- `GET /api/followups/{messageId}`
- `PUT /api/followups/{messageId}`
- `POST /api/followups/{messageId}/actions`
- `GET /api/focus/summary`
- `GET /api/focus/queue?type=NEEDS_REPLY|OVERDUE|DUE_TODAY|SNOOZED|ALL_OPEN&pageSize=50&cursor=...`

Quick test flow:
```powershell
# seed once
irm -Method Post http://127.0.0.1:8082/api/dev/seed

# get a message id
$q = @{
  sort = "RECEIVED_DESC"
  pageSize = 10
  cursor = $null
} | ConvertTo-Json
$item = irm -Method Post -Uri http://127.0.0.1:8082/api/mailbox/query -ContentType "application/json" -Body $q
$messageId = $item.items[0].id

# inspect + update followup
irm http://127.0.0.1:8082/api/followups/$messageId
irm -Method Put -Uri http://127.0.0.1:8082/api/followups/$messageId -ContentType "application/json" -Body (@{
  status = "OPEN"
  needsReply = $true
  dueAt = (Get-Date).AddHours(6).ToString("o")
  snoozedUntil = $null
} | ConvertTo-Json)

# check focus summary + queue
irm http://127.0.0.1:8082/api/focus/summary
irm "http://127.0.0.1:8082/api/focus/queue?type=NEEDS_REPLY&pageSize=20"
```

Desktop verification:
- Open `/focus` in the desktop app.
- Validate KPI counts and queue tabs.
- Use row actions or PreviewPanel followup controls and confirm KPI/queue refresh.

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

### Required scopes for MP-PT10
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

### Run (dev)
1. Start Postgres:
```powershell
docker compose up -d
```
2. Start server in dev profile:
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
4. In Settings, click `Connect Gmail`.

### Common pitfalls
- Consent screen in `Testing` mode requires adding Gmail accounts as Test users.
- Redirect URI must match exactly:
  `http://127.0.0.1:8082/api/oauth/gmail/callback`
- In dev, OAuth requests use `prompt=consent` to increase refresh token issuance reliability.
