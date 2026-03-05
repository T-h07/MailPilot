import { fetchJson } from "@/api/client";
import type { AccentToken } from "@/features/mailbox/utils/accent";

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

export type ViewLabelRecord = {
  id: string;
  viewId: string;
  name: string;
  colorToken: AccentToken;
  sortOrder: number;
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

export type ViewLabelUpsertPayload = {
  name: string;
  colorToken: AccentToken;
  sortOrder: number;
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

export function listViewLabels(viewId: string, signal?: AbortSignal) {
  return fetchJson<ViewLabelRecord[]>(`/api/views/${viewId}/labels`, { signal });
}

export function createViewLabel(
  viewId: string,
  payload: ViewLabelUpsertPayload,
  signal?: AbortSignal
) {
  return fetchJson<ViewLabelRecord>(`/api/views/${viewId}/labels`, {
    method: "POST",
    body: payload,
    signal,
  });
}

export function updateViewLabel(
  viewId: string,
  labelId: string,
  payload: ViewLabelUpsertPayload,
  signal?: AbortSignal
) {
  return fetchJson<ViewLabelRecord>(`/api/views/${viewId}/labels/${labelId}`, {
    method: "PUT",
    body: payload,
    signal,
  });
}

export function deleteViewLabel(viewId: string, labelId: string, signal?: AbortSignal) {
  return fetchJson<{ status: string }>(`/api/views/${viewId}/labels/${labelId}`, {
    method: "DELETE",
    signal,
  });
}

export function listMessageViewLabels(viewId: string, messageId: string, signal?: AbortSignal) {
  return fetchJson<ViewLabelRecord[]>(`/api/views/${viewId}/messages/${messageId}/labels`, {
    signal,
  });
}

export function replaceMessageViewLabels(
  viewId: string,
  messageId: string,
  labelIds: string[],
  signal?: AbortSignal
) {
  return fetchJson<{ status: string }>(`/api/views/${viewId}/messages/${messageId}/labels`, {
    method: "PUT",
    body: { labelIds },
    signal,
  });
}
