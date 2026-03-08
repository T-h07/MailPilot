# MailPilot Desktop

Tauri + React desktop client for MailPilot.

## Requirements

- Node.js LTS
- Rust toolchain (`rustup`)
- Java 21+ available on `PATH` or `JAVA_HOME` for the bundled Spring backend
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
npm.cmd run format:check
npm.cmd run lint:ci
npm.cmd run build
```

## Building MailPilot for Windows

Use the Tauri production build from PowerShell:

```powershell
cd $env:USERPROFILE\Documents\MailPilot\mailpilot-desktop
npm.cmd run tauri build
```

This build now stages and bundles the Spring backend automatically:

- frontend assets are built from `mailpilot-desktop`
- the backend is packaged from `mailpilot-server` into `mailpilot-server.jar`
- the installer includes that backend JAR and the desktop app auto-starts it on launch

Installer output is written under:

- `mailpilot-desktop\src-tauri\target\release\bundle\msi\`
- `mailpilot-desktop\src-tauri\target\release\bundle\nsis\`

Typical installer filenames are:

- `MailPilot_<version>_x64_en-US.msi`
- `MailPilot_<version>_x64-setup.exe`

Bundled backend resource staged during build:

- `mailpilot-desktop\src-tauri\resources\backend\mailpilot-server.jar`

If PowerShell blocks `npm.ps1` with an execution-policy error, use `npm.cmd` instead of `npm` for all desktop commands.

If the installed app opens but cannot reach its backend, check:

- Java 21+ is installed and available on `PATH` or `JAVA_HOME`
- backend logs under `%LOCALAPPDATA%\MailPilot\logs\backend.out.log`
- backend error logs under `%LOCALAPPDATA%\MailPilot\logs\backend.err.log`

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
