import { API_BASE, ApiClientError } from "@/lib/api/client";

export type MailSendMode = "NEW" | "REPLY" | "REPLY_ALL" | "FORWARD";

export type OutboundAttachment = {
  fileName: string;
  mimeType: string | null;
  bytes: Uint8Array;
};

export type SendMailRequest = {
  accountId: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  bodyText?: string;
  bodyHtml?: string;
  replyToMessageDbId?: string;
  mode: MailSendMode;
  attachments: OutboundAttachment[];
};

export type SendMailResponse = {
  status: "ok";
  providerMessageId: string;
  providerThreadId: string | null;
  sentAt: string;
};

export async function sendMail(payload: SendMailRequest, signal?: AbortSignal): Promise<SendMailResponse> {
  const formData = new FormData();
  formData.set("accountId", payload.accountId);
  formData.set("to", payload.to ?? "");
  formData.set("mode", payload.mode);

  if (payload.cc !== undefined) {
    formData.set("cc", payload.cc);
  }
  if (payload.bcc !== undefined) {
    formData.set("bcc", payload.bcc);
  }
  if (payload.subject !== undefined) {
    formData.set("subject", payload.subject);
  }
  if (payload.bodyText !== undefined) {
    formData.set("bodyText", payload.bodyText);
  }
  if (payload.bodyHtml !== undefined) {
    formData.set("bodyHtml", payload.bodyHtml);
  }
  if (payload.replyToMessageDbId) {
    formData.set("replyToMessageDbId", payload.replyToMessageDbId);
  }

  for (const attachment of payload.attachments) {
    const blob = new Blob([attachment.bytes], {
      type: attachment.mimeType ?? "application/octet-stream",
    });
    formData.append("attachments", blob, attachment.fileName);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/mail/send`, {
      method: "POST",
      body: formData,
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiClientError("Request cancelled", 0);
    }
    throw new ApiClientError("Unable to reach API", 0);
  }

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as { message?: string };
      if (typeof payload.message === "string" && payload.message.trim().length > 0) {
        message = payload.message;
      }
    }
    throw new ApiClientError(message, response.status);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new ApiClientError("API returned non-JSON response", response.status);
  }

  return (await response.json()) as SendMailResponse;
}
