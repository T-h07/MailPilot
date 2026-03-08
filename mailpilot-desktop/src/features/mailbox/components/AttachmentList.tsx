import { Download, FileImage, FileText, FileType, Paperclip } from "lucide-react";
import type { MailAttachment } from "@/features/mailbox/model/types";
import { formatBytes } from "@/features/mailbox/utils/format";
import { StatePanel } from "@/components/common/state-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type AttachmentListProps = {
  attachments: MailAttachment[];
  onDownloadAttachment: (attachmentId: string, filename: string) => void;
  activeDownloadId?: string | null;
};

export function AttachmentList({
  attachments,
  onDownloadAttachment,
  activeDownloadId = null,
}: AttachmentListProps) {
  const downloadableAttachments = attachments.filter((attachment) => !attachment.isInline);

  if (downloadableAttachments.length === 0) {
    return (
      <StatePanel
        compact
        description="Downloadable files appear here when the selected message includes them."
        title="No attachments"
        variant="empty"
      />
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Attachments</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {downloadableAttachments.map((attachment) => (
          <div
            className="flex items-center justify-between rounded-lg border border-border bg-muted px-3 py-2 text-xs"
            key={attachment.id}
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{attachment.filename}</p>
              <p className="truncate text-muted-foreground">{attachment.mimeType}</p>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <AttachmentIcon mimeType={attachment.mimeType} />
              <span>{formatBytes(attachment.sizeBytes)}</span>
            </div>
            <Button
              className="ml-3"
              disabled={activeDownloadId === attachment.id || !attachment.downloadable}
              onClick={() => onDownloadAttachment(attachment.id, attachment.filename)}
              size="sm"
              variant="outline"
            >
              <Download className="h-3.5 w-3.5" />
              {activeDownloadId === attachment.id
                ? "Downloading..."
                : attachment.downloadable
                  ? "Download"
                  : "Unavailable"}
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function AttachmentIcon({ mimeType }: { mimeType: string }) {
  const normalized = mimeType.toLowerCase();
  if (normalized.startsWith("image/")) {
    return <FileImage className="h-3.5 w-3.5" />;
  }
  if (normalized.includes("pdf")) {
    return <FileText className="h-3.5 w-3.5" />;
  }
  if (normalized.includes("msword") || normalized.includes("officedocument")) {
    return <FileType className="h-3.5 w-3.5" />;
  }
  return <Paperclip className="h-3.5 w-3.5" />;
}
