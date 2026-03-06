import { fetchJson } from "@/api/client";

export type UserProfileRecord = {
  firstName: string | null;
  lastName: string | null;
  fieldOfWork: string | null;
};

export type AppStateRecord = {
  onboardingComplete: boolean;
  onboardingStep: number;
  locked: boolean;
  hasPassword: boolean;
  profile: UserProfileRecord | null;
};

export type StatusResponse = {
  status: "ok" | "error";
};

export type RecoveryReason = "NO_PRIMARY" | "PRIMARY_REAUTH_REQUIRED" | "SEND_DISABLED";

export type RecoveryOptionsResponse = {
  canRecover: boolean;
  maskedEmail: string | null;
  reason: RecoveryReason | null;
};

export type RecoveryRequestResponse = {
  status: "ok" | "error";
  cooldownSeconds: number;
};

export function getAppState(signal?: AbortSignal) {
  return fetchJson<AppStateRecord>("/api/app/state", { signal });
}

export function setAppPassword(password: string, signal?: AbortSignal) {
  return fetchJson<StatusResponse>("/api/app/password/set", {
    method: "POST",
    body: { password },
    signal,
  });
}

export function changeAppPassword(
  currentPassword: string,
  newPassword: string,
  confirmNewPassword: string,
  signal?: AbortSignal
) {
  return fetchJson<StatusResponse>("/api/app/password/change", {
    method: "POST",
    body: { currentPassword, newPassword, confirmNewPassword },
    signal,
  });
}

export function loginApp(password: string, signal?: AbortSignal) {
  return fetchJson<StatusResponse>("/api/app/login", {
    method: "POST",
    body: { password },
    signal,
  });
}

export function lockApp(signal?: AbortSignal) {
  return fetchJson<StatusResponse>("/api/app/lock", {
    method: "POST",
    body: {},
    signal,
  });
}

export function unlockApp(password: string, signal?: AbortSignal) {
  return fetchJson<StatusResponse>("/api/app/unlock", {
    method: "POST",
    body: { password },
    signal,
  });
}

export function logoutApp(signal?: AbortSignal) {
  return fetchJson<StatusResponse>("/api/app/logout", {
    method: "POST",
    body: {},
    signal,
  });
}

export function getRecoveryOptions(signal?: AbortSignal) {
  return fetchJson<RecoveryOptionsResponse>("/api/app/recovery/options", { signal });
}

export function requestRecoveryCode(signal?: AbortSignal) {
  return fetchJson<RecoveryRequestResponse>("/api/app/recovery/request", {
    method: "POST",
    body: {},
    signal,
  });
}

export function verifyRecoveryCode(
  code: string,
  newPassword: string,
  confirmNewPassword: string,
  signal?: AbortSignal
) {
  return fetchJson<StatusResponse>("/api/app/recovery/verify", {
    method: "POST",
    body: { code, newPassword, confirmNewPassword },
    signal,
  });
}
