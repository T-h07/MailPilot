import { fetchJson } from "@/lib/api/client";

export type AccountRecord = {
  id: string;
  email: string;
  provider: string;
  status: string;
};

export function listAccounts(signal?: AbortSignal) {
  return fetchJson<AccountRecord[]>("/api/accounts", { signal });
}
