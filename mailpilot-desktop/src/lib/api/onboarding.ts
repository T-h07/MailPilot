import { fetchJson } from "@/api/client";

type StatusResponse = {
  status: "ok" | "error";
};

export type OnboardingStartResponse = {
  status: "ok" | "error";
  step: number;
};

export type OnboardingCompletePayload = {
  firstName: string;
  lastName: string;
  fieldOfWork: string;
  password: string;
};

export function startOnboarding(signal?: AbortSignal) {
  return fetchJson<OnboardingStartResponse>("/api/onboarding/start", {
    method: "POST",
    body: {},
    signal,
  });
}

export function confirmPrimaryOnboardingAccount(accountId: string, signal?: AbortSignal) {
  return fetchJson<StatusResponse>("/api/onboarding/primary-account/confirm", {
    method: "POST",
    body: { accountId },
    signal,
  });
}

export function completeOnboarding(payload: OnboardingCompletePayload, signal?: AbortSignal) {
  return fetchJson<StatusResponse>("/api/onboarding/complete", {
    method: "POST",
    body: payload,
    signal,
  });
}
