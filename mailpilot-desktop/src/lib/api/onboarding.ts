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

export type OnboardingProposalScopeType = "ALL" | "SELECTED";

export type OnboardingProposalScope = {
  type: OnboardingProposalScopeType;
  accountIds: string[];
};

export type OnboardingProposalRules = {
  senderDomains: string[];
  senderEmails: string[];
  subjectKeywords: string[];
  unreadOnly: boolean;
};

export type OnboardingProposalAccount = {
  id: string;
  email: string;
  role: string;
};

export type OnboardingViewProposal = {
  key: string;
  category: string;
  name: string;
  confidenceScore: number;
  confidenceLevel: "HIGH" | "MEDIUM" | "LOW";
  priority: number;
  accountsScope: OnboardingProposalScope;
  rules: OnboardingProposalRules;
  estimatedCount: number;
  estimatedPct: number;
  explanation: string;
  topDomains: string[];
  topSenders: string[];
  sampleMessages: Array<{
    subject: string;
    senderEmail: string;
    receivedAt: string;
  }>;
  accountDistribution: Array<{
    accountId: string;
    email: string;
    count: number;
  }>;
};

export type OnboardingViewProposalsResponse = {
  rangeDays: number;
  analyzedMessages: number;
  accounts: OnboardingProposalAccount[];
  summary: {
    totalCandidates: number;
    returnedProposals: number;
    suppressedCandidates: number;
  };
  proposals: OnboardingViewProposal[];
  moreSuggestions: OnboardingViewProposal[];
  message: string | null;
};

export type OnboardingApplyViewProposal = {
  name: string;
  category?: string;
  priority: number;
  sortOrder: number;
  accountsScope: OnboardingProposalScope;
  rules: {
    senderDomains: string[];
    senderEmails: string[];
    subjectKeywords: string[];
    unreadOnly: boolean;
  };
};

export type OnboardingApplyViewProposalsPayload = {
  create: OnboardingApplyViewProposal[];
};

export type OnboardingApplyViewProposalsResponse = {
  status: "ok" | "error";
  created: Array<{
    viewId: string;
    name: string;
  }>;
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

export function completeOnboardingAccountsStep(signal?: AbortSignal) {
  return fetchJson<StatusResponse>("/api/onboarding/accounts/complete", {
    method: "POST",
    body: {},
    signal,
  });
}

export function fetchOnboardingViewProposals(
  range = "30d",
  maxSenders = 50,
  maxMessages = 1500,
  signal?: AbortSignal
) {
  const query = new URLSearchParams({
    range,
    maxSenders: String(maxSenders),
    maxMessages: String(maxMessages),
  });
  return fetchJson<OnboardingViewProposalsResponse>(`/api/onboarding/view-proposals?${query}`, {
    signal,
  });
}

export function applyOnboardingViewProposals(
  payload: OnboardingApplyViewProposalsPayload,
  signal?: AbortSignal
) {
  return fetchJson<OnboardingApplyViewProposalsResponse>("/api/onboarding/view-proposals/apply", {
    method: "POST",
    body: payload,
    signal,
  });
}

export function completeOnboardingViewProposalsStep(signal?: AbortSignal) {
  return fetchJson<StatusResponse>("/api/onboarding/view-proposals/complete", {
    method: "POST",
    body: {},
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
