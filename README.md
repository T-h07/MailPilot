# MailPilot

## Backend (Spring Boot)

### Prereqs
- Docker Desktop running
- Docker context should be default (optional)
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
.\mvnw spring-boot:run -Dspring-boot.run.profiles=dev
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

This starts the MailPilot desktop shell with mock mailbox data (virtualized list + preview panel) and no backend API calls.
