import { memo, useMemo } from "react";
import { Paperclip } from "lucide-react";
import type { MailMessage } from "@/features/mailbox/model/types";
import { accountPillClasses, formatRelativeTime } from "@/features/mailbox/utils/format";
import { highlightText } from "@/features/mailbox/utils/highlight";
import { getAccentClasses } from "@/features/mailbox/utils/accent";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

type MailRowProps = {
  message: MailMessage;
  isSelected: boolean;
  searchQuery: string;
  onSelect: (messageId: string) => void;
};

type FollowupChip = {
  key: string;
  label: string;
  className?: string;
  variant?: "default" | "secondary" | "destructive" | "outline";
};

function MailRowComponent({ message, isSelected, onSelect, searchQuery }: MailRowProps) {
  const subjectSegments = useMemo(
    () => highlightText(message.subject, searchQuery),
    [message.subject, searchQuery]
  );
  const snippetSegments = useMemo(
    () => highlightText(message.snippet, searchQuery),
    [message.snippet, searchQuery]
  );
  const timeLabel = useMemo(() => formatRelativeTime(message.receivedAt), [message.receivedAt]);
  const highlightAccent = message.highlight ? getAccentClasses(message.highlight.accent) : null;

  const visibleTags = message.tags.slice(0, 2);
  const overflowTagCount = Math.max(message.tags.length - visibleTags.length, 0);
  const visibleViewLabels = message.viewLabels.slice(0, 2);
  const overflowViewLabelCount = Math.max(message.viewLabels.length - visibleViewLabels.length, 0);
  const followupChips: FollowupChip[] = [];
  if (message.flags.needsReply) {
    followupChips.push({
      key: "needs-reply",
      label: "NeedsReply",
      className: "",
      variant: "secondary",
    });
  }
  if (message.flags.overdue) {
    followupChips.push({
      key: "overdue",
      label: "Overdue",
      className: "bg-red-600 text-white hover:bg-red-600/90",
    });
  }
  if (message.flags.dueToday) {
    followupChips.push({
      key: "due-today",
      label: "DueToday",
      className: "bg-amber-500 text-amber-950 hover:bg-amber-500/90",
    });
  }
  if (message.flags.snoozed) {
    followupChips.push({
      key: "snoozed",
      label: "Snoozed",
      className: "bg-slate-500 text-white hover:bg-slate-500/90",
    });
  }
  const visibleFollowupChips = followupChips.slice(0, 3);
  const overflowFollowupChipCount = Math.max(followupChips.length - visibleFollowupChips.length, 0);

  return (
    <button
      className={cn(
        "relative h-[126px] w-full overflow-hidden rounded-lg border bg-background p-3 text-left transition-colors",
        isSelected
          ? "border-primary/50 bg-accent ring-1 ring-primary/20 shadow-sm"
          : "border-border hover:bg-accent",
        message.highlight && !isSelected && highlightAccent?.border
      )}
      onClick={() => onSelect(message.id)}
      type="button"
    >
      {message.highlight && (
        <span
          className={cn("absolute bottom-2 left-1 top-2 w-1 rounded-full", highlightAccent?.stripe)}
        />
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "h-2.5 w-2.5 shrink-0 rounded-full",
                message.seenInApp ? "bg-transparent" : "bg-sky-500"
              )}
            />
            <p
              className={cn(
                "truncate text-sm",
                message.isUnread
                  ? "font-semibold text-foreground"
                  : "font-medium text-foreground/90",
                message.highlight && highlightAccent?.text
              )}
            >
              {message.senderName}
            </p>
            {message.hasAttachments && (
              <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
          </div>
          <p className="mailbox-row-subject pt-1 text-sm font-semibold text-foreground">
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
      <p className="mailbox-row-snippet pt-1 text-xs text-muted-foreground">
        {snippetSegments.map((segment, index) => (
          <span
            className={segment.highlighted ? "mailbox-row-highlight" : undefined}
            key={`${message.id}-snippet-${index}`}
          >
            {segment.text}
          </span>
        ))}
      </p>
      <div className="space-y-1 pt-2">
        <div className="mailbox-chip-scroll overflow-x-auto">
          <div className="flex min-w-max items-center gap-1.5 pr-1">
            <Badge
              className={cn(
                "max-w-none shrink-0 border text-[10px]",
                accountPillClasses(message.accountColorToken)
              )}
            >
              {message.accountLabel}
            </Badge>
            {message.highlight && (
              <Badge
                className={cn("shrink-0 border text-[10px] uppercase", highlightAccent?.badge)}
                variant="outline"
              >
                {message.highlight.label}
              </Badge>
            )}
            {visibleFollowupChips.map((chip) => (
              <Badge
                className={cn("shrink-0 text-[10px]", chip.className)}
                key={`${message.id}-${chip.key}`}
                variant={chip.variant}
              >
                {chip.label}
              </Badge>
            ))}
            {overflowFollowupChipCount > 0 && (
              <Badge className="shrink-0 text-[10px]" variant="outline">
                +{overflowFollowupChipCount}
              </Badge>
            )}
            {visibleViewLabels.map((label) => {
              const accent = getAccentClasses(label.colorToken);
              return (
                <Badge
                  className={cn("shrink-0 border text-[10px]", accent.badge)}
                  key={`${message.id}-view-label-${label.id}`}
                  variant="outline"
                >
                  {label.name}
                </Badge>
              );
            })}
            {overflowViewLabelCount > 0 && (
              <Badge className="shrink-0 text-[10px]" variant="outline">
                +{overflowViewLabelCount}
              </Badge>
            )}
          </div>
        </div>
        {(visibleTags.length > 0 || overflowTagCount > 0) && (
          <div className="flex items-center gap-1.5 overflow-hidden whitespace-nowrap">
            {visibleTags.map((tag) => (
              <Badge
                className="shrink-0 text-[10px]"
                key={`${message.id}-tag-${tag}`}
                variant="outline"
              >
                #{tag}
              </Badge>
            ))}
            {overflowTagCount > 0 && (
              <Badge className="shrink-0 text-[10px]" variant="outline">
                +{overflowTagCount}
              </Badge>
            )}
          </div>
        )}
      </div>
    </button>
  );
}

export const MailRow = memo(MailRowComponent, (previous, next) => {
  return (
    previous.message === next.message &&
    previous.isSelected === next.isSelected &&
    previous.searchQuery === next.searchQuery
  );
});
