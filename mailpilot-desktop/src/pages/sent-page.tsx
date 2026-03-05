import { MailboxShell } from "@/features/mailbox/components/MailboxShell";

export function SentPage() {
  return (
    <MailboxShell
      context="sent"
      forcedMailboxMode="SENT"
      subtitleOverride="Unified sent mail across connected accounts."
      titleOverride="Sent"
      view={null}
    />
  );
}
