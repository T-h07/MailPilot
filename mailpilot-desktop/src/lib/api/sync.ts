import { fetchJson } from "@/lib/api/client";

export type SyncStartResponse = {
  status: string;
  accountId: string;
  maxMessages: number;
};

export type SyncAllResponse = {
  status: string;
  maxMessages: number;
  accountsQueued: number;
};

export type SyncStatusRecord = {
  accountId: string;
  email: string;
  status: "IDLE" | "RUNNING" | "ERROR";
  processed?: number | null;
  total?: number | null;
  message?: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  lastRunStartedAt: string | null;
};

export type MessageRepairResponse = {
  status: string;
  updated: number;
  skipped: number;
};

export function runAccountSync(accountId: string, maxMessages = 500, signal?: AbortSignal) {
  const encodedAccountId = encodeURIComponent(accountId);
  return fetchJson<SyncStartResponse>(`/api/sync/gmail/${encodedAccountId}/run?maxMessages=${maxMessages}`, {
    method: "POST",
    signal,
  });
}

export function runAllAccountsSync(maxMessages = 500, signal?: AbortSignal) {
  return fetchJson<SyncAllResponse>(`/api/sync/gmail/run?maxMessages=${maxMessages}`, {
    method: "POST",
    signal,
  });
}

export function getSyncStatus(signal?: AbortSignal) {
  return fetchJson<SyncStatusRecord[]>("/api/sync/status", { signal });
}

export function repairMessageMetadata(days = 30, signal?: AbortSignal) {
  return fetchJson<MessageRepairResponse>(`/api/dev/repair/messages?days=${days}`, {
    method: "POST",
    signal,
  });
}
