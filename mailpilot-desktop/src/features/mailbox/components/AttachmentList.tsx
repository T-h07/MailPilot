import { Paperclip } from "lucide-react";
import type { MailAttachment } from "@/features/mailbox/model/types";
import { formatBytes } from "@/features/mailbox/utils/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type AttachmentListProps = {
  attachments: MailAttachment[];
};

export function AttachmentList({ attachments }: AttachmentListProps) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Attachments</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {attachments.map((attachment) => (
          <div
            className="flex items-center justify-between rounded-lg border border-border bg-muted px-3 py-2 text-xs"
            key={attachment.id}
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{attachment.filename}</p>
              <p className="truncate text-muted-foreground">{attachment.mimeType}</p>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Paperclip className="h-3.5 w-3.5" />
              <span>{formatBytes(attachment.sizeBytes)}</span>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
