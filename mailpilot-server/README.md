# MailPilot Server

Spring Boot backend for MailPilot desktop.

## Requirements

- Java 21
- Docker Desktop (for local Postgres)

## Run (Dev)

```powershell
cd $env:USERPROFILE\Documents\MailPilot
docker compose up -d

cd .\mailpilot-server
.\mvnw.cmd "-Dspring-boot.run.profiles=dev" spring-boot:run
```

Server default URL: `http://127.0.0.1:8082`

Health checks:

```powershell
irm http://127.0.0.1:8082/api/health
irm http://127.0.0.1:8082/api/db/ping
```

## Test

```powershell
cd $env:USERPROFILE\Documents\MailPilot\mailpilot-server
.\mvnw.cmd test
```

## Main Functional Areas

- Gmail OAuth and token management
- Gmail sync + mailbox query APIs
- Message details, followups, labels, views
- Dashboard/Insights metrics
- Attachment download and PDF exports

## Logging and Security Notes

- Do not log tokens, OAuth secrets, auth headers, or raw message bodies.
- Prefer structured errors in JSON shape for API failures.
- Keep production secrets out of repository and shell history.

