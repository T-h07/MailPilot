# Release Smoke Checklist

Use this before shipping an installer build or tagging a release.

## 1) Workspace and Repo Hygiene

- Confirm branch and working tree are intentional: `git status`
- Run `powershell -ExecutionPolicy Bypass -File .\tools\check-clean.ps1`
- Confirm no local OAuth JSON, token key files, logs, or build artifacts are tracked

## 2) Backend Checks

```powershell
cd $env:USERPROFILE\Documents\MailPilot\mailpilot-server
.\mvnw.cmd spotless:check
.\mvnw.cmd test
```

## 3) Desktop Checks

```powershell
cd $env:USERPROFILE\Documents\MailPilot\mailpilot-desktop
npm ci
npm run format:check
npm run lint:ci
npm run build
npm run tauri:build
```

## 4) Installed-App Smoke Test

- Launch the packaged desktop app
- Confirm onboarding state loads
- Connect or reconnect Gmail successfully
- Open Inbox, message detail, and full body without 500s
- Verify attachment metadata and download behavior
- Check send/recovery/account capability status messaging
- Verify Focus, Dashboard, and Insights load without API failure
- Check `%LOCALAPPDATA%\MailPilot\logs` for unexpected errors

## 5) Release Safety

- No critical 500s in smoke flows
- No secrets or machine-local files in the commit
- README and docs still match the current build/run flow
