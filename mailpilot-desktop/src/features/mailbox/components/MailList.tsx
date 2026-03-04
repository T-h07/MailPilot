import { useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { MailMessage } from "@/features/mailbox/model/types";
import { MailRow } from "@/features/mailbox/components/MailRow";

type MailListProps = {
  messages: MailMessage[];
  selectedMessageId: string | null;
  searchQuery: string;
  onSelectMessage: (messageId: string) => void;
  onFocusPreview: () => void;
};

export function MailList({
  messages,
  selectedMessageId,
  searchQuery,
  onSelectMessage,
  onFocusPreview,
}: MailListProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const selectedIndex = useMemo(
    () => messages.findIndex((message) => message.id === selectedMessageId),
    [messages, selectedMessageId],
  );

  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    estimateSize: () => 124,
    getScrollElement: () => parentRef.current,
    overscan: 12,
  });

  useEffect(() => {
    if (selectedIndex >= 0) {
      rowVirtualizer.scrollToIndex(selectedIndex, { align: "auto" });
    }
  }, [rowVirtualizer, selectedIndex]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (messages.length === 0) {
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const currentIndex = selectedIndex >= 0 ? selectedIndex : 0;
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex = Math.min(Math.max(currentIndex + direction, 0), messages.length - 1);
      onSelectMessage(messages[nextIndex].id);
    } else if (event.key === "Enter") {
      event.preventDefault();
      onFocusPreview();
    }
  };

  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-dashed bg-card/50 p-8 text-center">
        <div>
          <p className="text-sm font-medium">No messages match this filter.</p>
          <p className="pt-1 text-xs text-muted-foreground">
            Adjust scope, search, or quick filters to continue.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="h-full rounded-xl border bg-card/60 p-2"
      onKeyDown={onKeyDown}
      ref={parentRef}
      role="listbox"
      tabIndex={0}
    >
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          position: "relative",
          width: "100%",
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualItem) => {
          const message = messages[virtualItem.index];
          return (
            <div
              key={virtualItem.key}
              style={{
                left: 0,
                paddingBottom: "0.5rem",
                position: "absolute",
                top: 0,
                transform: `translateY(${virtualItem.start}px)`,
                width: "100%",
              }}
            >
              <MailRow
                isSelected={message.id === selectedMessageId}
                message={message}
                onSelect={onSelectMessage}
                searchQuery={searchQuery}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
