import type { DashboardSummary } from "@/lib/api/dashboard";

export type DashboardKpiSparklinePoint = {
  date: string;
  value: number;
};

export function mapDashboardSparkline(
  series7d: DashboardSummary["series7d"] | undefined,
  valueKey: "unreadNow" | "needsReplyOpen" | "overdue" | "dueToday" | "snoozed" | "unreadBoss"
): DashboardKpiSparklinePoint[] {
  return (series7d ?? []).map((point) => ({
    date: point.date,
    value: point[valueKey] ?? 0,
  }));
}
