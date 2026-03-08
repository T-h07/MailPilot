# MailPilot Desktop

Tauri + React desktop client for MailPilot.

## Requirements

- Node.js LTS
- Rust toolchain (`rustup`)
- WebView2 runtime (Windows)
- MSVC build tools for native Tauri builds

## Run (Dev)

```powershell
cd $env:USERPROFILE\Documents\MailPilot\mailpilot-desktop
npm install
npm run tauri dev
```

Default backend target is `http://127.0.0.1:8082` (or `VITE_API_BASE` if configured).

## Build

```powershell
cd $env:USERPROFILE\Documents\MailPilot\mailpilot-desktop
npm ci
npm run lint
npm run build
```

## Environment Notes

- Keep secrets out of frontend source and commits.
- Desktop file save/export permissions are controlled by:
  - `src-tauri/capabilities/default.json`

## UI Areas

- Inbox, Views, Focus, Sent, Drafts
- Preview panel + full body viewer
- Dashboard and Insights analytics
- Settings and account management
