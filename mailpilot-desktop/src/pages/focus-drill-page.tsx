import { Navigate, useParams } from "react-router-dom";
import { MailboxShell } from "@/features/mailbox/components/MailboxShell";

type DrillConfig = {
  title: string;
  subtitle: string;
  forcedFilters?: {
    needsReply?: boolean;
    overdue?: boolean;
    dueToday?: boolean;
    snoozed?: boolean;
    allOpen?: boolean;
  };
};

function resolveDrillConfig(type: string | undefined): DrillConfig | null {
  if (!type) {
    return null;
  }
  switch (type.toLowerCase()) {
    case "needs-reply":
      return {
        title: "Focus Drilldown · Needs reply",
        subtitle: "Mailbox view filtered to open followups that need a reply.",
        forcedFilters: { needsReply: true },
      };
    case "overdue":
      return {
        title: "Focus Drilldown · Overdue",
        subtitle: "Mailbox view filtered to overdue open followups.",
        forcedFilters: { overdue: true },
      };
    case "due-today":
      return {
        title: "Focus Drilldown · Due today",
        subtitle: "Mailbox view filtered to followups due today.",
        forcedFilters: { dueToday: true },
      };
    case "snoozed":
      return {
        title: "Focus Drilldown · Snoozed",
        subtitle: "Mailbox view filtered to currently snoozed followups.",
        forcedFilters: { snoozed: true },
      };
    case "all-open":
      return {
        title: "Focus Drilldown · All open",
        subtitle: "Mailbox view filtered to all open followups.",
        forcedFilters: { allOpen: true },
      };
    default:
      return null;
  }
}

export function FocusDrillPage() {
  const { type } = useParams<{ type: string }>();
  const config = resolveDrillConfig(type);

  if (!config) {
    return <Navigate replace to="/focus" />;
  }

  return (
    <MailboxShell
      context="inbox"
      forcedFilters={config.forcedFilters}
      hideAccountScope
      subtitleOverride={config.subtitle}
      titleOverride={config.title}
      view={null}
    />
  );
}
