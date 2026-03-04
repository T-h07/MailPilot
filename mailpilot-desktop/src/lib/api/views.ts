import { fetchJson } from "@/lib/api/client";

export type ViewScopeType = "ALL" | "SELECTED";

export type ViewRules = {
  senderDomains: string[];
  senderEmails: string[];
  keywords: string[];
  unreadOnly: boolean;
};

export type ViewRecord = {
  id: string;
  name: string;
  priority: number;
  sortOrder: number;
  icon: string | null;
  scopeType: ViewScopeType;
  selectedAccountIds: string[];
  rules: ViewRules;
  updatedAt: string;
};

export type ViewUpsertPayload = {
  name: string;
  priority: number;
  sortOrder: number;
  icon: string | null;
  scopeType: ViewScopeType;
  selectedAccountIds: string[];
  rules: ViewRules;
};

export function listViews(signal?: AbortSignal) {
  return fetchJson<ViewRecord[]>("/api/views", { signal });
}

export function getView(viewId: string, signal?: AbortSignal) {
  return fetchJson<ViewRecord>(`/api/views/${viewId}`, { signal });
}

export function createView(payload: ViewUpsertPayload, signal?: AbortSignal) {
  return fetchJson<ViewRecord>("/api/views", {
    method: "POST",
    body: payload,
    signal,
  });
}

export function updateView(viewId: string, payload: ViewUpsertPayload, signal?: AbortSignal) {
  return fetchJson<ViewRecord>(`/api/views/${viewId}`, {
    method: "PUT",
    body: payload,
    signal,
  });
}

export function deleteView(viewId: string, signal?: AbortSignal) {
  return fetchJson<{ status: string }>(`/api/views/${viewId}`, {
    method: "DELETE",
    signal,
  });
}
