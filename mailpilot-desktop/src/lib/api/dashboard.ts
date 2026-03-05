import { fetchJson } from "@/lib/api/client";

export type DashboardSummary = {
  unreadTotal: number;
  needsReplyOpen: number;
  overdue: number;
  dueToday: number;
  snoozed: number;
  unreadBoss: number;
  lastUpdatedAt: string;
};

export function getDashboardSummary(signal?: AbortSignal) {
  return fetchJson<DashboardSummary>("/api/dashboard/summary", { signal });
}
