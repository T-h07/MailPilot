import { forwardRef, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { accountPillClasses, formatLongDate } from "@/features/mailbox/utils/format";
import type { MailMessage } from "@/features/mailbox/model/types";
import { getAccentClasses } from "@/features/mailbox/utils/accent";
import { MailActions } from "@/features/mailbox/components/MailActions";
import { EmailHtmlViewer } from "@/features/mailbox/components/EmailHtmlViewer";
import { AttachmentList } from "@/features/mailbox/components/AttachmentList";
import { ThreadList } from "@/features/mailbox/components/ThreadList";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { MessageFollowup } from "@/features/mailbox/model/types";

type PreviewPanelProps = {
  selectedMessage: MailMessage | null;
  bodyViewMode: "collapsed" | "inline" | "modal";
  onCollapseBody: () => void;
  onSelectThreadMessage: (messageId: string) => void;
  onRefreshMessage: () => void;
  isRefreshingMessage?: boolean;
  onToggleRead: () => void;
  onLoadFullBody: () => void;
  onViewFullBody: () => void;
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

const HTML_ZOOM_LEVELS = [80, 90, 100, 110, 125] as const;

export const PreviewPanel = forwardRef<HTMLDivElement, PreviewPanelProps>(
  function PreviewPanel(
    {
      selectedMessage,
      bodyViewMode,
      onCollapseBody,
      onSelectThreadMessage,
      onRefreshMessage,
      isRefreshingMessage = false,
      onToggleRead,
      onLoadFullBody,
      onViewFullBody,
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
    const [inlineZoom, setInlineZoom] = useState<number>(90);
    const [modalZoom, setModalZoom] = useState<number>(90);

    useEffect(() => {
      setInlineZoom(90);
      setModalZoom(90);
    }, [selectedMessage?.id]);

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
    const bodyText = selectedMessage.bodyCache ?? "";
    const isModalOpen = bodyViewMode === "modal";

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
                onRefreshMessage={onRefreshMessage}
                isRefreshingMessage={isRefreshingMessage}
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
              {bodyViewMode === "collapsed" && (
                <div className="space-y-3 rounded-lg border border-border bg-background p-3">
                  <p className="text-sm text-muted-foreground">{selectedMessage.snippet}</p>
                  <div className="flex flex-wrap gap-2">
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
                    <Button
                      className="gap-2"
                      disabled={isLoadingBody}
                      onClick={onViewFullBody}
                      size="sm"
                      variant="outline"
                    >
                      {isLoadingBody && <Loader2 className="h-4 w-4 animate-spin" />}
                      View full body
                    </Button>
                  </div>
                </div>
              )}

              {bodyViewMode === "inline" && (
                hasCachedBody ? (
                  isHtmlBody ? (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">Zoom</span>
                          <select
                            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                            onChange={(event) => setInlineZoom(Number(event.target.value))}
                            value={inlineZoom}
                          >
                            {HTML_ZOOM_LEVELS.map((zoomLevel) => (
                              <option key={`inline-zoom-${zoomLevel}`} value={zoomLevel}>
                                {zoomLevel}%
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button onClick={onViewFullBody} size="sm" variant="outline">
                            View full body
                          </Button>
                          <Button onClick={onCollapseBody} size="sm" variant="secondary">
                            Collapse
                          </Button>
                        </div>
                      </div>
                      <div className="flex h-[65vh] min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-background">
                        <EmailHtmlViewer html={bodyText} zoomPercent={inlineZoom} />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button onClick={onViewFullBody} size="sm" variant="outline">
                          View full body
                        </Button>
                        <Button onClick={onCollapseBody} size="sm" variant="secondary">
                          Collapse
                        </Button>
                      </div>
                      <div className="rounded-lg border border-border bg-background p-3 text-sm leading-relaxed whitespace-pre-wrap">
                        {bodyText}
                      </div>
                    </div>
                  )
                ) : (
                  <div className="space-y-3 rounded-lg border border-border bg-background p-3">
                    <p className="text-sm text-muted-foreground">{selectedMessage.snippet}</p>
                    <div className="flex flex-wrap gap-2">
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
                      <Button onClick={onCollapseBody} size="sm" variant="secondary">
                        Collapse
                      </Button>
                    </div>
                  </div>
                )
              )}
            </CardContent>
          </Card>

          <Dialog
            onOpenChange={(open) => {
              if (!open) {
                onCollapseBody();
              }
            }}
            open={isModalOpen}
          >
            <DialogContent className="flex h-[90vh] w-[90vw] max-w-none flex-col gap-0 overflow-hidden p-0">
              <DialogHeader className="border-b border-border px-4 py-3">
                <DialogTitle className="pr-8 text-base">{selectedMessage.subject}</DialogTitle>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>From {selectedMessage.senderName} &lt;{selectedMessage.senderEmail}&gt;</span>
                  <span>•</span>
                  <span>{formatLongDate(selectedMessage.receivedAt)}</span>
                </div>
                <Badge
                  className={cn(
                    "w-fit border text-[10px]",
                    accountPillClasses(selectedMessage.accountColorToken),
                  )}
                >
                  {selectedMessage.accountLabel}
                </Badge>
              </DialogHeader>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Zoom</span>
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    disabled={!hasCachedBody || !isHtmlBody}
                    onChange={(event) => setModalZoom(Number(event.target.value))}
                    value={modalZoom}
                  >
                    {HTML_ZOOM_LEVELS.map((zoomLevel) => (
                      <option key={`modal-zoom-${zoomLevel}`} value={zoomLevel}>
                        {zoomLevel}%
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={onOpenInGmail} size="sm" variant="outline">
                    Open in Gmail
                  </Button>
                  {!hasCachedBody && (
                    <Button
                      className="gap-2"
                      disabled={isLoadingBody}
                      onClick={onViewFullBody}
                      size="sm"
                      variant="outline"
                    >
                      {isLoadingBody && <Loader2 className="h-4 w-4 animate-spin" />}
                      {isLoadingBody ? "Loading..." : "Load full body"}
                    </Button>
                  )}
                  <Button onClick={onCollapseBody} size="sm" variant="secondary">
                    Close
                  </Button>
                </div>
              </div>
              <div className="flex-1 min-h-0 p-4">
                {hasCachedBody ? (
                  isHtmlBody ? (
                    <div className="h-full overflow-hidden rounded-lg border border-border bg-background">
                      <EmailHtmlViewer html={bodyText} zoomPercent={modalZoom} />
                    </div>
                  ) : (
                    <ScrollArea className="h-full rounded-lg border border-border bg-background p-3">
                      <div className="text-sm leading-relaxed whitespace-pre-wrap">{bodyText}</div>
                    </ScrollArea>
                  )
                ) : (
                  <div className="mailbox-empty-state flex h-full items-center justify-center p-8 text-center">
                    <div>
                      <p className="text-sm font-medium">Full body is not loaded yet.</p>
                      <p className="pt-1 text-xs text-muted-foreground">
                        Load full body to render this message in the large viewer.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>

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
