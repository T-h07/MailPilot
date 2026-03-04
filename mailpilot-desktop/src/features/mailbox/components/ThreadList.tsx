import type { ThreadMessageSummary } from "@/features/mailbox/model/types";
import { formatRelativeTime } from "@/features/mailbox/utils/format";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type ThreadListProps = {
  threadMessages: ThreadMessageSummary[];
  selectedMessageId: string;
  onSelectThreadMessage: (messageId: string) => void;
};

export function ThreadList({
  threadMessages,
  selectedMessageId,
  onSelectThreadMessage,
}: ThreadListProps) {
  if (threadMessages.length <= 1) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Conversation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {threadMessages.map((threadMessage) => (
          <button
            className={cn(
              "w-full rounded-lg border px-3 py-2 text-left transition-colors",
              threadMessage.id === selectedMessageId
                ? "border-primary/40 bg-primary/10"
                : "bg-card hover:bg-accent/35",
            )}
            key={threadMessage.id}
            onClick={() => onSelectThreadMessage(threadMessage.id)}
            type="button"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-xs font-semibold">{threadMessage.senderName}</p>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {formatRelativeTime(threadMessage.receivedAt)}
              </span>
            </div>
            <p className="mailbox-snippet pt-1 text-xs font-medium">{threadMessage.subject}</p>
            <p className="mailbox-thread-snippet pt-1 text-[11px] text-muted-foreground">
              {threadMessage.snippet}
            </p>
            {threadMessage.isUnread && (
              <Badge className="mt-2 text-[10px]" variant="secondary">
                Unread
              </Badge>
            )}
          </button>
        ))}
      </CardContent>
    </Card>
  );
}
