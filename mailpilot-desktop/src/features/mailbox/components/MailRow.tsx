import { memo, useMemo } from "react";
import { Paperclip } from "lucide-react";
import type { MailMessage } from "@/features/mailbox/model/types";
import { accountPillClasses, formatRelativeTime } from "@/features/mailbox/utils/format";
import { highlightText } from "@/features/mailbox/utils/highlight";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

type MailRowProps = {
  message: MailMessage;
  isSelected: boolean;
  searchQuery: string;
  onSelect: (messageId: string) => void;
};

function MailRowComponent({ message, isSelected, onSelect, searchQuery }: MailRowProps) {
  const subjectSegments = useMemo(
    () => highlightText(message.subject, searchQuery),
    [message.subject, searchQuery],
  );
  const snippetSegments = useMemo(
    () => highlightText(message.snippet, searchQuery),
    [message.snippet, searchQuery],
  );
  const timeLabel = useMemo(() => formatRelativeTime(message.receivedAt), [message.receivedAt]);

  const visibleTags = message.tags.slice(0, 2);
  const overflowTagCount = Math.max(message.tags.length - visibleTags.length, 0);

  return (
    <button
      className={cn(
        "w-full rounded-lg border p-3 text-left transition-colors",
        isSelected
          ? "border-primary/50 bg-accent ring-1 ring-primary/20 shadow-sm"
          : "border-border bg-background hover:bg-accent",
      )}
      onClick={() => onSelect(message.id)}
      type="button"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "h-2.5 w-2.5 shrink-0 rounded-full",
                message.isUnread ? "bg-sky-500" : "bg-muted",
              )}
            />
            <p
              className={cn(
                "truncate text-sm",
                message.isUnread ? "font-semibold text-foreground" : "font-medium text-foreground/90",
              )}
            >
              {message.senderName}
            </p>
            {message.hasAttachments && (
              <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
          </div>
          <p className="mailbox-snippet pt-1 text-sm font-semibold text-foreground">
            {subjectSegments.map((segment, index) => (
              <span
                className={segment.highlighted ? "mailbox-row-highlight" : undefined}
                key={`${message.id}-subject-${index}`}
              >
                {segment.text}
              </span>
            ))}
          </p>
        </div>
        <div className="shrink-0 text-xs text-muted-foreground">{timeLabel}</div>
      </div>
      <p className="mailbox-snippet pt-1 text-xs text-muted-foreground">
        {snippetSegments.map((segment, index) => (
          <span
            className={segment.highlighted ? "mailbox-row-highlight" : undefined}
            key={`${message.id}-snippet-${index}`}
          >
            {segment.text}
          </span>
        ))}
      </p>
      <div className="flex flex-wrap items-center gap-1.5 pt-2">
        <Badge className={cn("border text-[10px]", accountPillClasses(message.accountColorToken))}>
          {message.accountLabel}
        </Badge>
        {message.flags.needsReply && (
          <Badge className="text-[10px]" variant="secondary">
            NeedsReply
          </Badge>
        )}
        {message.flags.overdue && (
          <Badge className="bg-red-600 text-[10px] text-white hover:bg-red-600/90">Overdue</Badge>
        )}
        {message.flags.dueToday && (
          <Badge className="bg-amber-500 text-[10px] text-amber-950 hover:bg-amber-500/90">
            DueToday
          </Badge>
        )}
        {message.flags.snoozed && (
          <Badge className="bg-slate-500 text-[10px] text-white hover:bg-slate-500/90">
            Snoozed
          </Badge>
        )}
        {visibleTags.map((tag) => (
          <Badge className="text-[10px]" key={`${message.id}-tag-${tag}`} variant="outline">
            #{tag}
          </Badge>
        ))}
        {overflowTagCount > 0 && (
          <Badge className="text-[10px]" variant="outline">
            +{overflowTagCount}
          </Badge>
        )}
      </div>
    </button>
  );
}

export const MailRow = memo(MailRowComponent, (previous, next) => {
  return (
    previous.message.id === next.message.id &&
    previous.message.isUnread === next.message.isUnread &&
    previous.isSelected === next.isSelected &&
    previous.searchQuery === next.searchQuery
  );
});
