import { ApiClientError } from "@/api/client";

export function toApiErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.message === "Request cancelled") {
      return "";
    }
    return error.message;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return ((error as { message: string }).message || "").trim();
  }
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Request failed. Check server logs.";
}
