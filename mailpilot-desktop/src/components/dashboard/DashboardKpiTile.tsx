import type { ComponentType } from "react";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";
import type { DashboardSummary } from "@/lib/api/dashboard";

export type DashboardKpiTone = "neutral" | "attention" | "critical" | "calm" | "boss";

export type SparklinePoint = {
  date: string;
  value: number;
};

type DashboardKpiTileProps = {
  icon: ComponentType<{ className?: string }>;
  label: string;
  subtitle: string;
  value: number;
  delta: string;
  tone: DashboardKpiTone;
  sparkline: SparklinePoint[];
  onClick: () => void;
};

function dashboardCardTone(tone: DashboardKpiTone) {
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

function sparklineColorForTone(tone: DashboardKpiTone): string {
  switch (tone) {
    case "critical":
      return "#ef4444";
    case "attention":
      return "#f59e0b";
    case "calm":
      return "#8b5cf6";
    case "boss":
      return "#eab308";
    case "neutral":
    default:
      return "#0ea5e9";
  }
}

function MiniSparkline({ data, stroke }: { data: SparklinePoint[]; stroke: string }) {
  if (data.length === 0) {
    return <div className="h-14 w-full" />;
  }

  return (
    <div className="h-14 w-full">
      <ResponsiveContainer height="100%" width="100%">
        <LineChart data={data} margin={{ left: 0, right: 0, top: 4, bottom: 2 }}>
          <Line
            dataKey="value"
            dot={false}
            isAnimationActive={false}
            stroke={stroke}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            type="monotone"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function mapDashboardSparkline(
  series7d: DashboardSummary["series7d"] | undefined,
  valueKey: "unreadNow" | "needsReplyOpen" | "overdue" | "dueToday" | "snoozed" | "unreadBoss"
): SparklinePoint[] {
  return (series7d ?? []).map((point) => ({
    date: point.date,
    value: point[valueKey] ?? 0,
  }));
}

export function DashboardKpiTile({
  icon: Icon,
  label,
  subtitle,
  value,
  delta,
  tone,
  sparkline,
  onClick,
}: DashboardKpiTileProps) {
  const sparklineColor = sparklineColorForTone(tone);

  return (
    <button
      className={cn(
        "rounded-xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm",
        dashboardCardTone(tone)
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
      <div className="mt-2">
        <MiniSparkline data={sparkline} stroke={sparklineColor} />
      </div>
      <p className="pt-2 text-[11px] font-medium opacity-85">Click to open filtered mailbox</p>
    </button>
  );
}
