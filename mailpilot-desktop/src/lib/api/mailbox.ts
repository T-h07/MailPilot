import { fetchJson } from "@/lib/api/client";

export type MailboxQueryRequest = {
  scope?: {
    accountIds?: string[];
  };
  q?: string | null;
  filters?: {
    unreadOnly?: boolean;
    needsReply?: boolean;
    overdue?: boolean;
    dueToday?: boolean;
    snoozed?: boolean;
    senderDomains?: string[];
    senderEmails?: string[];
    keywords?: string[];
  };
  sort: "RECEIVED_DESC";
  pageSize: number;
  cursor: string | null;
};

export type ViewMailboxQueryRequest = {
  viewId: string;
  q?: string | null;
  filtersOverride?: {
    unreadOnly?: boolean;
    needsReply?: boolean;
    overdue?: boolean;
    dueToday?: boolean;
    snoozed?: boolean;
  };
  pageSize: number;
  cursor: string | null;
};

export type MailboxListItem = {
  id: string;
  accountId: string;
  accountEmail: string;
  senderName: string;
  senderEmail: string;
  senderDomain: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  isUnread: boolean;
  hasAttachments: boolean;
  chips: string[];
  tags: string[];
  highlight: {
    label: string;
    accent: string;
  } | null;
};

export type MailboxQueryResponse = {
  items: MailboxListItem[];
  nextCursor: string | null;
};

export type MessageDetailResponse = {
  id: string;
  accountId: string;
  accountEmail: string;
  threadId: string | null;
  senderName: string;
  senderEmail: string;
  subject: string;
  receivedAt: string;
  isUnread: boolean;
  body: {
    mime: string;
    content: string | null;
    isCached: boolean;
  };
  attachments: Array<{
    id: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
  }>;
  thread: {
    messages: Array<{
      id: string;
      senderEmail: string;
      subject: string;
      receivedAt: string;
      isUnread: boolean;
    }>;
  };
  tags: string[];
  followup: {
    status: "OPEN" | "DONE";
    needsReply: boolean;
    dueAt: string | null;
    snoozedUntil: string | null;
  };
  highlight: {
    label: string;
    accent: string;
  } | null;
};

export type SeedDevResponse = {
  status: string;
  message?: string;
  messages?: number;
};

export function queryMailbox(payload: MailboxQueryRequest, signal?: AbortSignal) {
  return fetchJson<MailboxQueryResponse>("/api/mailbox/query", {
    method: "POST",
    body: payload,
    signal,
  });
}

export function queryMailboxView(payload: ViewMailboxQueryRequest, signal?: AbortSignal) {
  return fetchJson<MailboxQueryResponse>("/api/mailbox/query/view", {
    method: "POST",
    body: payload,
    signal,
  });
}

export function getMessage(id: string, signal?: AbortSignal) {
  return fetchJson<MessageDetailResponse>(`/api/messages/${id}`, { signal });
}

export function setRead(id: string, isUnread: boolean, signal?: AbortSignal) {
  return fetchJson<{ status: string }>(`/api/messages/${id}/read`, {
    method: "POST",
    body: { isUnread },
    signal,
  });
}

export function seedDev(signal?: AbortSignal) {
  return fetchJson<SeedDevResponse>("/api/dev/seed", {
    method: "POST",
    signal,
  });
}
