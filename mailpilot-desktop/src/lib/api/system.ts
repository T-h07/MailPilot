import { fetchJson } from "@/api/client";

type ResetAppPayload = {
  password: string;
  confirmText: string;
};

export function resetApp(payload: ResetAppPayload) {
  return fetchJson<{ status: string }>("/api/system/reset", {
    method: "POST",
    body: payload,
  });
}
