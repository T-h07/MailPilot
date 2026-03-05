import { forwardRef } from "react";
import { Loader2 } from "lucide-react";
import { accountPillClasses, formatLongDate } from "@/features/mailbox/utils/format";
import type { MailMessage } from "@/features/mailbox/model/types";
import { getAccentClasses } from "@/features/mailbox/utils/accent";
import { MailActions } from "@/features/mailbox/components/MailActions";
import { EmailHtmlView } from "@/features/mailbox/components/EmailHtmlView";
import { AttachmentList } from "@/features/mailbox/components/AttachmentList";
import { ThreadList } from "@/features/mailbox/components/ThreadList";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { MessageFollowup } from "@/features/mailbox/model/types";

type PreviewPanelProps = {
  selectedMessage: MailMessage | null;
  onSelectThreadMessage: (messageId: string) => void;
  onToggleRead: () => void;
  onLoadFullBody: () => void;
  isLoadingBody?: boolean;
  onOpenInGmail: () => void;
  onComposeAction: (action: "reply" | "reply-all" | "forward") => void;
  isLoading?: boolean;
  statusMessage?: string | null;
  isFollowupUpdating?: boolean;
  onToggleNeedsReply: () => void;
  onSetDueToday: () => void;
  onSetDueTomorrow: () => void;
  onClearDueDate: () => void;
  onSnoozeDays: (days: 1 | 3 | 7) => void;
  onClearSnooze: () => void;
  onToggleFollowupStatus: () => void;
  onDownloadAttachment: (attachmentId: string, filename: string) => void;
  activeAttachmentDownloadId?: string | null;
  onExportMessagePdf: () => void;
  onExportThreadPdf: () => void;
  isExportingPdf?: boolean;
};

function formatFollowupLine(followup: MessageFollowup): string {
  const parts: string[] = [followup.status === "DONE" ? "Done" : "Open"];
  if (followup.needsReply) {
    parts.push("Needs reply");
  }
  if (followup.dueAt) {
    parts.push(`Due ${formatLongDate(followup.dueAt)}`);
  }
  if (followup.snoozedUntil) {
    parts.push(`Snoozed until ${formatLongDate(followup.snoozedUntil)}`);
  }
  return parts.join(" • ");
}

export const PreviewPanel = forwardRef<HTMLDivElement, PreviewPanelProps>(
  function PreviewPanel(
    {
      selectedMessage,
      onSelectThreadMessage,
      onToggleRead,
      onLoadFullBody,
      isLoadingBody = false,
      onOpenInGmail,
      onComposeAction,
      isLoading = false,
      statusMessage = null,
      isFollowupUpdating = false,
      onToggleNeedsReply,
      onSetDueToday,
      onSetDueTomorrow,
      onClearDueDate,
      onSnoozeDays,
      onClearSnooze,
      onToggleFollowupStatus,
      onDownloadAttachment,
      activeAttachmentDownloadId = null,
      onExportMessagePdf,
      onExportThreadPdf,
      isExportingPdf = false,
    },
    ref,
  ) {
    if (!selectedMessage) {
      return (
        <div className="mailbox-empty-state flex h-full items-center justify-center p-8 text-center">
          <div>
            <p className="text-sm font-medium">
              {isLoading ? "Loading message..." : "Select a message to preview."}
            </p>
            <p className="pt-1 text-xs text-muted-foreground">
              {statusMessage ??
                "The right panel will show full context, actions, and thread history."}
            </p>
          </div>
        </div>
      );
    }

    const highlightAccent = selectedMessage.highlight
      ? getAccentClasses(selectedMessage.highlight.accent)
      : null;
    const hasCachedBody = selectedMessage.bodyCache !== null;
    const isHtmlBody = selectedMessage.bodyMime?.toLowerCase().startsWith("text/html") ?? false;
    const isDark = typeof window !== "undefined"
      ? window.document.documentElement.classList.contains("dark")
      : false;
    const bodyText = selectedMessage.bodyCache ?? "";

    return (
      <ScrollArea className="mailbox-panel h-full" ref={ref}>
        <div className="space-y-4 p-4">
          <Card
            className={cn(
              "border-border bg-card shadow-none",
              selectedMessage.highlight && highlightAccent?.border,
            )}
          >
            <CardHeader className="space-y-3">
              <div className="space-y-2">
                <CardTitle className="text-lg leading-tight">{selectedMessage.subject}</CardTitle>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className={cn(selectedMessage.highlight && highlightAccent?.text)}>
                    From {selectedMessage.senderName} &lt;{selectedMessage.senderEmail}&gt;
                  </span>
                  <span>•</span>
                  <span>{formatLongDate(selectedMessage.receivedAt)}</span>
                </div>
                {statusMessage && <p className="text-xs text-muted-foreground">{statusMessage}</p>}
                <Badge
                  className={cn(
                    "w-fit border text-[10px]",
                    accountPillClasses(selectedMessage.accountColorToken),
                  )}
                >
                  {selectedMessage.accountLabel}
                </Badge>
                {selectedMessage.highlight && (
                  <Badge
                    className={cn("w-fit border text-[10px] uppercase", highlightAccent?.badge)}
                    variant="outline"
                  >
                    {selectedMessage.highlight.label}
                  </Badge>
                )}
                <div className="rounded-lg border border-border bg-background p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Followup
                  </p>
                  <p className="pt-1 text-xs text-muted-foreground">
                    {formatFollowupLine(selectedMessage.followup)}
                  </p>
                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button
                      disabled={isFollowupUpdating}
                      onClick={onToggleNeedsReply}
                      size="sm"
                      variant="outline"
                    >
                      {selectedMessage.followup.needsReply ? "Unset needs reply" : "Mark needs reply"}
                    </Button>
                    <Button
                      disabled={isFollowupUpdating}
                      onClick={onSetDueToday}
                      size="sm"
                      variant="outline"
                    >
                      Due today 18:00
                    </Button>
                    <Button
                      disabled={isFollowupUpdating}
                      onClick={onSetDueTomorrow}
                      size="sm"
                      variant="outline"
                    >
                      Due tomorrow 18:00
                    </Button>
                    <Button
                      disabled={isFollowupUpdating}
                      onClick={onClearDueDate}
                      size="sm"
                      variant="outline"
                    >
                      Clear due
                    </Button>
                    <Button
                      disabled={isFollowupUpdating}
                      onClick={() => onSnoozeDays(1)}
                      size="sm"
                      variant="outline"
                    >
                      Snooze 1d
                    </Button>
                    <Button
                      disabled={isFollowupUpdating}
                      onClick={() => onSnoozeDays(3)}
                      size="sm"
                      variant="outline"
                    >
                      Snooze 3d
                    </Button>
                    <Button
                      disabled={isFollowupUpdating}
                      onClick={() => onSnoozeDays(7)}
                      size="sm"
                      variant="outline"
                    >
                      Snooze 7d
                    </Button>
                    <Button
                      disabled={isFollowupUpdating}
                      onClick={onClearSnooze}
                      size="sm"
                      variant="outline"
                    >
                      Clear snooze
                    </Button>
                    <Button
                      disabled={isFollowupUpdating}
                      onClick={onToggleFollowupStatus}
                      size="sm"
                      variant="outline"
                    >
                      {selectedMessage.followup.status === "DONE" ? "Reopen" : "Mark done"}
                    </Button>
                  </div>
                </div>
              </div>
              <MailActions
                isUnread={selectedMessage.isUnread}
                onPrimaryAction={onComposeAction}
                onExportMessagePdf={onExportMessagePdf}
                onExportThreadPdf={onExportThreadPdf}
                canExportThread={Boolean(selectedMessage.threadId)}
                isExportingPdf={isExportingPdf}
                onOpenInGmail={onOpenInGmail}
                onToggleRead={onToggleRead}
              />
            </CardHeader>
            <CardContent className="space-y-3 min-h-0">
              {hasCachedBody ? (
                isHtmlBody ? (
                  <div className="flex h-[65vh] min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-background">
                    <EmailHtmlView html={bodyText} isDark={isDark} />
                  </div>
                ) : (
                  <div className="rounded-lg border border-border bg-background p-3 text-sm leading-relaxed whitespace-pre-wrap">
                    {bodyText}
                  </div>
                )
              ) : (
                <div className="space-y-3 rounded-lg border border-border bg-background p-3">
                  <p className="text-sm text-muted-foreground">{selectedMessage.snippet}</p>
                  <Button
                    className="gap-2"
                    disabled={isLoadingBody}
                    onClick={onLoadFullBody}
                    size="sm"
                    variant="outline"
                  >
                    {isLoadingBody && <Loader2 className="h-4 w-4 animate-spin" />}
                    {isLoadingBody ? "Loading..." : "Load full body"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <AttachmentList
            attachments={selectedMessage.attachments}
            onDownloadAttachment={onDownloadAttachment}
            activeDownloadId={activeAttachmentDownloadId}
          />
          <ThreadList
            onSelectThreadMessage={onSelectThreadMessage}
            selectedMessageId={selectedMessage.id}
            threadMessages={selectedMessage.threadMessages}
          />
        </div>
      </ScrollArea>
    );
  },
);
