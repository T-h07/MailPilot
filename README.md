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
