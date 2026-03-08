# Code Hardening Notes

## Fragile Zones Cleaned Up

- Gmail MIME parsing no longer lives partly in sync and partly in message detail loading.
- Attachment metadata persistence no longer exists in duplicate sync/detail code paths.
- Gmail scope and reconnect capability checks no longer diverge across account, send, recovery, and OAuth services.
- Frontend Gmail OAuth polling/open-browser logic is no longer copied across onboarding, settings, drafts, mailbox, and recovery pages.
- Mailbox shell no longer mixes UI state with all of its message/account mapping helpers.
- API timeout, abort, JSON, blob, and binary handling now run through one request path.

## Shared Backend Modules

- `mailpilot-server/src/main/java/com/mailpilot/service/gmail/GmailMimeParser.java`
  - Canonical Gmail MIME header parsing
  - Preferred body extraction
  - Attachment discovery
  - Inline attachment payload matching

- `mailpilot-server/src/main/java/com/mailpilot/service/AttachmentMetadataService.java`
  - Downloadable attachment extraction from Gmail payloads
  - Attachment metadata upsert/delete rules
  - Stored attachment list loading

- `mailpilot-server/src/main/java/com/mailpilot/service/gmail/GmailApiExecutor.java`
  - Shared Gmail API execution with access-token refresh retry

- `mailpilot-server/src/main/java/com/mailpilot/service/oauth/GmailScopeService.java`
  - Gmail read/send scope detection
  - Reconnect-required status evaluation

## Shared Frontend Modules

- `mailpilot-desktop/src/api/client.ts`
  - Single request pipeline for JSON, blob, and binary flows
  - Central timeout/abort/error normalization

- `mailpilot-desktop/src/lib/oauth/gmail-oauth-flow.ts`
  - Browser open helper
  - Shared OAuth polling/wait logic

- `mailpilot-desktop/src/features/mailbox/lib/mailbox-shell-helpers.ts`
  - Mailbox message/account/view mapping helpers
  - Preview-message reconciliation
  - Filename/export helpers

- `mailpilot-desktop/src/utils/api-error.ts`
  - Shared user-facing API error extraction

## Where To Extend Next

- Gmail parsing/full body:
  - Extend `GmailMimeParser`

- Attachment discovery or metadata rules:
  - Extend `AttachmentMetadataService`

- Gmail reconnect/send capability behavior:
  - Extend `GmailScopeService`

- Gmail OAuth flows in the desktop UI:
  - Reuse `gmail-oauth-flow.ts`

- Mailbox message shaping or optimistic reconciliation:
  - Start in `mailbox-shell-helpers.ts` before adding logic back into `MailboxShell.tsx`

- API request behavior:
  - Extend `src/api/client.ts` instead of adding direct `fetch` calls in pages/components
