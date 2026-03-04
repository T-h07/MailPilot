import { fetchBinary, type BinaryResponse } from "@/lib/api/client";

export function downloadAttachmentFile(attachmentId: string, signal?: AbortSignal): Promise<BinaryResponse> {
  return fetchBinary(`/api/attachments/${attachmentId}/download`, { signal });
}

export function exportMessagePdf(messageId: string, signal?: AbortSignal): Promise<BinaryResponse> {
  return fetchBinary(`/api/messages/${messageId}/export/pdf`, { signal });
}

export function exportThreadPdf(threadId: string, signal?: AbortSignal): Promise<BinaryResponse> {
  return fetchBinary(`/api/threads/${threadId}/export/pdf`, { signal });
}
