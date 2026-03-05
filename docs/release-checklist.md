# MailPilot Release Checklist

Use this before tagging and publishing a release from `main`.

## 1) Branch and Workspace

- Ensure branch is `main` and up to date
- Ensure working tree is clean (`git status`)
- Ensure no temporary debug changes are present

## 2) Build and Test

Backend:

```powershell
cd $env:USERPROFILE\Documents\MailPilot\mailpilot-server
.\mvnw.cmd test
```

Desktop:

```powershell
cd $env:USERPROFILE\Documents\MailPilot\mailpilot-desktop
npm ci
npm run lint
npm run format:check
npm run build
```

## 3) Secrets and Security Check

Confirm no secrets are committed:

- search for `client_secret`
- search for `refresh_token`
- search for OAuth JSON content
- verify local-only files are ignored

Example:

```powershell
git grep -n "client_secret\|refresh_token" .
```

## 4) Runtime Smoke Checks

- `docker compose up -d` works
- backend starts cleanly
- desktop starts and connects to backend
- Gmail connect + sync flow works on test account
- Inbox/View navigation works
- Dashboard/Insights render without API failures

## 5) Functional Safety Checks

- PDF export (message + thread) saves and opens
- attachment download works
- detach account purge still works
- sent/drafts/list routing still works

## 6) Migration Safety

- verify startup migration applies on fresh DB volume:

```powershell
docker compose down
docker volume rm mailpilot_mailpilot_pg
docker compose up -d
```

- start backend and confirm no Flyway errors

## 7) Tagging and Push

Follow SemVer tags (`vX.Y.Z`):

```powershell
git checkout main
git pull
git tag -a vX.Y.Z -m "MailPilot vX.Y.Z"
git push origin vX.Y.Z
```

Optionally create GitHub release notes from the tag.

## 8) Post-Release Notes

- record known issues and workarounds
- link this release to runbook updates
- update roadmap/tasks for next patch cycle

