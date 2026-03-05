import { fetchJson } from "@/api/client";

export type FocusQueueType = "NEEDS_REPLY" | "OVERDUE" | "DUE_TODAY" | "SNOOZED" | "ALL_OPEN";

export type FocusSummary = {
  needsReplyOpen: number;
  overdue: number;
  dueToday: number;
  snoozed: number;
  openTotal: number;
};

export type FocusQueueItem = {
  messageId: string;
  accountId: string;
  accountEmail: string;
  senderName: string;
  senderEmail: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  isUnread: boolean;
  queue: FocusQueueType;
  dueAt: string | null;
  snoozedUntil: string | null;
  needsReply: boolean;
  highlight: {
    label: string;
    accent: string;
  } | null;
};

export type FocusQueueResponse = {
  items: FocusQueueItem[];
  nextCursor: string | null;
};

export function getFocusSummary(signal?: AbortSignal) {
  return fetchJson<FocusSummary>("/api/focus/summary", { signal });
}

export function getFocusQueue(
  type: FocusQueueType,
  pageSize = 50,
  cursor: string | null = null,
  signal?: AbortSignal
) {
  const params = new URLSearchParams();
  params.set("type", type);
  params.set("pageSize", String(pageSize));
  if (cursor) {
    params.set("cursor", cursor);
  }
  return fetchJson<FocusQueueResponse>(`/api/focus/queue?${params.toString()}`, { signal });
}
