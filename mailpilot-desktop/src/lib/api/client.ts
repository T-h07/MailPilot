const DEFAULT_API_BASE = "http://127.0.0.1:8082";
const DEFAULT_TIMEOUT_MS = 10000;

export const API_BASE = (import.meta.env.VITE_API_BASE ?? DEFAULT_API_BASE).replace(/\/$/, "");

export class ApiClientError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
  }
}

export type FetchJsonOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type ApiHealthResponse = {
  status: string;
  app: string;
  time: string;
};

export function resolveApiBase(): string {
  return API_BASE;
}

export async function getApiHealth(signal?: AbortSignal): Promise<ApiHealthResponse> {
  return fetchJson<ApiHealthResponse>("/api/health", { signal });
}

export async function fetchJson<T>(path: string, options: FetchJsonOptions = {}): Promise<T> {
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
        throw new ApiClientError("Request cancelled", 0);
      }
      throw new ApiClientError("Request timed out", 0);
    }
    throw new ApiClientError("Unable to reach API", 0);
  } finally {
    window.clearTimeout(timeoutId);
  }
}
