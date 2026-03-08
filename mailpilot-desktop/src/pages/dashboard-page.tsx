import { useCallback, useEffect, useMemo, useState } from "react";
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
import {
  DashboardDriverList,
  type DashboardDriverItem,
} from "@/components/dashboard/DashboardDriverList";
import { DashboardKpiTile } from "@/components/dashboard/DashboardKpiTile";
import { mapDashboardSparkline } from "@/components/dashboard/dashboard-kpi-sparkline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AccentCard } from "@/components/ui/AccentCard";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { type AccountRecord, listAccounts } from "@/lib/api/accounts";
import { getDashboardSummary, type DashboardSummary } from "@/lib/api/dashboard";
import { runAllAccountsSync } from "@/lib/api/sync";
import { useLiveEvents } from "@/lib/events/use-live-events";
import { cn } from "@/lib/utils";
import { toApiErrorMessage } from "@/utils/api-error";
import { buildInboxDrilldownPath, type InboxDrilldownParams } from "@/utils/mailbox-drilldown";
import { formatPercent, formatSignedDelta } from "@/utils/number-format";

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
    (params: InboxDrilldownParams) => {
      navigate(buildInboxDrilldownPath(params));
    },
    [navigate]
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
      setError(toApiErrorMessage(loadError));
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
      setError(toApiErrorMessage(syncError));
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

  const topDomainsUnread = useMemo<DashboardDriverItem[]>(() => {
    return (summary?.topDomainsUnread ?? []).map((item) => ({
      key: item.domain,
      label: item.domain,
      count: item.count,
      onClick: () => openDrilldown({ unread: true, senderDomains: [item.domain] }),
    }));
  }, [openDrilldown, summary]);

  const topSendersUnread = useMemo<DashboardDriverItem[]>(() => {
    return (summary?.topSendersUnread ?? []).map((item) => ({
      key: item.email,
      label: item.email,
      count: item.count,
      onClick: () => openDrilldown({ unread: true, senderEmails: [item.email] }),
    }));
  }, [openDrilldown, summary]);

  const unreadByAccount = useMemo<DashboardDriverItem[]>(() => {
    return (summary?.unreadByAccount ?? []).map((item) => ({
      key: item.accountId,
      label: item.email,
      count: item.count,
      onClick: () => openDrilldown({ unread: true, accountIds: [item.accountId] }),
    }));
  }, [openDrilldown, summary]);

  const topDomainsLast24h = useMemo<DashboardDriverItem[]>(() => {
    return (summary?.topDomainsReceived24h ?? []).map((item) => ({
      key: item.domain,
      label: item.domain,
      count: item.count,
      onClick: () => openDrilldown({ senderDomains: [item.domain] }),
    }));
  }, [openDrilldown, summary]);

  const topSendersLast24h = useMemo<DashboardDriverItem[]>(() => {
    return (summary?.topSendersReceived24h ?? []).map((item) => ({
      key: item.email,
      label: item.email,
      count: item.count,
      onClick: () => openDrilldown({ senderEmails: [item.email] }),
    }));
  }, [openDrilldown, summary]);

  const unreadSparkline = useMemo(
    () => mapDashboardSparkline(summary?.series7d, "unreadNow"),
    [summary?.series7d]
  );
  const needsReplySparkline = useMemo(
    () => mapDashboardSparkline(summary?.series7d, "needsReplyOpen"),
    [summary?.series7d]
  );
  const overdueSparkline = useMemo(
    () => mapDashboardSparkline(summary?.series7d, "overdue"),
    [summary?.series7d]
  );
  const dueTodaySparkline = useMemo(
    () => mapDashboardSparkline(summary?.series7d, "dueToday"),
    [summary?.series7d]
  );
  const snoozedSparkline = useMemo(
    () => mapDashboardSparkline(summary?.series7d, "snoozed"),
    [summary?.series7d]
  );
  const unreadBossSparkline = useMemo(
    () => mapDashboardSparkline(summary?.series7d, "unreadBoss"),
    [summary?.series7d]
  );

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
          <Button
            disabled={isLoading}
            onClick={() => void loadDashboard()}
            size="sm"
            variant="outline"
          >
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
        <DashboardKpiTile
          delta={`${formatSignedDelta(summary?.unreadDelta ?? 0)} vs prior 24h`}
          icon={Inbox}
          label="Unread"
          onClick={() => openDrilldown({ unread: true })}
          sparkline={unreadSparkline}
          subtitle="Inbox unread load"
          tone={(summary?.unreadTotal ?? 0) > 200 ? "attention" : "neutral"}
          value={summary?.unreadTotal ?? 0}
        />
        <DashboardKpiTile
          delta={`${formatSignedDelta(summary?.needsReplyDelta ?? 0)} vs prior 24h`}
          icon={MessageSquareReply}
          label="Needs reply"
          onClick={() => openDrilldown({ needsReply: true })}
          sparkline={needsReplySparkline}
          subtitle="Open followups"
          tone="attention"
          value={summary?.needsReplyOpen ?? 0}
        />
        <DashboardKpiTile
          delta={`${formatSignedDelta(summary?.overdueDelta ?? 0)} vs prior 24h`}
          icon={AlertTriangle}
          label="Overdue"
          onClick={() => openDrilldown({ overdue: true })}
          sparkline={overdueSparkline}
          subtitle="Past due followups"
          tone="critical"
          value={summary?.overdue ?? 0}
        />
        <DashboardKpiTile
          delta="Due before midnight"
          icon={CalendarClock}
          label="Due today"
          onClick={() => openDrilldown({ dueToday: true })}
          sparkline={dueTodaySparkline}
          subtitle="Today due queue"
          tone="attention"
          value={summary?.dueToday ?? 0}
        />
        <DashboardKpiTile
          delta={`${summary?.snoozedWakingNext24h ?? 0} wake in next 24h`}
          icon={BellRing}
          label="Snoozed"
          onClick={() => openDrilldown({ snoozed: true })}
          sparkline={snoozedSparkline}
          subtitle="Paused followups"
          tone="calm"
          value={summary?.snoozed ?? 0}
        />
        <DashboardKpiTile
          delta="Unread from BOSS rule set"
          icon={Crown}
          label="Unread BOSS"
          onClick={handleBossDrilldown}
          sparkline={unreadBossSparkline}
          subtitle="Priority sender highlights"
          tone="boss"
          value={summary?.unreadBoss ?? 0}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <AccentCard
          accent="blue"
          description="Received now vs previous 24-hour window."
          heading={
            <span className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Last 24h Intake
            </span>
          }
        >
          <div className="space-y-4">
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
                    (summary?.receivedDeltaPct ?? 0) >= 0 ? "text-emerald-600" : "text-red-600"
                  )}
                >
                  {formatPercent(summary?.receivedDeltaPct ?? 0)}
                </p>
              </div>
            </div>
            <Separator className="opacity-55" />
            <div className="grid gap-4 md:grid-cols-2">
              <DashboardDriverList
                emptyLabel="No domains in the last 24h."
                items={topDomainsLast24h}
                title="Top domains received (24h)"
              />
              <DashboardDriverList
                emptyLabel="No senders in the last 24h."
                items={topSendersLast24h}
                title="Top senders received (24h)"
              />
            </div>
          </div>
        </AccentCard>

        <AccentCard
          accent="orange"
          description="Open followup pressure and wakeups."
          heading="Followup Health"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              className="rounded-md border border-border bg-card p-3 text-left transition-colors hover:bg-accent"
              onClick={() => openDrilldown({ allOpen: true })}
              type="button"
            >
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Open followups
              </p>
              <p className="pt-1 text-2xl font-semibold">{summary?.openFollowupsTotal ?? 0}</p>
              <p className="pt-1 text-xs text-muted-foreground">
                Click to open all active followups
              </p>
            </button>
            <button
              className="rounded-md border border-border bg-card p-3 text-left transition-colors hover:bg-accent"
              onClick={() => openDrilldown({ snoozed: true })}
              type="button"
            >
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Snoozed waking soon
              </p>
              <p className="pt-1 text-2xl font-semibold">{summary?.snoozedWakingNext24h ?? 0}</p>
              <p className="pt-1 text-xs text-muted-foreground">Snoozed items waking in 24 hours</p>
            </button>
          </div>
        </AccentCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <AccentCard
          accent="purple"
          description="Main unread drivers by sender domain."
          heading="Top Domains (Unread)"
        >
          <div>
            <DashboardDriverList
              emptyLabel="No unread domain concentration."
              items={topDomainsUnread}
              title="Domains"
            />
          </div>
        </AccentCard>

        <AccentCard
          accent="gold"
          description="Main unread drivers by sender email."
          heading="Top Senders (Unread)"
        >
          <div>
            <DashboardDriverList
              emptyLabel="No unread sender concentration."
              items={topSendersUnread}
              title="Senders"
            />
          </div>
        </AccentCard>

        <AccentCard
          accent="green"
          description="Where unread load is currently concentrated."
          heading="Unread by Account"
        >
          <div>
            <DashboardDriverList
              emptyLabel="No unread messages across accounts."
              items={unreadByAccount}
              title="Accounts"
            />
          </div>
        </AccentCard>
      </div>

      <AccentCard
        accent="blue"
        description="Connection state and last sync snapshot by account."
        headerRight={
          <Button
            className="gap-2"
            disabled={isSyncingNow}
            onClick={() => void handleSyncNow()}
            size="sm"
            variant="outline"
          >
            {isSyncingNow ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Sync now
          </Button>
        }
        heading="Freshness + Sync"
      >
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={sseConnected ? "secondary" : "destructive"}>
              {sseConnected ? "SSE connected" : "SSE reconnecting"}
            </Badge>
            <Badge variant="outline">
              Last dashboard update: {formatTimestamp(summary?.lastUpdatedAt ?? null)}
            </Badge>
          </div>
          <Separator className="opacity-55" />
          <div className="space-y-2">
            {syncRows.length === 0 && (
              <p className="text-muted-foreground">No connected accounts.</p>
            )}
            {syncRows.map((row) => (
              <div
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card p-2"
                key={row.account.id}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{row.account.email}</p>
                  <p className="text-xs text-muted-foreground">
                    Last sync:{" "}
                    {formatTimestamp(row.syncState?.lastSyncAt ?? row.account.lastSyncAt)}
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
        </div>
      </AccentCard>
    </section>
  );
}
