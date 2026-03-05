import { fetchJson } from "@/lib/api/client";

export type InsightsRange = "2d" | "7d" | "14d" | "30d" | "6m";

export type InsightsSummary = {
  range: InsightsRange;
  receivedCount: number;
  uniqueSenders: number;
  topDomains: Array<{ domain: string; count: number }>;
  topSenders: Array<{ email: string; count: number }>;
  series: {
    volumePerDay: Array<{ date: string; count: number }>;
  };
};

export function getInsightsSummary(range: InsightsRange, signal?: AbortSignal) {
  return fetchJson<InsightsSummary>(`/api/insights/summary?range=${encodeURIComponent(range)}`, { signal });
}
