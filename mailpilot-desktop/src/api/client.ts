const DEFAULT_API_BASE = "http://127.0.0.1:8082";
const DEFAULT_TIMEOUT_MS = 10000;

export const API_BASE = (import.meta.env.VITE_API_BASE ?? DEFAULT_API_BASE).replace(/\/$/, "");

export class ApiClientError extends Error {
  readonly status: number;
  readonly details?: string;

  constructor(message: string, status = 0, details?: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.details = details;
  }
}

export type FetchJsonOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type BinaryResponse = {
  bytes: Uint8Array;
  contentType: string;
  fileName: string | null;
};

export type ApiHealthResponse = {
  status: string;
  app: string;
  time: string;
};

export function resolveApiBase(): string {
  return API_BASE;
}

function logApiFailure(path: string, status: number, message: string): void {
  if (!import.meta.env.DEV) {
    return;
  }
  // Dev-only diagnostic logging for endpoint parity debugging.
  console.error(`[MailPilot API] ${path} -> ${status}: ${message}`);
}

export function normalizeApiError(error: unknown): {
  message: string;
  status?: number;
  details?: string;
} {
  if (error instanceof ApiClientError) {
    return {
      message: error.message,
      status: error.status || undefined,
      details: error.details,
    };
  }
  if (error instanceof Error) {
    return { message: error.message };
  }
  return { message: "Request failed" };
}

export async function getApiHealth(signal?: AbortSignal): Promise<ApiHealthResponse> {
  return apiJson<ApiHealthResponse>("/api/health", { signal });
}

export async function apiJson<T>(path: string, options: FetchJsonOptions = {}): Promise<T> {
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
        { once: true }
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
      logApiFailure(path, response.status, errorMessage);
      throw new ApiClientError(errorMessage, response.status);
    }

    if (!isJson) {
      throw new ApiClientError("API returned non-JSON response", response.status);
    }

    return payload as T;
  } catch (error) {
    if (error instanceof ApiClientError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      if (options.signal?.aborted) {
        logApiFailure(path, 0, "Request cancelled");
        throw new ApiClientError("Request cancelled", 0);
      }
      logApiFailure(path, 0, "Request timed out");
      throw new ApiClientError("Request timed out", 0);
    }
    logApiFailure(path, 0, "Unable to reach API");
    throw new ApiClientError("Unable to reach API", 0);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function fetchFormJson<T>(
  path: string,
  formData: FormData,
  options: Omit<FetchJsonOptions, "body"> = {}
): Promise<T> {
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
        { once: true }
      );
    }
  }

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? "POST",
      body: formData,
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
      logApiFailure(path, response.status, errorMessage);
      throw new ApiClientError(errorMessage, response.status);
    }

    if (!isJson) {
      throw new ApiClientError("API returned non-JSON response", response.status);
    }

    return payload as T;
  } catch (error) {
    if (error instanceof ApiClientError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      if (options.signal?.aborted) {
        logApiFailure(path, 0, "Request cancelled");
        throw new ApiClientError("Request cancelled", 0);
      }
      logApiFailure(path, 0, "Request timed out");
      throw new ApiClientError("Request timed out", 0);
    }
    logApiFailure(path, 0, "Unable to reach API");
    throw new ApiClientError("Unable to reach API", 0);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function apiBlob(path: string, options: FetchJsonOptions = {}): Promise<Blob> {
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
        { once: true }
      );
    }
  }

  try {
    const headers: Record<string, string> = {
      Accept: "*/*",
    };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: timeoutController.signal,
    });

    if (!response.ok) {
      const errorMessage = await parseBinaryErrorMessage(response);
      logApiFailure(path, response.status, errorMessage);
      throw new ApiClientError(errorMessage, response.status);
    }

    return response.blob();
  } catch (error) {
    if (error instanceof ApiClientError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      if (options.signal?.aborted) {
        logApiFailure(path, 0, "Request cancelled");
        throw new ApiClientError("Request cancelled", 0);
      }
      logApiFailure(path, 0, "Request timed out");
      throw new ApiClientError("Request timed out", 0);
    }
    logApiFailure(path, 0, "Unable to reach API");
    throw new ApiClientError("Unable to reach API", 0);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function downloadBinary(
  path: string,
  options: FetchJsonOptions = {}
): Promise<BinaryResponse> {
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
        { once: true }
      );
    }
  }

  try {
    const headers: Record<string, string> = {
      Accept: "*/*",
    };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: timeoutController.signal,
    });

    if (!response.ok) {
      const errorMessage = await parseBinaryErrorMessage(response);
      logApiFailure(path, response.status, errorMessage);
      throw new ApiClientError(errorMessage, response.status);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    const fileName = parseContentDispositionFilename(response.headers.get("content-disposition"));
    const contentType = response.headers.get("content-type") ?? "application/octet-stream";

    return {
      bytes,
      contentType,
      fileName,
    };
  } catch (error) {
    if (error instanceof ApiClientError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      if (options.signal?.aborted) {
        logApiFailure(path, 0, "Request cancelled");
        throw new ApiClientError("Request cancelled", 0);
      }
      logApiFailure(path, 0, "Request timed out");
      throw new ApiClientError("Request timed out", 0);
    }
    logApiFailure(path, 0, "Unable to reach API");
    throw new ApiClientError("Unable to reach API", 0);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function fetchBinary(
  path: string,
  options: FetchJsonOptions = {}
): Promise<BinaryResponse> {
  return downloadBinary(path, options);
}

export async function fetchJson<T>(path: string, options: FetchJsonOptions = {}): Promise<T> {
  return apiJson<T>(path, options);
}

async function parseBinaryErrorMessage(response: Response): Promise<string> {
  const statusCode = response.status;
  const fallbackMessage = `Request failed (HTTP ${statusCode}). Check server logs.`;

  let rawBody = "";
  try {
    rawBody = await response.text();
  } catch {
    return fallbackMessage;
  }

  const trimmedBody = rawBody.trim();
  if (!trimmedBody) {
    return fallbackMessage;
  }

  try {
    const parsed = JSON.parse(trimmedBody) as unknown;
    if (parsed && typeof parsed === "object" && "message" in parsed) {
      const message = (parsed as { message?: unknown }).message;
      if (typeof message === "string" && message.trim().length > 0) {
        return message.trim();
      }
    }
  } catch {
    // Ignore JSON parse errors and continue with plain text fallback.
  }

  const contentType = response.headers.get("content-type") ?? "";
  const looksLikeHtml = trimmedBody.startsWith("<!DOCTYPE") || trimmedBody.startsWith("<html");
  if (!looksLikeHtml || contentType.includes("text/plain")) {
    if (trimmedBody.length > 240) {
      return `${trimmedBody.slice(0, 237)}...`;
    }
    return trimmedBody;
  }

  return fallbackMessage;
}

function parseContentDispositionFilename(contentDisposition: string | null): string | null {
  if (!contentDisposition) {
    return null;
  }

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const plainMatch = contentDisposition.match(/filename=\"?([^\";]+)\"?/i);
  return plainMatch?.[1] ?? null;
}
