import { fetchJson } from "@/lib/api/client";

export type DraftSortOrder = "UPDATED_DESC" | "UPDATED_ASC";

export type DraftAttachmentRef = {
  name: string;
  path: string;
  sizeBytes: number | null;
  mime: string | null;
};

export type DraftSummary = {
  id: string;
  accountId: string;
  accountEmail: string;
  to: string;
  subject: string;
  snippet: string;
  updatedAt: string;
  hasAttachments: boolean;
};

export type DraftDetail = {
  id: string;
  accountId: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  attachments: DraftAttachmentRef[];
  updatedAt: string;
};

export type DraftUpsertPayload = {
  accountId: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string | null;
  attachments: DraftAttachmentRef[];
};

type ListDraftsOptions = {
  accountId?: string | null;
  q?: string;
  sort?: DraftSortOrder;
  signal?: AbortSignal;
};

export function listDrafts(options: ListDraftsOptions = {}) {
  const params = new URLSearchParams();
  if (options.accountId) {
    params.set("accountId", options.accountId);
  }
  if (options.q && options.q.trim().length > 0) {
    params.set("q", options.q.trim());
  }
  if (options.sort) {
    params.set("sort", options.sort);
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  return fetchJson<DraftSummary[]>(`/api/drafts${suffix}`, { signal: options.signal });
}

export function getDraft(id: string, signal?: AbortSignal) {
  return fetchJson<DraftDetail>(`/api/drafts/${id}`, { signal });
}

export function createDraft(payload: DraftUpsertPayload, signal?: AbortSignal) {
  return fetchJson<DraftDetail>("/api/drafts", {
    method: "POST",
    body: payload,
    signal,
  });
}

export function updateDraft(id: string, payload: DraftUpsertPayload, signal?: AbortSignal) {
  return fetchJson<{ status: string }>(`/api/drafts/${id}`, {
    method: "PUT",
    body: payload,
    signal,
  });
}

export function deleteDraft(id: string, signal?: AbortSignal) {
  return fetchJson<{ status: string }>(`/api/drafts/${id}`, {
    method: "DELETE",
    signal,
  });
}
