# MailPilot

MailPilot is a desktop-first email cockpit for triaging Gmail accounts across Inbox, Views, Focus, Sent, Drafts, Dashboard, and Insights.  
It combines a local desktop UI with a Spring Boot backend and Postgres storage so workflows remain fast, searchable, and exportable.

## Tech Stack

- Desktop: Tauri + React + TypeScript + Vite + Tailwind + shadcn + Recharts
- Backend: Spring Boot (Java 21) + PostgreSQL
- Infra: Docker Compose (local Postgres)
- Provider: Gmail OAuth + Gmail API

## Repository Structure

```text
MailPilot/
├─ mailpilot-server/     # Spring Boot backend API + sync/export services
├─ mailpilot-desktop/    # Tauri desktop app (React/TS)
├─ infra/                # Infra assets (if present)
├─ docs/                 # Runbooks, release docs, policies
├─ tools/                # Helper scripts and optional hooks
└─ docker-compose.yml    # Local Postgres service
```

## Prerequisites

- Node.js LTS (18+ recommended)
- Java 21
- Docker Desktop
- Rust toolchain (`rustup`) for Tauri builds
- Windows WebView2 runtime
- Microsoft Visual C++ build tools (for native desktop builds)

## Quickstart (Dev, PowerShell)

1) Start Postgres:

```powershell
cd $env:USERPROFILE\Documents\MailPilot
docker compose up -d
docker ps
```

2) Start backend (dev profile):

```powershell
cd $env:USERPROFILE\Documents\MailPilot\mailpilot-server
.\mvnw.cmd "-Dspring-boot.run.profiles=dev" spring-boot:run
```

3) Start desktop:

```powershell
cd $env:USERPROFILE\Documents\MailPilot\mailpilot-desktop
npm install
npm run tauri dev
```

4) In app:

- Open `Settings` -> `Connect Gmail`
- Complete OAuth
- Trigger `Sync` / `Sync all`
- Open Inbox or Views

## Build (Local)

Backend:

```powershell
cd $env:USERPROFILE\Documents\MailPilot\mailpilot-server
.\mvnw.cmd test
```

Desktop:

```powershell
cd $env:USERPROFILE\Documents\MailPilot\mailpilot-desktop
npm ci
npm run build
```

## Release (High Level)

- Ensure `main` is green (`mvn test`, `npm run build`)
- Validate Docker + migrations on a fresh local volume
- Smoke test sync, export, and account actions
- Tag release with SemVer (`vX.Y.Z`)
- See [docs/release-checklist.md](docs/release-checklist.md)
- Versioning reference: [docs/versioning.md](docs/versioning.md)

## Secrets and Local Files

OAuth client JSON example path:

```text
C:\Users\taulanth\AppData\Local\MailPilot\google-oauth-client.json
```

Environment variables:

- `MAILPILOT_GOOGLE_OAUTH_CLIENT_JSON`
- `MAILPILOT_TOKEN_KEY_B64`

Never commit:

- OAuth client secrets
- Access/refresh tokens
- Local cache content
- `.env` files containing secrets

Local cache path (example):

```text
%LOCALAPPDATA%\MailPilot\cache
```

## Feature Map

- Inbox, Views, Focus queues
- Sent page and Drafts page
- Dashboard (now metrics) + Insights (range trends)
- Sender highlights and per-view labels
- Full body loading + Open in Gmail
- PDF export and attachment download

## Troubleshooting

Connected account but no emails:

- Trigger sync from Settings
- Check `/api/sync/status`
- Confirm account state is `CONNECTED`

Wrong timestamps/classification:

- Run sync again
- If available in your build, use metadata repair endpoint in dev tools

PDF export issues:

- Check server logs first
- Validate desktop save permissions in Tauri capabilities
- Re-test with known good message/thread IDs

`fs:write_file not allowed` (desktop export/save):

- Verify `mailpilot-desktop/src-tauri/capabilities/default.json` allows save dialog and file writes

Docker issues:

- Check current context: `docker context show`
- Switch context if needed: `docker context use default`
- Restart stack: `docker compose down; docker compose up -d`

## Dev Scripts and Hooks

- Dependency drift guard:
  - `powershell -ExecutionPolicy Bypass -File .\tools\check-clean.ps1`
- Dev convenience scripts:
  - `.\tools\dev-up.ps1`
  - `.\tools\dev-down.ps1`
  - `.\tools\reset-db.ps1`
- Optional pre-commit hooks:
  - `tools/hooks/pre-commit`
  - `tools/hooks/pre-commit.ps1`

Details:

- [docs/dependency-discipline.md](docs/dependency-discipline.md)
