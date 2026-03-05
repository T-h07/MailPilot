import { fetchJson } from "@/lib/api/client";
import type { AccentToken } from "@/features/mailbox/utils/accent";

export type SenderRuleMatchType = "EMAIL" | "DOMAIN";

export type SenderRuleRecord = {
  id: string;
  matchType: SenderRuleMatchType;
  matchValue: string;
  label: string;
  accent: AccentToken;
  createdAt: string;
};

export type SenderRuleUpsertPayload = {
  matchType: SenderRuleMatchType;
  matchValue: string;
  label: string;
  accent: AccentToken;
};

export function listSenderRules(signal?: AbortSignal) {
  return fetchJson<SenderRuleRecord[]>("/api/sender-rules", { signal });
}

export function createSenderRule(payload: SenderRuleUpsertPayload, signal?: AbortSignal) {
  return fetchJson<SenderRuleRecord>("/api/sender-rules", {
    method: "POST",
    body: payload,
    signal,
  });
}

export function updateSenderRule(
  ruleId: string,
  payload: SenderRuleUpsertPayload,
  signal?: AbortSignal,
) {
  return fetchJson<SenderRuleRecord>(`/api/sender-rules/${ruleId}`, {
    method: "PUT",
    body: payload,
    signal,
  });
}

export function deleteSenderRule(ruleId: string, signal?: AbortSignal) {
  return fetchJson<{ status: string }>(`/api/sender-rules/${ruleId}`, {
    method: "DELETE",
    signal,
  });
}
