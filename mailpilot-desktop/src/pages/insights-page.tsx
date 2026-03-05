import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, Pin, RefreshCw, TrendingUp, Unplug } from "lucide-react";
import { InsightsChartTooltip } from "@/components/insights/InsightsChartTooltip";
import { InsightsKpiCard } from "@/components/insights/InsightsKpiCard";
import {
  InsightsRankedBars,
  type InsightsRankedItem,
} from "@/components/insights/InsightsRankedBars";
import { AccentCard, type AccentColor } from "@/components/ui/AccentCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useMetricCarousel } from "@/hooks/useMetricCarousel";
import { getInsightsSummary, type InsightsRange, type InsightsSummary } from "@/lib/api/insights";
import { cn } from "@/lib/utils";
import { toApiErrorMessage } from "@/utils/api-error";
import { buildInboxDrilldownPath, type InboxDrilldownParams } from "@/utils/mailbox-drilldown";
import { formatPercent } from "@/utils/number-format";

const RANGE_OPTIONS: Array<{ value: InsightsRange; label: string }> = [
  { value: "2d", label: "2d" },
  { value: "7d", label: "7d" },
  { value: "14d", label: "14d" },
  { value: "30d", label: "30d" },
  { value: "6m", label: "6m" },
];

const AUTO_ROTATE_MS = 4000;
const RESUME_AFTER_HOVER_MS = 1000;

type ChartMetricKey = "unread" | "boss" | "followupsDone";

type ChartMetric = {
  key: ChartMetricKey;
  label: string;
  accent: AccentColor;
  color: string;
};

type ChartRow = {
  date: string;
  received: number;
  unread: number;
  boss: number;
  followupsDone: number;
};

type LegacyInsightsSeries = {
  volumePerDay?: Array<{ date: string; count: number }>;
};

const METRIC_OPTIONS: ChartMetric[] = [
  { key: "unread", label: "Unread per day", accent: "green", color: "#10b981" },
  { key: "boss", label: "Boss emails per day", accent: "gold", color: "#eab308" },
  { key: "followupsDone", label: "Followups done per day", accent: "purple", color: "#8b5cf6" },
];

function hasOwnSeriesKey(series: unknown, key: string): boolean {
  if (!series || typeof series !== "object") {
    return false;
  }
  return Object.prototype.hasOwnProperty.call(series, key);
}

function formatDateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatShortDate(value: string): string {
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

function toSeriesMap(series: Array<{ date: string; count: number }>): Map<string, number> {
  const mapped = new Map<string, number>();
  for (const point of series) {
    mapped.set(point.date, point.count ?? 0);
  }
  return mapped;
}

function mergeChartData(
  receivedSeries: Array<{ date: string; count: number }>,
  unreadSeries: Array<{ date: string; count: number }>,
  bossSeries: Array<{ date: string; count: number }>,
  followupsDoneSeries: Array<{ date: string; count: number }>
): ChartRow[] {
  const dates = new Set<string>();
  for (const point of receivedSeries) {
    dates.add(point.date);
  }
  for (const point of unreadSeries) {
    dates.add(point.date);
  }
  for (const point of bossSeries) {
    dates.add(point.date);
  }
  for (const point of followupsDoneSeries) {
    dates.add(point.date);
  }

  const receivedByDate = toSeriesMap(receivedSeries);
  const unreadByDate = toSeriesMap(unreadSeries);
  const bossByDate = toSeriesMap(bossSeries);
  const doneByDate = toSeriesMap(followupsDoneSeries);

  return Array.from(dates)
    .sort((left, right) => left.localeCompare(right))
    .map((date) => ({
      date,
      received: receivedByDate.get(date) ?? 0,
      unread: unreadByDate.get(date) ?? 0,
      boss: bossByDate.get(date) ?? 0,
      followupsDone: doneByDate.get(date) ?? 0,
    }));
}

export function InsightsPage() {
  const navigate = useNavigate();
  const [range, setRange] = useState<InsightsRange>("7d");
  const [summary, setSummary] = useState<InsightsSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const comparison = summary?.comparison ?? {
    receivedPreviousCount: 0,
    receivedDeltaPct: 0,
    uniqueSendersPreviousCount: 0,
    uniqueSendersDeltaPct: 0,
  };
  const followupCountsNow = summary?.followupCountsNow ?? {
    needsReply: 0,
    overdue: 0,
    dueToday: 0,
    snoozed: 0,
  };

  const legacySeries = summary?.series as unknown as LegacyInsightsSeries | undefined;
  const receivedSeries = summary?.series?.receivedPerDay ?? legacySeries?.volumePerDay ?? [];
  const unreadSeries = summary?.series?.unreadPerDay ?? [];
  const bossSeries = summary?.series?.bossPerDay ?? [];
  const followupsDoneSeries = summary?.series?.followupsDonePerDay ?? [];
  const hasBossSeries = hasOwnSeriesKey(summary?.series, "bossPerDay");
  const hasFollowupsDoneSeries = hasOwnSeriesKey(summary?.series, "followupsDonePerDay");

  const chartRows = useMemo(
    () => mergeChartData(receivedSeries, unreadSeries, bossSeries, followupsDoneSeries),
    [bossSeries, followupsDoneSeries, receivedSeries, unreadSeries]
  );

  const availableMetrics = useMemo(() => {
    const metrics: ChartMetric[] = [];
    if (unreadSeries.length > 0 || chartRows.length > 0) {
      metrics.push(METRIC_OPTIONS[0]);
    }
    if (hasBossSeries) {
      metrics.push(METRIC_OPTIONS[1]);
    }
    if (hasFollowupsDoneSeries) {
      metrics.push(METRIC_OPTIONS[2]);
    }
    return metrics;
  }, [chartRows.length, hasBossSeries, hasFollowupsDoneSeries, unreadSeries.length]);

  const effectiveMetrics = useMemo(() => {
    if (availableMetrics.length > 0) {
      return availableMetrics;
    }
    return [METRIC_OPTIONS[0]];
  }, [availableMetrics]);

  const {
    activeMetricIndex,
    isPinned,
    setIsPinned,
    handleChartMouseEnter,
    handleChartMouseLeave,
    handleMetricClick,
  } = useMetricCarousel({
    metricCount: effectiveMetrics.length,
    autoRotateMs: AUTO_ROTATE_MS,
    resumeAfterHoverMs: RESUME_AFTER_HOVER_MS,
  });

  const activeMetric =
    effectiveMetrics[Math.min(activeMetricIndex, Math.max(effectiveMetrics.length - 1, 0))];

  const peakPoint = useMemo(() => {
    if (chartRows.length === 0) {
      return null;
    }
    return chartRows.reduce(
      (peak, point) => (point.received > peak.received ? point : peak),
      chartRows[0]
    );
  }, [chartRows]);

  const averagePerDay = useMemo(() => {
    if (chartRows.length === 0) {
      return 0;
    }
    const total = chartRows.reduce((sum, point) => sum + point.received, 0);
    return total / chartRows.length;
  }, [chartRows]);

  const loadSummary = useCallback(async (selectedRange: InsightsRange) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await getInsightsSummary(selectedRange);
      setSummary(response);
    } catch (loadError) {
      setError(toApiErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary(range);
  }, [loadSummary, range]);

  const openDrilldown = useCallback(
    (params: InboxDrilldownParams) => {
      navigate(buildInboxDrilldownPath(params));
    },
    [navigate]
  );

  const topDomain = useMemo(() => summary?.topDomains[0] ?? null, [summary]);
  const topSender = useMemo(() => summary?.topSenders[0] ?? null, [summary]);
  const topDomainShare = useMemo(
    () => (summary && topDomain ? (topDomain.count / Math.max(1, summary.receivedCount)) * 100 : 0),
    [summary, topDomain]
  );
  const topSenderShare = useMemo(
    () => (summary && topSender ? (topSender.count / Math.max(1, summary.receivedCount)) * 100 : 0),
    [summary, topSender]
  );

  const topDomainItems = useMemo<InsightsRankedItem[]>(
    () =>
      (summary?.topDomains ?? []).map((item) => ({
        key: item.domain,
        label: item.domain,
        count: item.count,
        onClick: () => openDrilldown({ senderDomains: [item.domain] }),
      })),
    [openDrilldown, summary]
  );

  const topSenderItems = useMemo<InsightsRankedItem[]>(
    () =>
      (summary?.topSenders ?? []).map((item) => ({
        key: item.email,
        label: item.email,
        count: item.count,
        onClick: () => openDrilldown({ senderEmails: [item.email] }),
      })),
    [openDrilldown, summary]
  );

  const accountActivityItems = useMemo<InsightsRankedItem[]>(
    () =>
      (summary?.volumeByAccount ?? []).map((item) => ({
        key: item.accountId,
        label: item.email,
        count: item.count,
        onClick: () => openDrilldown({ accountIds: [item.accountId] }),
      })),
    [openDrilldown, summary]
  );

  const unreadDomainItems = useMemo<InsightsRankedItem[]>(
    () =>
      (summary?.unreadByDomain ?? []).map((item) => ({
        key: item.domain,
        label: item.domain,
        count: item.count,
        onClick: () => openDrilldown({ unread: true, senderDomains: [item.domain] }),
      })),
    [openDrilldown, summary]
  );

  const activeMetricColor = activeMetric?.color ?? "#06b6d4";
  const activeMetricKey = activeMetric?.key ?? "unread";
  const activeMetricLabel = activeMetric?.label ?? "Unread per day";

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Insights</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Historical analytics with comparison deltas, distribution drivers, and drilldowns.
          </p>
        </div>
        <Button
          disabled={isLoading}
          onClick={() => void loadSummary(range)}
          size="sm"
          variant="outline"
        >
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
        <InsightsKpiCard
          accent="blue"
          delta={`${formatPercent(comparison.receivedDeltaPct)} vs previous window`}
          label="Messages received"
          subtitle="Inbound count in selected range."
          value={isLoading ? "..." : String(summary?.receivedCount ?? 0)}
        />
        <InsightsKpiCard
          accent="green"
          delta={`${formatPercent(comparison.uniqueSendersDeltaPct)} vs previous window`}
          label="Unique senders"
          subtitle="Distinct sender emails in range."
          value={isLoading ? "..." : String(summary?.uniqueSenders ?? 0)}
        />
        <InsightsKpiCard
          accent="purple"
          delta={topDomain ? `${topDomainShare.toFixed(1)}% share` : "--"}
          label="Top domain"
          subtitle="Highest contributor domain."
          value={isLoading ? "..." : topDomain ? `${topDomain.domain} (${topDomain.count})` : "--"}
        />
        <InsightsKpiCard
          accent="gold"
          delta={topSender ? `${topSenderShare.toFixed(1)}% share` : "--"}
          label="Top sender"
          subtitle="Most frequent sender."
          value={isLoading ? "..." : topSender ? `${topSender.email} (${topSender.count})` : "--"}
        />
      </div>

      <AccentCard
        accent="blue"
        className={cn("transition-opacity", isLoading && "animate-pulse opacity-75")}
        description="Primary baseline is Received per day. Secondary metric rotates and pauses on hover."
        heading={
          <span className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Metric Carousel Chart
          </span>
        }
      >
        <div className="space-y-3">
          <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
            <div className="rounded-md border border-border bg-card/70 px-3 py-2">
              Peak day:{" "}
              <span className="font-semibold text-foreground">
                {peakPoint ? `${formatDateLabel(peakPoint.date)} (${peakPoint.received})` : "--"}
              </span>
            </div>
            <div className="rounded-md border border-border bg-card/70 px-3 py-2">
              Average/day:{" "}
              <span className="font-semibold text-foreground">{averagePerDay.toFixed(1)}</span>
            </div>
          </div>

          <Separator className="opacity-55" />

          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border border-border bg-muted text-foreground" variant="outline">
              Received baseline
            </Badge>
            {effectiveMetrics.map((metric, metricIndex) => {
              const active = metricIndex === activeMetricIndex;
              return (
                <button
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs transition-colors",
                    active
                      ? "border-border bg-accent text-foreground"
                      : "border-border bg-card text-muted-foreground hover:bg-muted/80"
                  )}
                  key={metric.key}
                  onClick={() => handleMetricClick(metricIndex)}
                  type="button"
                >
                  {metric.label}
                </button>
              );
            })}
            {!isPinned ? (
              <Badge
                className="ml-auto gap-1 border border-border bg-muted text-foreground"
                variant="outline"
              >
                <Unplug className="h-3 w-3" />
                AUTO
              </Badge>
            ) : (
              <button
                className="ml-auto inline-flex items-center gap-1 rounded-full border border-border bg-accent px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-muted"
                onClick={() => setIsPinned(false)}
                type="button"
              >
                <Pin className="h-3 w-3" />
                Unpin
              </button>
            )}
          </div>

          <div
            className="h-[300px] rounded-md border border-border bg-card/70 p-2"
            onMouseEnter={handleChartMouseEnter}
            onMouseLeave={handleChartMouseLeave}
          >
            <ResponsiveContainer height="100%" width="100%">
              <LineChart data={chartRows} margin={{ left: 6, right: 10, top: 10, bottom: 6 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                <XAxis
                  axisLine={false}
                  dataKey="date"
                  minTickGap={24}
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                  tickFormatter={formatShortDate}
                  tickLine={false}
                />
                <YAxis
                  axisLine={false}
                  allowDecimals={false}
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                  tickLine={false}
                  width={32}
                />
                <Tooltip
                  content={(tooltipProps) => (
                    <InsightsChartTooltip {...tooltipProps} activeMetricLabel={activeMetricLabel} />
                  )}
                />
                <Line
                  dataKey="received"
                  dot={false}
                  name="Received per day"
                  stroke="hsl(var(--primary))"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={3}
                  type="monotone"
                />
                <Line
                  dataKey={activeMetricKey}
                  dot={false}
                  name={activeMetricLabel}
                  stroke={activeMetricColor}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  type="monotone"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </AccentCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <AccentCard
          accent="purple"
          description="Click to open mailbox filtered by domain."
          heading="Top Domains"
        >
          <div>
            <InsightsRankedBars
              emptyLabel="No domain activity in this range."
              items={topDomainItems}
              title="Domains"
            />
          </div>
        </AccentCard>

        <AccentCard
          accent="gold"
          description="Click to open mailbox filtered by sender."
          heading="Top Senders"
        >
          <div>
            <InsightsRankedBars
              emptyLabel="No sender activity in this range."
              items={topSenderItems}
              title="Senders"
            />
          </div>
        </AccentCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <AccentCard
          accent="blue"
          description="Received counts by account in selected range."
          heading="Account Distribution"
        >
          <div>
            <InsightsRankedBars
              emptyLabel="No account activity in this range."
              items={accountActivityItems}
              title="Accounts"
            />
          </div>
        </AccentCard>

        <AccentCard
          accent="green"
          description="Current unread concentration by sender domain."
          heading="Unread by Domain"
        >
          <div>
            <InsightsRankedBars
              emptyLabel="No unread domain concentration."
              items={unreadDomainItems}
              title="Unread domains"
            />
          </div>
        </AccentCard>

        <AccentCard
          accent="orange"
          description="Current followup pressure (live, independent of range)."
          heading={
            <span className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Followup Pressure
            </span>
          }
        >
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2">
              <span className="text-muted-foreground">Needs reply</span>
              <span className="font-semibold">{followupCountsNow.needsReply}</span>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2">
              <span className="text-muted-foreground">Overdue</span>
              <span className="font-semibold">{followupCountsNow.overdue}</span>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2">
              <span className="text-muted-foreground">Due today</span>
              <span className="font-semibold">{followupCountsNow.dueToday}</span>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2">
              <span className="text-muted-foreground">Snoozed</span>
              <span className="font-semibold">{followupCountsNow.snoozed}</span>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2">
              <span className="text-muted-foreground">Unread now</span>
              <span className="font-semibold">{summary?.unreadNow ?? 0}</span>
            </div>
          </div>
        </AccentCard>
      </div>
    </section>
  );
}
