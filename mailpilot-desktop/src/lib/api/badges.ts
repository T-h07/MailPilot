import { fetchJson } from "@/lib/api/client";

export type BadgeSummaryRecord = {
  inbox: number;
  viewsTotal: number;
  views: Record<string, number>;
};

export function getBadgeSummary(signal?: AbortSignal) {
  return fetchJson<BadgeSummaryRecord>("/api/badges/summary", { signal });
}

export function markInboxOpened(signal?: AbortSignal) {
  return fetchJson<{ status: string }>("/api/badges/inbox/opened", {
    method: "POST",
    signal,
  });
}

export function markViewOpened(viewId: string, signal?: AbortSignal) {
  return fetchJson<{ status: string }>(`/api/badges/views/${encodeURIComponent(viewId)}/opened`, {
    method: "POST",
    signal,
  });
}
