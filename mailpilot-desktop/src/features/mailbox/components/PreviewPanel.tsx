import { forwardRef } from "react";
import { accountPillClasses, formatLongDate } from "@/features/mailbox/utils/format";
import type { MailMessage } from "@/features/mailbox/model/types";
import { MailActions } from "@/features/mailbox/components/MailActions";
import { AttachmentList } from "@/features/mailbox/components/AttachmentList";
import { ThreadList } from "@/features/mailbox/components/ThreadList";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

type PreviewPanelProps = {
  selectedMessage: MailMessage | null;
  onSelectThreadMessage: (messageId: string) => void;
  onToggleRead: () => void;
  onActionPlaceholder: (label: string) => void;
  isLoading?: boolean;
  statusMessage?: string | null;
};

export const PreviewPanel = forwardRef<HTMLDivElement, PreviewPanelProps>(
  function PreviewPanel(
    {
      selectedMessage,
      onSelectThreadMessage,
      onToggleRead,
      onActionPlaceholder,
      isLoading = false,
      statusMessage = null,
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

    return (
      <ScrollArea className="mailbox-panel h-full" ref={ref}>
        <div className="space-y-4 p-4">
          <Card className="border-border bg-card shadow-none">
            <CardHeader className="space-y-3">
              <div className="space-y-2">
                <CardTitle className="text-lg leading-tight">{selectedMessage.subject}</CardTitle>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>
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
              </div>
              <MailActions
                isUnread={selectedMessage.isUnread}
                onPrimaryAction={(action) => onActionPlaceholder(`${action} is not implemented yet`)}
                onSecondaryAction={(action) =>
                  onActionPlaceholder(`${action.replace("-", " ")} is not implemented yet`)
                }
                onToggleRead={onToggleRead}
              />
            </CardHeader>
            <CardContent className="space-y-3">
              {selectedMessage.bodyCache ? (
                <div className="rounded-lg border border-border bg-background p-3 text-sm leading-relaxed">
                  {selectedMessage.bodyCache.split("\n").map((line, index) => (
                    <p className="pt-2 first:pt-0" key={`${selectedMessage.id}-line-${index}`}>
                      {line}
                    </p>
                  ))}
                </div>
              ) : (
                <div className="space-y-3 rounded-lg border border-border bg-background p-3">
                  <p className="text-sm text-muted-foreground">{selectedMessage.snippet}</p>
                  <Button
                    onClick={() => onActionPlaceholder("Load full body is not implemented yet")}
                    size="sm"
                    variant="outline"
                  >
                    Load full body
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <AttachmentList attachments={selectedMessage.attachments} />
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
