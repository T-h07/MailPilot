import { fetchJson } from "@/api/client";

export type GmailOAuthConfigCheckResponse = {
  configured: boolean;
  path: string | null;
  message: string;
};

export type GmailOAuthStartRequest = {
  returnTo?: string;
  mode?: "READONLY" | "SEND";
  context?: string;
  accountHint?: string;
};

export type GmailOAuthStartResponse = {
  authUrl: string;
  state: string;
};

export type GmailOAuthStatusResponse = {
  state: string;
  status: "PENDING" | "SUCCESS" | "ERROR" | "EXPIRED" | "UNKNOWN";
  message: string;
  accountId: string | null;
  email: string | null;
};

export function configCheck(signal?: AbortSignal) {
  return fetchJson<GmailOAuthConfigCheckResponse>("/api/oauth/gmail/config-check", { signal });
}

export function startGmailOAuth(payload: GmailOAuthStartRequest = {}, signal?: AbortSignal) {
  return fetchJson<GmailOAuthStartResponse>("/api/oauth/gmail/start", {
    method: "POST",
    body: payload,
    signal,
  });
}

export function getGmailOAuthStatus(state: string, signal?: AbortSignal) {
  const encodedState = encodeURIComponent(state);
  return fetchJson<GmailOAuthStatusResponse>(`/api/oauth/gmail/status?state=${encodedState}`, {
    signal,
  });
}
