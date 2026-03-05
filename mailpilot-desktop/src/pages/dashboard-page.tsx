import { type ComponentType, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  BellRing,
  CalendarClock,
  Crown,
  Inbox,
  MessageSquareReply,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type AccountRecord, listAccounts } from "@/lib/api/accounts";
import { ApiClientError } from "@/lib/api/client";
import { getDashboardSummary, type DashboardSummary } from "@/lib/api/dashboard";
import { runAllAccountsSync } from "@/lib/api/sync";
import { useLiveEvents } from "@/lib/events/live-events-context";
import { cn } from "@/lib/utils";

type DriverItem = {
  key: string;
  label: string;
  count: number;
  onClick: () => void;
};

type DrilldownParams = {
  unread?: boolean;
  needsReply?: boolean;
  overdue?: boolean;
  dueToday?: boolean;
  snoozed?: boolean;
  allOpen?: boolean;
  senderDomains?: string[];
  senderEmails?: string[];
  accountIds?: string[];
};

function toErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Request failed";
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "--";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return date.toLocaleString();
}

function formatPercent(value: number): string {
  const rounded = Math.abs(value) >= 10 ? value.toFixed(0) : value.toFixed(1);
  return `${value >= 0 ? "+" : ""}${rounded}%`;
}

function formatSignedDelta(value: number): string {
  return `${value >= 0 ? "+" : ""}${value}`;
}

function dashboardCardTone(tone: "neutral" | "attention" | "critical" | "calm" | "boss") {
  switch (tone) {
    case "critical":
      return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-200";
    case "attention":
      return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200";
    case "calm":
      return "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-200";
    case "boss":
      return "border-yellow-500/35 bg-yellow-500/10 text-yellow-800 dark:text-yellow-200";
    case "neutral":
    default:
      return "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-200";
  }
}

function buildInboxDrilldownPath(params: DrilldownParams): string {
  const searchParams = new URLSearchParams();
  if (params.unread) {
    searchParams.set("unread", "1");
  }
  if (params.needsReply) {
    searchParams.set("needsReply", "1");
  }
  if (params.overdue) {
    searchParams.set("overdue", "1");
  }
  if (params.dueToday) {
    searchParams.set("dueToday", "1");
  }
  if (params.snoozed) {
    searchParams.set("snoozed", "1");
  }
  if (params.allOpen) {
    searchParams.set("allOpen", "1");
  }
  for (const domain of params.senderDomains ?? []) {
    searchParams.append("senderDomain", domain);
  }
  for (const sender of params.senderEmails ?? []) {
    searchParams.append("senderEmail", sender);
  }
  for (const accountId of params.accountIds ?? []) {
    searchParams.append("accountId", accountId);
  }
  const query = searchParams.toString();
  return query.length > 0 ? `/inbox?${query}` : "/inbox";
}

function DriverList({
  emptyLabel,
  items,
  title,
}: {
  emptyLabel: string;
  items: DriverItem[];
  title: string;
}) {
  const maxCount = Math.max(1, ...items.map((item) => item.count));

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold">{title}</p>
      {items.length === 0 && (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      )}
      {items.map((item) => {
        const width = Math.max(8, Math.round((item.count / maxCount) * 100));
        return (
          <button
            className="w-full space-y-1 rounded-md p-1 text-left transition-colors hover:bg-accent"
            key={item.key}
            onClick={item.onClick}
            type="button"
          >
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-muted-foreground">{item.label}</span>
              <span className="font-medium text-foreground">{item.count}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded bg-muted">
              <div className="h-full rounded bg-primary/70" style={{ width: `${width}%` }} />
            </div>
          </button>
        );
      })}
    </div>
  );
}

function KpiTile({
  icon: Icon,
  label,
  subtitle,
  value,
  delta,
  tone,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  subtitle: string;
  value: number;
  delta: string;
  tone: "neutral" | "attention" | "critical" | "calm" | "boss";
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "rounded-xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm",
        dashboardCardTone(tone),
      )}
      onClick={onClick}
      type="button"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide">{label}</p>
          <p className="pt-1 text-3xl font-semibold leading-none">{value.toLocaleString()}</p>
        </div>
        <Icon className="h-5 w-5" />
      </div>
      <p className="pt-2 text-xs opacity-90">{delta}</p>
      <p className="pt-1 text-xs opacity-70">{subtitle}</p>
      <p className="pt-2 text-[11px] font-medium opacity-85">Click to open filtered mailbox</p>
    </button>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { refreshSyncStatus, sseConnected, syncByAccountId } = useLiveEvents();

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncingNow, setIsSyncingNow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoNotice, setInfoNotice] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const openDrilldown = useCallback(
    (params: DrilldownParams) => {
      navigate(buildInboxDrilldownPath(params));
    },
    [navigate],
  );

  const loadDashboard = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [summaryResponse, accountsResponse] = await Promise.all([
        getDashboardSummary(),
        listAccounts(),
        refreshSyncStatus(),
      ]);
      setSummary(summaryResponse);
      setAccounts(accountsResponse);
    } catch (loadError) {
      setError(toErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }, [refreshSyncStatus]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (!autoRefresh) {
      return;
    }
    const intervalId = window.setInterval(() => {
      void loadDashboard();
    }, 30000);
    return () => window.clearInterval(intervalId);
  }, [autoRefresh, loadDashboard]);

  const handleBossDrilldown = useCallback(() => {
    if (!summary) {
      return;
    }
    const domains = summary.bossSenderDomains ?? [];
    const emails = summary.bossSenderEmails ?? [];
    if (domains.length === 0 && emails.length === 0) {
      setInfoNotice("No BOSS rules configured.");
      return;
    }
    setInfoNotice(null);
    openDrilldown({
      unread: true,
      senderDomains: domains,
      senderEmails: emails,
    });
  }, [openDrilldown, summary]);

  const handleSyncNow = useCallback(async () => {
    setIsSyncingNow(true);
    setInfoNotice(null);
    try {
      await runAllAccountsSync();
      setInfoNotice("Sync started for connected accounts.");
      await loadDashboard();
    } catch (syncError) {
      setError(toErrorMessage(syncError));
    } finally {
      setIsSyncingNow(false);
    }
  }, [loadDashboard]);

  const syncRows = useMemo(() => {
    return accounts.map((account) => ({
      account,
      syncState: syncByAccountId[account.id] ?? null,
    }));
  }, [accounts, syncByAccountId]);

  const topDomainsUnread = useMemo<DriverItem[]>(() => {
    return (summary?.topDomainsUnread ?? []).map((item) => ({
      key: item.domain,
      label: item.domain,
      count: item.count,
      onClick: () => openDrilldown({ unread: true, senderDomains: [item.domain] }),
    }));
  }, [openDrilldown, summary]);

  const topSendersUnread = useMemo<DriverItem[]>(() => {
    return (summary?.topSendersUnread ?? []).map((item) => ({
      key: item.email,
      label: item.email,
      count: item.count,
      onClick: () => openDrilldown({ unread: true, senderEmails: [item.email] }),
    }));
  }, [openDrilldown, summary]);

  const unreadByAccount = useMemo<DriverItem[]>(() => {
    return (summary?.unreadByAccount ?? []).map((item) => ({
      key: item.accountId,
      label: item.email,
      count: item.count,
      onClick: () => openDrilldown({ unread: true, accountIds: [item.accountId] }),
    }));
  }, [openDrilldown, summary]);

  const topDomainsLast24h = useMemo<DriverItem[]>(() => {
    return (summary?.topDomainsReceived24h ?? []).map((item) => ({
      key: item.domain,
      label: item.domain,
      count: item.count,
      onClick: () => openDrilldown({ senderDomains: [item.domain] }),
    }));
  }, [openDrilldown, summary]);

  const topSendersLast24h = useMemo<DriverItem[]>(() => {
    return (summary?.topSendersReceived24h ?? []).map((item) => ({
      key: item.email,
      label: item.email,
      count: item.count,
      onClick: () => openDrilldown({ senderEmails: [item.email] }),
    }));
  }, [openDrilldown, summary]);

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Live cockpit for actionable mailbox pressure, trends, and top contributors.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setAutoRefresh((previous) => !previous)}
            size="sm"
            variant={autoRefresh ? "secondary" : "outline"}
          >
            {autoRefresh ? "Auto refresh: On" : "Auto refresh: Off"}
          </Button>
          <Button disabled={isLoading} onClick={() => void loadDashboard()} size="sm" variant="outline">
            {isLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Refresh"}
          </Button>
        </div>
      </div>

      {(error || infoNotice) && (
        <Card>
          <CardContent className="p-4 text-sm">
            {error && <p className="text-destructive">{error}</p>}
            {!error && infoNotice && <p className="text-muted-foreground">{infoNotice}</p>}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <KpiTile
          delta={`${formatSignedDelta(summary?.unreadDelta ?? 0)} vs prior 24h`}
          icon={Inbox}
          label="Unread"
          onClick={() => openDrilldown({ unread: true })}
          subtitle="Inbox unread load"
          tone={(summary?.unreadTotal ?? 0) > 200 ? "attention" : "neutral"}
          value={summary?.unreadTotal ?? 0}
        />
        <KpiTile
          delta={`${formatSignedDelta(summary?.needsReplyDelta ?? 0)} vs prior 24h`}
          icon={MessageSquareReply}
          label="Needs reply"
          onClick={() => openDrilldown({ needsReply: true })}
          subtitle="Open followups"
          tone="attention"
          value={summary?.needsReplyOpen ?? 0}
        />
        <KpiTile
          delta={`${formatSignedDelta(summary?.overdueDelta ?? 0)} vs prior 24h`}
          icon={AlertTriangle}
          label="Overdue"
          onClick={() => openDrilldown({ overdue: true })}
          subtitle="Past due followups"
          tone="critical"
          value={summary?.overdue ?? 0}
        />
        <KpiTile
          delta="Due before midnight"
          icon={CalendarClock}
          label="Due today"
          onClick={() => openDrilldown({ dueToday: true })}
          subtitle="Today due queue"
          tone="attention"
          value={summary?.dueToday ?? 0}
        />
        <KpiTile
          delta={`${summary?.snoozedWakingNext24h ?? 0} wake in next 24h`}
          icon={BellRing}
          label="Snoozed"
          onClick={() => openDrilldown({ snoozed: true })}
          subtitle="Paused followups"
          tone="calm"
          value={summary?.snoozed ?? 0}
        />
        <KpiTile
          delta="Unread from BOSS rule set"
          icon={Crown}
          label="Unread BOSS"
          onClick={handleBossDrilldown}
          subtitle="Priority sender highlights"
          tone="boss"
          value={summary?.unreadBoss ?? 0}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Last 24h Intake
            </CardTitle>
            <CardDescription>Received now vs previous 24-hour window.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border border-border bg-card p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Received</p>
                <p className="pt-1 text-xl font-semibold">{summary?.receivedLast24h ?? 0}</p>
              </div>
              <div className="rounded-md border border-border bg-card p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Previous</p>
                <p className="pt-1 text-xl font-semibold">{summary?.receivedPrev24h ?? 0}</p>
              </div>
              <div className="rounded-md border border-border bg-card p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Delta</p>
                <p
                  className={cn(
                    "pt-1 text-xl font-semibold",
                    (summary?.receivedDeltaPct ?? 0) >= 0 ? "text-emerald-600" : "text-red-600",
                  )}
                >
                  {formatPercent(summary?.receivedDeltaPct ?? 0)}
                </p>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <DriverList
                emptyLabel="No domains in the last 24h."
                items={topDomainsLast24h}
                title="Top domains received (24h)"
              />
              <DriverList
                emptyLabel="No senders in the last 24h."
                items={topSendersLast24h}
                title="Top senders received (24h)"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Followup Health</CardTitle>
            <CardDescription>Open followup pressure and wakeups.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <button
              className="rounded-md border border-border bg-card p-3 text-left transition-colors hover:bg-accent"
              onClick={() => openDrilldown({ allOpen: true })}
              type="button"
            >
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Open followups</p>
              <p className="pt-1 text-2xl font-semibold">{summary?.openFollowupsTotal ?? 0}</p>
              <p className="pt-1 text-xs text-muted-foreground">Click to open all active followups</p>
            </button>
            <button
              className="rounded-md border border-border bg-card p-3 text-left transition-colors hover:bg-accent"
              onClick={() => openDrilldown({ snoozed: true })}
              type="button"
            >
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Snoozed waking soon</p>
              <p className="pt-1 text-2xl font-semibold">{summary?.snoozedWakingNext24h ?? 0}</p>
              <p className="pt-1 text-xs text-muted-foreground">Snoozed items waking in 24 hours</p>
            </button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Top Domains (Unread)</CardTitle>
            <CardDescription>Main unread drivers by sender domain.</CardDescription>
          </CardHeader>
          <CardContent>
            <DriverList
              emptyLabel="No unread domain concentration."
              items={topDomainsUnread}
              title="Domains"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top Senders (Unread)</CardTitle>
            <CardDescription>Main unread drivers by sender email.</CardDescription>
          </CardHeader>
          <CardContent>
            <DriverList
              emptyLabel="No unread sender concentration."
              items={topSendersUnread}
              title="Senders"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Unread by Account</CardTitle>
            <CardDescription>Where unread load is currently concentrated.</CardDescription>
          </CardHeader>
          <CardContent>
            <DriverList
              emptyLabel="No unread messages across accounts."
              items={unreadByAccount}
              title="Accounts"
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
          <div>
            <CardTitle>Freshness + Sync</CardTitle>
            <CardDescription>Connection state and last sync snapshot by account.</CardDescription>
          </div>
          <Button className="gap-2" disabled={isSyncingNow} onClick={() => void handleSyncNow()} size="sm" variant="outline">
            {isSyncingNow ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Sync now
          </Button>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={sseConnected ? "secondary" : "destructive"}>
              {sseConnected ? "SSE connected" : "SSE reconnecting"}
            </Badge>
            <Badge variant="outline">Last dashboard update: {formatTimestamp(summary?.lastUpdatedAt ?? null)}</Badge>
          </div>
          <div className="space-y-2">
            {syncRows.length === 0 && (
              <p className="text-muted-foreground">No connected accounts.</p>
            )}
            {syncRows.map((row) => (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card p-2" key={row.account.id}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{row.account.email}</p>
                  <p className="text-xs text-muted-foreground">
                    Last sync: {formatTimestamp(row.syncState?.lastSyncAt ?? row.account.lastSyncAt)}
                  </p>
                </div>
                <Badge
                  variant={
                    row.syncState?.state === "RUNNING"
                      ? "default"
                      : row.syncState?.state === "ERROR"
                        ? "destructive"
                        : "outline"
                  }
                >
                  {row.syncState?.state ?? "IDLE"}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
