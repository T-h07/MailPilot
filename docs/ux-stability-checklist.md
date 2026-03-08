# UX Stability Checklist

## Screens audited

- Startup and backend loading shell
- Login, lock, and password recovery
- Onboarding Gmail connect and recommended views
- Inbox, sent, view mailboxes, preview, full-body, and attachments
- Focus, dashboard, and insights
- Accounts, settings, views hub, and drafts

## Common UX issues fixed

- Replaced weak text-only loading, empty, and error blocks with shared state panels
- Improved startup recovery with retry, log access, and app-data access
- Unified login, lock, and recovery shells so they explain local password and recovery behavior
- Improved mailbox preview guidance for full-body loading, attachment empties, and detail refresh errors
- Reduced misleading analytics zero states during first load by showing deliberate loading placeholders
- Improved settings, drafts, and views management empty/error messaging

## Verify before release

- Startup reaches the app shell without vague waiting states
- Startup failures expose Retry, Open Logs, and Open App Data actions
- Login and lock screens clearly describe the local-password model
- Recovery flow loads, sends code, and shows actionable unavailable states
- Inbox and sent mailboxes show deliberate loading, empty, and mailbox-error states
- Preview handles full-body load failures and attachment empties cleanly
- Focus, dashboard, and insights show useful states during load, refresh, and failure
- Settings, drafts, and views hub do not leave users in blank or dead-end states

## Packaged-app trust checks

- Launch the installed app and confirm the startup shell shows purposeful progress
- If startup fails, confirm logs open from `%LOCALAPPDATA%\\MailPilot\\logs`
- Confirm app data folder opens from the startup recovery screen
- Verify attachment download and export flows still surface native save dialogs
- Verify packaged mode does not expose dev-style raw errors or blank panels
