import { downloadBinary, type BinaryResponse } from "@/api/client";

export function downloadAttachmentFile(
  attachmentId: string,
  signal?: AbortSignal
): Promise<BinaryResponse> {
  return downloadBinary(`/api/attachments/${attachmentId}/download`, { signal });
}

export function exportMessagePdf(messageId: string, signal?: AbortSignal): Promise<BinaryResponse> {
  return downloadBinary(`/api/messages/${messageId}/export/pdf`, { signal });
}

export function exportThreadPdf(threadId: string, signal?: AbortSignal): Promise<BinaryResponse> {
  return downloadBinary(`/api/threads/${threadId}/export/pdf`, { signal });
}
