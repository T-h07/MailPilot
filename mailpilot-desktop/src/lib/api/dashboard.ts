import { fetchJson } from "@/api/client";

export type DashboardSummary = {
  unreadTotal: number;
  needsReplyOpen: number;
  overdue: number;
  dueToday: number;
  snoozed: number;
  unreadBoss: number;
  receivedLast24h: number;
  receivedPrev24h: number;
  receivedDeltaPct: number;
  unreadDelta: number;
  overdueDelta: number;
  needsReplyDelta: number;
  topDomainsUnread: Array<{ domain: string; count: number }>;
  topSendersUnread: Array<{ email: string; count: number }>;
  topDomainsReceived24h: Array<{ domain: string; count: number }>;
  topSendersReceived24h: Array<{ email: string; count: number }>;
  unreadByAccount: Array<{ accountId: string; email: string; count: number }>;
  bossSenderDomains: string[];
  bossSenderEmails: string[];
  openFollowupsTotal: number;
  snoozedWakingNext24h: number;
  series7d: Array<{
    date: string;
    unreadNow: number;
    needsReplyOpen: number;
    overdue: number;
    dueToday: number;
    snoozed: number;
    unreadBoss: number;
  }>;
  lastUpdatedAt: string;
};

export function getDashboardSummary(signal?: AbortSignal) {
  return fetchJson<DashboardSummary>("/api/dashboard/summary", { signal });
}

