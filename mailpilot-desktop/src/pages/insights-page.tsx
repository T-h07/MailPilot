import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Activity, RefreshCw, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiClientError } from "@/lib/api/client";
import { getInsightsSummary, type InsightsRange, type InsightsSummary } from "@/lib/api/insights";
import { cn } from "@/lib/utils";

const RANGE_OPTIONS: Array<{ value: InsightsRange; label: string }> = [
  { value: "2d", label: "2d" },
  { value: "7d", label: "7d" },
  { value: "14d", label: "14d" },
  { value: "30d", label: "30d" },
  { value: "6m", label: "6m" },
];

type RankedItem = {
  key: string;
  label: string;
  count: number;
  onClick: () => void;
};

type DrilldownParams = {
  unread?: boolean;
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

function buildInboxDrilldownPath(params: DrilldownParams): string {
  const searchParams = new URLSearchParams();
  if (params.unread) {
    searchParams.set("unread", "1");
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

function formatPercent(value: number): string {
  const rounded = Math.abs(value) >= 10 ? value.toFixed(0) : value.toFixed(1);
  return `${value >= 0 ? "+" : ""}${rounded}%`;
}

function formatDateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function rangeWindowLabel(range: InsightsRange): string {
  switch (range) {
    case "2d":
      return "Last 2 days";
    case "7d":
      return "Last 7 days";
    case "14d":
      return "Last 14 days";
    case "30d":
      return "Last 30 days";
    case "6m":
      return "Last 6 months";
    default:
      return "Range";
  }
}

function rangeWindowDates(range: InsightsRange): string {
  const end = new Date();
  const start = new Date(end);
  switch (range) {
    case "2d":
      start.setDate(end.getDate() - 2);
      break;
    case "7d":
      start.setDate(end.getDate() - 7);
      break;
    case "14d":
      start.setDate(end.getDate() - 14);
      break;
    case "30d":
      start.setDate(end.getDate() - 30);
      break;
    case "6m":
      start.setMonth(end.getMonth() - 6);
      break;
  }
  return `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`;
}

function KpiCard({
  label,
  value,
  subtitle,
  delta,
}: {
  label: string;
  value: string;
  subtitle: string;
  delta: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="pt-1 text-2xl font-semibold leading-none">{value}</p>
      <p className="pt-2 text-xs text-muted-foreground">{subtitle}</p>
      <p className="pt-1 text-xs font-medium text-foreground/80">{delta}</p>
    </div>
  );
}

function MultiLineChart({
  leftColorClass,
  leftLabel,
  leftPoints,
  rightColorClass,
  rightLabel,
  rightPoints,
}: {
  leftColorClass: string;
  leftLabel: string;
  leftPoints: Array<{ date: string; count: number }>;
  rightColorClass: string;
  rightLabel: string;
  rightPoints: Array<{ date: string; count: number }>;
}) {
  const width = 760;
  const height = 240;
  const padding = 24;
  const maxValue = Math.max(1, ...leftPoints.map((point) => point.count), ...rightPoints.map((point) => point.count));
  const xStep = leftPoints.length > 1 ? (width - padding * 2) / (leftPoints.length - 1) : 0;

  const leftPolyline = leftPoints
    .map((point, index) => {
      const x = padding + index * xStep;
      const y = height - padding - (point.count / maxValue) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(" ");

  const rightPolyline = rightPoints
    .map((point, index) => {
      const x = padding + index * xStep;
      const y = height - padding - (point.count / maxValue) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(" ");

  if (leftPoints.length === 0) {
    return <p className="text-sm text-muted-foreground">No data in this range.</p>;
  }

  const firstLabel = formatDateLabel(leftPoints[0]?.date ?? "");
  const middleLabel = formatDateLabel(leftPoints[Math.max(0, Math.floor(leftPoints.length / 2))]?.date ?? "");
  const lastLabel = formatDateLabel(leftPoints[leftPoints.length - 1]?.date ?? "");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className={cn("h-2.5 w-2.5 rounded-full", leftColorClass)} />
          {leftLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className={cn("h-2.5 w-2.5 rounded-full", rightColorClass)} />
          {rightLabel}
        </span>
      </div>
      <svg
        className="h-[240px] w-full rounded-md border border-border bg-card"
        preserveAspectRatio="none"
        viewBox={`0 0 ${width} ${height}`}
      >
        <line
          stroke="hsl(var(--border))"
          strokeWidth="1"
          x1={padding}
          x2={width - padding}
          y1={height - padding}
          y2={height - padding}
        />
        <polyline
          fill="none"
          points={leftPolyline}
          stroke="hsl(var(--primary))"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
        />
        <polyline
          fill="none"
          points={rightPolyline}
          stroke="hsl(var(--chart-2, 200 90% 45%))"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.5"
        />
      </svg>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{firstLabel}</span>
        <span>{middleLabel}</span>
        <span>{lastLabel}</span>
      </div>
    </div>
  );
}

function RankedBars({
  emptyLabel,
  items,
  title,
}: {
  emptyLabel: string;
  items: RankedItem[];
  title: string;
}) {
  const maxValue = Math.max(1, ...items.map((item) => item.count));

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold">{title}</p>
      {items.length === 0 && (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      )}
      {items.map((item) => {
        const widthPercent = Math.max(6, Math.round((item.count / maxValue) * 100));
        return (
          <button
            className="w-full space-y-1 rounded-md p-1 text-left transition-colors hover:bg-accent"
            key={item.key}
            onClick={item.onClick}
            type="button"
          >
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-muted-foreground">{item.label}</span>
              <span className="font-medium">{item.count}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded bg-muted">
              <div className="h-full rounded bg-primary/70" style={{ width: `${widthPercent}%` }} />
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function InsightsPage() {
  const navigate = useNavigate();
  const [range, setRange] = useState<InsightsRange>("7d");
  const [summary, setSummary] = useState<InsightsSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSummary = useCallback(async (selectedRange: InsightsRange) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await getInsightsSummary(selectedRange);
      setSummary(response);
    } catch (loadError) {
      setError(toErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary(range);
  }, [loadSummary, range]);

  const openDrilldown = useCallback(
    (params: DrilldownParams) => {
      navigate(buildInboxDrilldownPath(params));
    },
    [navigate],
  );

  const topDomain = useMemo(() => summary?.topDomains[0] ?? null, [summary]);
  const topSender = useMemo(() => summary?.topSenders[0] ?? null, [summary]);
  const topDomainShare = useMemo(
    () => (summary && topDomain ? (topDomain.count / Math.max(1, summary.receivedCount)) * 100 : 0),
    [summary, topDomain],
  );
  const topSenderShare = useMemo(
    () => (summary && topSender ? (topSender.count / Math.max(1, summary.receivedCount)) * 100 : 0),
    [summary, topSender],
  );

  const topDomainItems = useMemo<RankedItem[]>(
    () =>
      (summary?.topDomains ?? []).map((item) => ({
        key: item.domain,
        label: item.domain,
        count: item.count,
        onClick: () => openDrilldown({ senderDomains: [item.domain] }),
      })),
    [openDrilldown, summary],
  );

  const topSenderItems = useMemo<RankedItem[]>(
    () =>
      (summary?.topSenders ?? []).map((item) => ({
        key: item.email,
        label: item.email,
        count: item.count,
        onClick: () => openDrilldown({ senderEmails: [item.email] }),
      })),
    [openDrilldown, summary],
  );

  const accountActivityItems = useMemo<RankedItem[]>(
    () =>
      (summary?.volumeByAccount ?? []).map((item) => ({
        key: item.accountId,
        label: item.email,
        count: item.count,
        onClick: () => openDrilldown({ accountIds: [item.accountId] }),
      })),
    [openDrilldown, summary],
  );

  const unreadDomainItems = useMemo<RankedItem[]>(
    () =>
      (summary?.unreadByDomain ?? []).map((item) => ({
        key: item.domain,
        label: item.domain,
        count: item.count,
        onClick: () => openDrilldown({ unread: true, senderDomains: [item.domain] }),
      })),
    [openDrilldown, summary],
  );

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Insights</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Historical analytics with comparison deltas, distribution drivers, and drilldowns.
          </p>
        </div>
        <Button disabled={isLoading} onClick={() => void loadSummary(range)} size="sm" variant="outline">
          {isLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Refresh"}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {RANGE_OPTIONS.map((option) => (
          <Button
            key={option.value}
            onClick={() => setRange(option.value)}
            size="sm"
            variant={range === option.value ? "default" : "outline"}
          >
            {option.label}
          </Button>
        ))}
        <Badge variant="outline">{rangeWindowLabel(summary?.range ?? range)}</Badge>
        <Badge variant="outline">{rangeWindowDates(summary?.range ?? range)}</Badge>
      </div>

      {error && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <p className="text-sm text-destructive">{error}</p>
            <Button onClick={() => void loadSummary(range)} size="sm" variant="outline">
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          delta={`${formatPercent(summary?.comparison.receivedDeltaPct ?? 0)} vs previous window`}
          label="Messages received"
          subtitle="Inbound count in selected range."
          value={isLoading ? "..." : String(summary?.receivedCount ?? 0)}
        />
        <KpiCard
          delta={`${formatPercent(summary?.comparison.uniqueSendersDeltaPct ?? 0)} vs previous window`}
          label="Unique senders"
          subtitle="Distinct sender emails in range."
          value={isLoading ? "..." : String(summary?.uniqueSenders ?? 0)}
        />
        <KpiCard
          delta={topDomain ? `${topDomainShare.toFixed(1)}% share` : "--"}
          label="Top domain"
          subtitle="Highest contributor domain."
          value={isLoading ? "..." : topDomain ? `${topDomain.domain} (${topDomain.count})` : "--"}
        />
        <KpiCard
          delta={topSender ? `${topSenderShare.toFixed(1)}% share` : "--"}
          label="Top sender"
          subtitle="Most frequent sender."
          value={isLoading ? "..." : topSender ? `${topSender.email} (${topSender.count})` : "--"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Volume and Unread Per Day
          </CardTitle>
          <CardDescription>Range trend overlay for received volume vs unread messages.</CardDescription>
        </CardHeader>
        <CardContent className={cn("transition-opacity", isLoading && "animate-pulse opacity-75")}>
          <MultiLineChart
            leftColorClass="bg-primary"
            leftLabel="Received per day"
            leftPoints={summary?.series.volumePerDay ?? []}
            rightColorClass="bg-cyan-500"
            rightLabel="Unread per day"
            rightPoints={summary?.series.unreadPerDay ?? []}
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top Domains</CardTitle>
            <CardDescription>Click to open mailbox filtered by domain.</CardDescription>
          </CardHeader>
          <CardContent>
            <RankedBars
              emptyLabel="No domain activity in this range."
              items={topDomainItems}
              title="Domains"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top Senders</CardTitle>
            <CardDescription>Click to open mailbox filtered by sender.</CardDescription>
          </CardHeader>
          <CardContent>
            <RankedBars
              emptyLabel="No sender activity in this range."
              items={topSenderItems}
              title="Senders"
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Accounts Activity</CardTitle>
            <CardDescription>Received counts by account in selected range.</CardDescription>
          </CardHeader>
          <CardContent>
            <RankedBars
              emptyLabel="No account activity in this range."
              items={accountActivityItems}
              title="Accounts"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Unread by Domain</CardTitle>
            <CardDescription>Current unread concentration by sender domain.</CardDescription>
          </CardHeader>
          <CardContent>
            <RankedBars
              emptyLabel="No unread domain concentration."
              items={unreadDomainItems}
              title="Unread domains"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Followup Snapshot
            </CardTitle>
            <CardDescription>Current followup pressure (live, independent of range).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2">
              <span className="text-muted-foreground">Needs reply</span>
              <span className="font-semibold">{summary?.followupCountsNow.needsReply ?? 0}</span>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2">
              <span className="text-muted-foreground">Overdue</span>
              <span className="font-semibold">{summary?.followupCountsNow.overdue ?? 0}</span>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2">
              <span className="text-muted-foreground">Due today</span>
              <span className="font-semibold">{summary?.followupCountsNow.dueToday ?? 0}</span>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2">
              <span className="text-muted-foreground">Snoozed</span>
              <span className="font-semibold">{summary?.followupCountsNow.snoozed ?? 0}</span>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2">
              <span className="text-muted-foreground">Unread now</span>
              <span className="font-semibold">{summary?.unreadNow ?? 0}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
