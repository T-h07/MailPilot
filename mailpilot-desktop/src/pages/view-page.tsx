import { useParams } from "react-router-dom";
import { MailboxShell } from "@/features/mailbox/components/MailboxShell";

export function ViewPage() {
  const { viewKey } = useParams();
  return <MailboxShell context="view" viewKey={viewKey} />;
}
