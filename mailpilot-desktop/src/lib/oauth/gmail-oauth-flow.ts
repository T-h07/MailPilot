import { openUrl } from "@tauri-apps/plugin-opener";
import { ApiClientError } from "@/api/client";
import { getGmailOAuthStatus, type GmailOAuthStatusResponse } from "@/lib/api/oauth";

export const GMAIL_OAUTH_POLL_INTERVAL_MS = 2000;
export const GMAIL_OAUTH_POLL_TIMEOUT_MS = 45000;

type WaitForGmailOAuthOptions = {
  timeoutMs?: number;
  pollIntervalMs?: number;
  timeoutMessage?: string;
  onPoll?: () => Promise<boolean> | boolean;
};

const DEFAULT_OPEN_ERROR = "Unable to open the system browser for Google OAuth.";
const DEFAULT_TIMEOUT_ERROR = "Google OAuth timed out. Complete consent in the browser and retry.";

export function sleep(durationMs: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, durationMs);
  });
}

export async function openGmailOAuthUrl(
  authUrl: string,
  options: { fallbackToWindowOpen?: boolean; errorMessage?: string } = {}
) {
  const fallbackToWindowOpen = options.fallbackToWindowOpen ?? true;
  const errorMessage = options.errorMessage ?? DEFAULT_OPEN_ERROR;

  try {
    await openUrl(authUrl);
    return;
  } catch {
    if (!fallbackToWindowOpen) {
      throw new ApiClientError(errorMessage);
    }
  }

  const popup = window.open(authUrl, "_blank", "noopener,noreferrer");
  if (!popup) {
    throw new ApiClientError(errorMessage);
  }
}

export async function waitForGmailOAuthOutcome(
  state: string,
  options: WaitForGmailOAuthOptions = {}
): Promise<GmailOAuthStatusResponse> {
  const timeoutMs = options.timeoutMs ?? GMAIL_OAUTH_POLL_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? GMAIL_OAUTH_POLL_INTERVAL_MS;
  const timeoutMessage = options.timeoutMessage ?? DEFAULT_TIMEOUT_ERROR;
  const startedAt = Date.now();
  let latestStatus: GmailOAuthStatusResponse | null = null;

  while (Date.now() - startedAt <= timeoutMs) {
    await sleep(pollIntervalMs);

    let conditionSatisfied = false;
    if (options.onPoll) {
      conditionSatisfied = await options.onPoll();
    }

    latestStatus = await getGmailOAuthStatus(state);
    if (conditionSatisfied || latestStatus.status === "SUCCESS") {
      return latestStatus;
    }

    if (
      latestStatus.status === "ERROR" ||
      latestStatus.status === "EXPIRED" ||
      latestStatus.status === "UNKNOWN"
    ) {
      throw new ApiClientError(latestStatus.message || "OAuth flow failed.");
    }
  }

  throw new ApiClientError(latestStatus?.message || timeoutMessage);
}
