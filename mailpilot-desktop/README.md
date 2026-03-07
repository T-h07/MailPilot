# MailPilot Desktop

Tauri + React desktop client for MailPilot.

## Requirements

- Node.js LTS
- Rust toolchain (`rustup`)
- Microsoft C++ Build Tools with the `Desktop development with C++` workload
- Microsoft Edge WebView2 Runtime (the installer can bootstrap it if missing, but preinstalling it keeps setup predictable)

## Run (Dev)

```powershell
cd $env:USERPROFILE\Documents\MailPilot\mailpilot-desktop
npm.cmd install
npm.cmd run tauri dev
```

Default backend target is `http://127.0.0.1:8082` (or `VITE_API_BASE` if configured).

## Build

```powershell
cd $env:USERPROFILE\Documents\MailPilot\mailpilot-desktop
npm.cmd ci
npm.cmd run lint
npm.cmd run format:check
npm.cmd run build
```

## Building MailPilot for Windows

Use the Tauri production build from PowerShell:

```powershell
cd $env:USERPROFILE\Documents\MailPilot\mailpilot-desktop
npm.cmd run tauri build
```

Installer output is written under:

- `mailpilot-desktop\src-tauri\target\release\bundle\msi\`
- `mailpilot-desktop\src-tauri\target\release\bundle\nsis\`

Typical installer filenames are:

- `MailPilot_<version>_x64_en-US.msi`
- `MailPilot_<version>_x64-setup.exe`

If PowerShell blocks `npm.ps1` with an execution-policy error, use `npm.cmd` instead of `npm` for all desktop commands.

To build and optionally copy the newest installer to your Desktop:

```powershell
cd $env:USERPROFILE\Documents\MailPilot
.\tools\build-desktop.ps1
.\tools\build-desktop.ps1 -CopyToDesktop
```

The helper script prints the exact installer paths it finds and, with `-CopyToDesktop`, copies only the newest installer artifact to `$env:USERPROFILE\Desktop`.

## Environment Notes

- Keep secrets out of frontend source and commits.
- Desktop file save/export permissions are controlled by:
  - `src-tauri/capabilities/default.json`

## UI Areas

- Inbox, Views, Focus, Sent, Drafts
- Preview panel + full body viewer
- Dashboard and Insights analytics
- Settings and account management
