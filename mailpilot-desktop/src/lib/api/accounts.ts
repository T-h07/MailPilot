import { fetchJson } from "@/api/client";

export type AccountRole = "PRIMARY" | "SECONDARY" | "CUSTOM";

export type AccountRecord = {
  id: string;
  email: string;
  provider: string;
  status: string;
  canRead: boolean;
  canSend: boolean;
  lastSyncAt: string | null;
  role: AccountRole;
  customLabel: string | null;
};

export type AccountLabelUpdatePayload = {
  role: AccountRole;
  customLabel: string | null;
};

type AccountDetachResponse = {
  status: string;
  deletedAccountId: string;
};

export function listAccounts(signal?: AbortSignal) {
  return fetchJson<AccountRecord[]>("/api/accounts", { signal });
}

export function detachAccount(accountId: string) {
  return fetchJson<AccountDetachResponse>(`/api/accounts/${accountId}?purge=true`, {
    method: "DELETE",
  });
}

export function updateAccountLabel(accountId: string, payload: AccountLabelUpdatePayload) {
  return fetchJson<{ status: string }>(`/api/accounts/${accountId}/label`, {
    method: "PATCH",
    body: payload,
  });
}
