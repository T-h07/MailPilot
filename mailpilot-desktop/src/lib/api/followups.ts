import { fetchJson } from "@/api/client";

export type FollowupStatus = "OPEN" | "DONE";

export type FollowupState = {
  messageId: string;
  status: FollowupStatus;
  needsReply: boolean;
  dueAt: string | null;
  snoozedUntil: string | null;
};

export type FollowupUpdatePayload = {
  status: FollowupStatus;
  needsReply: boolean;
  dueAt: string | null;
  snoozedUntil: string | null;
};

export type FollowupActionPayload = {
  action: "MARK_DONE" | "MARK_OPEN" | "SNOOZE";
  days?: 1 | 3 | 7;
};

export function getFollowup(messageId: string, signal?: AbortSignal) {
  return fetchJson<FollowupState>(`/api/followups/${messageId}`, { signal });
}

export function updateFollowup(
  messageId: string,
  payload: FollowupUpdatePayload,
  signal?: AbortSignal
) {
  return fetchJson<{ status: string; followup: FollowupState }>(`/api/followups/${messageId}`, {
    method: "PUT",
    body: payload,
    signal,
  });
}

export function runFollowupAction(
  messageId: string,
  payload: FollowupActionPayload,
  signal?: AbortSignal
) {
  return fetchJson<{ status: string; followup: FollowupState }>(
    `/api/followups/${messageId}/actions`,
    {
      method: "POST",
      body: payload,
      signal,
    }
  );
}
