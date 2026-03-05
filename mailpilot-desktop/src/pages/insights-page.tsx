import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiClientError } from "@/lib/api/client";
import { getInsightsSummary, type InsightsRange, type InsightsSummary } from "@/lib/api/insights";

const RANGE_OPTIONS: Array<{ value: InsightsRange; label: string }> = [
  { value: "2d", label: "2d" },
  { value: "7d", label: "7d" },
  { value: "14d", label: "14d" },
  { value: "30d", label: "30d" },
  { value: "6m", label: "6m" },
];

function toErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Request failed";
}

function dayLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function KpiCard({ label, value, subtitle }: { label: string; value: string; subtitle: string }) {
  return (
    <div className="mailbox-panel rounded-xl p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="pt-1 text-2xl font-semibold leading-none">{value}</p>
      <p className="pt-2 text-xs text-muted-foreground">{subtitle}</p>
    </div>
  );
}

function VolumeLineChart({ points }: { points: Array<{ date: string; count: number }> }) {
  const width = 760;
  const height = 240;
  const padding = 24;
  const maxValue = Math.max(1, ...points.map((point) => point.count));
  const xStep = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0;

  const polyline = points
    .map((point, index) => {
      const x = padding + index * xStep;
      const y = height - padding - (point.count / maxValue) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(" ");

  const firstLabel = points[0] ? dayLabel(points[0].date) : "--";
  const middleLabel = points.length > 2 ? dayLabel(points[Math.floor(points.length / 2)].date) : firstLabel;
  const lastLabel = points.length > 0 ? dayLabel(points[points.length - 1].date) : "--";

  if (points.length === 0) {
    return <p className="text-sm text-muted-foreground">No data in this range.</p>;
  }

  return (
    <div className="space-y-2">
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
          points={polyline}
          stroke="hsl(var(--primary))"
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
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
  title,
  emptyLabel,
  items,
  itemLabel,
}: {
  title: string;
  emptyLabel: string;
  items: Array<{ count: number }>;
  itemLabel: (index: number) => string;
}) {
  const maxValue = Math.max(1, ...items.map((item) => item.count));

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">{title}</p>
      {items.length === 0 && (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      )}
      {items.map((item, index) => {
        const widthPercent = Math.max(6, Math.round((item.count / maxValue) * 100));
        return (
          <div className="space-y-1" key={`${title}-${index}`}>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-muted-foreground">{itemLabel(index)}</span>
              <span className="font-medium">{item.count}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded bg-muted">
              <div className="h-full rounded bg-primary/70" style={{ width: `${widthPercent}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function InsightsPage() {
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

  const topDomain = useMemo(() => summary?.topDomains[0] ?? null, [summary]);
  const topSender = useMemo(() => summary?.topSenders[0] ?? null, [summary]);

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Insights</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Historical analytics for message volume and sender/domain concentration over time.
          </p>
        </div>
        <Button disabled={isLoading} onClick={() => void loadSummary(range)} size="sm" variant="outline">
          {isLoading ? "Refreshing..." : "Refresh"}
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
        <Badge variant="outline">Range: {summary?.range ?? range}</Badge>
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
          label="Messages received"
          subtitle="Received in selected range."
          value={isLoading ? "..." : String(summary?.receivedCount ?? 0)}
        />
        <KpiCard
          label="Unique senders"
          subtitle="Distinct sender emails in range."
          value={isLoading ? "..." : String(summary?.uniqueSenders ?? 0)}
        />
        <KpiCard
          label="Top domain"
          subtitle="Highest message volume domain."
          value={isLoading ? "..." : topDomain ? `${topDomain.domain} (${topDomain.count})` : "--"}
        />
        <KpiCard
          label="Top sender"
          subtitle="Most frequent sender email."
          value={isLoading ? "..." : topSender ? `${topSender.email} (${topSender.count})` : "--"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Volume per day</CardTitle>
          <CardDescription>Daily inbound count trend for the selected range.</CardDescription>
        </CardHeader>
        <CardContent>
          <VolumeLineChart points={summary?.series.volumePerDay ?? []} />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top domains</CardTitle>
            <CardDescription>Most frequent sender domains in range.</CardDescription>
          </CardHeader>
          <CardContent>
            <RankedBars
              emptyLabel="No domain activity in this range."
              itemLabel={(index) => summary?.topDomains[index]?.domain ?? "--"}
              items={summary?.topDomains ?? []}
              title="Domains"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top senders</CardTitle>
            <CardDescription>Most frequent sender emails in range.</CardDescription>
          </CardHeader>
          <CardContent>
            <RankedBars
              emptyLabel="No sender activity in this range."
              itemLabel={(index) => summary?.topSenders[index]?.email ?? "--"}
              items={summary?.topSenders ?? []}
              title="Senders"
            />
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
