import { fetchJson } from "@/lib/api/client";

export type InsightsRange = "2d" | "7d" | "14d" | "30d" | "6m";

export type InsightsSummary = {
  range: InsightsRange;
  receivedCount: number;
  uniqueSenders: number;
  comparison: {
    receivedPreviousCount: number;
    receivedDeltaPct: number;
    uniqueSendersPreviousCount: number;
    uniqueSendersDeltaPct: number;
  };
  topDomains: Array<{ domain: string; count: number }>;
  topSenders: Array<{ email: string; count: number }>;
  volumeByAccount: Array<{ accountId: string; email: string; count: number }>;
  unreadNow: number;
  unreadByDomain: Array<{ domain: string; count: number }>;
  followupCountsNow: {
    needsReply: number;
    overdue: number;
    dueToday: number;
    snoozed: number;
  };
  series: {
    receivedPerDay: Array<{ date: string; count: number }>;
    unreadPerDay: Array<{ date: string; count: number }>;
    bossPerDay: Array<{ date: string; count: number }>;
    followupsDonePerDay: Array<{ date: string; count: number }>;
  };
};

export function getInsightsSummary(range: InsightsRange, signal?: AbortSignal) {
  return fetchJson<InsightsSummary>(`/api/insights/summary?range=${encodeURIComponent(range)}`, { signal });
}
