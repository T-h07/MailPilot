import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { MailboxShell } from "@/features/mailbox/components/MailboxShell";

function parseBooleanParam(rawValue: string | null): boolean {
  if (!rawValue) {
    return false;
  }
  const normalized = rawValue.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parseMultiParam(searchParams: URLSearchParams, key: string): string[] {
  const collected = searchParams
    .getAll(key)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
  return Array.from(new Set(collected));
}

export function InboxPage() {
  const [searchParams] = useSearchParams();

  const forcedFilters = useMemo(() => {
    const senderDomains = parseMultiParam(searchParams, "senderDomain");
    const senderEmails = parseMultiParam(searchParams, "senderEmail");
    const accountIds = parseMultiParam(searchParams, "accountId");

    return {
      unreadOnly: parseBooleanParam(searchParams.get("unread")),
      needsReply: parseBooleanParam(searchParams.get("needsReply")),
      overdue: parseBooleanParam(searchParams.get("overdue")),
      dueToday: parseBooleanParam(searchParams.get("dueToday")),
      snoozed: parseBooleanParam(searchParams.get("snoozed")),
      allOpen: parseBooleanParam(searchParams.get("allOpen")),
      senderDomains,
      senderEmails,
      accountIds,
    };
  }, [searchParams]);

  const hasDrilldown = useMemo(
    () =>
      forcedFilters.unreadOnly ||
      forcedFilters.needsReply ||
      forcedFilters.overdue ||
      forcedFilters.dueToday ||
      forcedFilters.snoozed ||
      forcedFilters.allOpen ||
      forcedFilters.senderDomains.length > 0 ||
      forcedFilters.senderEmails.length > 0 ||
      forcedFilters.accountIds.length > 0,
    [forcedFilters]
  );

  return (
    <MailboxShell
      context="inbox"
      forcedFilters={hasDrilldown ? forcedFilters : undefined}
      subtitleOverride={
        hasDrilldown ? "Drilldown mailbox view from Dashboard/Insights filters." : undefined
      }
      titleOverride={hasDrilldown ? "Inbox Drilldown" : undefined}
      view={null}
    />
  );
}
