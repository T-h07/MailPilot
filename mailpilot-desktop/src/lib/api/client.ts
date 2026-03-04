const DEFAULT_API_BASE = "http://127.0.0.1:8082";
const DEFAULT_TIMEOUT_MS = 12000;

export const API_BASE = (import.meta.env.VITE_API_BASE ?? DEFAULT_API_BASE).replace(/\/$/, "");

export class ApiClientError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type MailboxQueryRequest = {
  scope?: {
    accountIds?: string[];
  };
  q?: string | null;
  filters?: {
    unreadOnly?: boolean;
    needsReply?: boolean;
    overdue?: boolean;
    dueToday?: boolean;
    snoozed?: boolean;
    senderDomains?: string[];
    senderEmails?: string[];
    keywords?: string[];
  };
  sort: "RECEIVED_DESC";
  pageSize: number;
  cursor: string | null;
};

export type MailboxListItem = {
  id: string;
  accountId: string;
  accountEmail: string;
  senderName: string;
  senderEmail: string;
  senderDomain: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  isUnread: boolean;
  hasAttachments: boolean;
  chips: string[];
  tags: string[];
  highlight: {
    label: string;
    accent: string;
  } | null;
};

export type MailboxQueryResponse = {
  items: MailboxListItem[];
  nextCursor: string | null;
};

export type MessageDetailResponse = {
  id: string;
  accountId: string;
  accountEmail: string;
  threadId: string | null;
  senderName: string;
  senderEmail: string;
  subject: string;
  receivedAt: string;
  isUnread: boolean;
  body: {
    mime: string;
    content: string | null;
    isCached: boolean;
  };
  attachments: Array<{
    id: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
  }>;
  thread: {
    messages: Array<{
      id: string;
      senderEmail: string;
      subject: string;
      receivedAt: string;
      isUnread: boolean;
    }>;
  };
  tags: string[];
  followup: {
    status: "OPEN" | "DONE";
    needsReply: boolean;
    dueAt: string | null;
    snoozedUntil: string | null;
  };
  highlight: {
    label: string;
    accent: string;
  } | null;
};

export type AccountRecord = {
  id: string;
  email: string;
};

export type ApiHealthResponse = {
  status: string;
  app: string;
  time: string;
};

export function resolveApiBase(): string {
  return API_BASE;
}

export async function queryMailbox(
  request: MailboxQueryRequest,
  signal?: AbortSignal,
): Promise<MailboxQueryResponse> {
  return requestJson<MailboxQueryResponse>("/api/mailbox/query", {
    method: "POST",
    body: request,
    signal,
  });
}

export async function getMessageDetail(
  messageId: string,
  signal?: AbortSignal,
): Promise<MessageDetailResponse> {
  return requestJson<MessageDetailResponse>(`/api/messages/${messageId}`, { signal });
}

export async function setMessageReadState(
  messageId: string,
  isUnread: boolean,
  signal?: AbortSignal,
): Promise<{ status: string }> {
  return requestJson<{ status: string }>(`/api/messages/${messageId}/read`, {
    method: "POST",
    body: { isUnread },
    signal,
  });
}

export async function listAccounts(signal?: AbortSignal): Promise<AccountRecord[]> {
  return requestJson<AccountRecord[]>("/api/accounts", { signal });
}

export async function getApiHealth(signal?: AbortSignal): Promise<ApiHealthResponse> {
  return requestJson<ApiHealthResponse>("/api/health", { signal });
}

async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutController = new AbortController();
  const timeoutId = window.setTimeout(() => timeoutController.abort("timeout"), timeoutMs);

  if (options.signal) {
    if (options.signal.aborted) {
      timeoutController.abort(options.signal.reason);
    } else {
      options.signal.addEventListener(
        "abort",
        () => {
          timeoutController.abort(options.signal?.reason);
        },
        { once: true },
      );
    }
  }

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: timeoutController.signal,
    });

    const contentType = response.headers.get("content-type") ?? "";
    const isJson = contentType.includes("application/json");
    const payload = isJson ? await response.json() : null;

    if (!response.ok) {
      const errorMessage =
        payload && typeof payload.message === "string"
          ? payload.message
          : `Request failed with status ${response.status}`;
      throw new ApiClientError(errorMessage, response.status);
    }

    return payload as T;
  } catch (error) {
    if (error instanceof ApiClientError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      if (options.signal?.aborted) {
        throw new ApiClientError("Request cancelled", 0);
      }
      throw new ApiClientError("Request timed out", 0);
    }
    throw new ApiClientError("Unable to reach API", 0);
  } finally {
    window.clearTimeout(timeoutId);
  }
}
