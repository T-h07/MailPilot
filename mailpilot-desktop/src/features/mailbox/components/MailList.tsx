import { memo, useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { MailMessage } from "@/features/mailbox/model/types";
import { StatePanel } from "@/components/common/state-panel";
import { MailRow } from "@/features/mailbox/components/MailRow";

type MailListProps = {
  messages: MailMessage[];
  selectedMessageId: string | null;
  searchQuery: string;
  onSelectMessage: (messageId: string) => void;
  onFocusPreview: () => void;
};

const ROW_HEIGHT_PX = 136;

function MailListComponent({
  messages,
  selectedMessageId,
  searchQuery,
  onSelectMessage,
  onFocusPreview,
}: MailListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const showDebugStats = import.meta.env.VITE_DEBUG === "true";

  const selectedIndex = useMemo(
    () => messages.findIndex((message) => message.id === selectedMessageId),
    [messages, selectedMessageId]
  );

  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    estimateSize: () => ROW_HEIGHT_PX,
    getScrollElement: () => parentRef.current,
    getItemKey: (index) => messages[index]?.id ?? index,
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
      <StatePanel
        centered
        className="mailbox-empty-state"
        description="Adjust scope, quick filters, or search terms to bring messages back into the queue."
        title="No messages match this filter"
        variant="empty"
      />
    );
  }

  return (
    <div
      className="mailbox-panel h-full overflow-y-auto p-2"
      onKeyDown={onKeyDown}
      ref={parentRef}
      role="listbox"
      tabIndex={0}
    >
      {showDebugStats && (
        <div className="sticky top-0 z-10 mb-1 flex justify-end">
          <span className="rounded border border-border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground">
            rows:{messages.length} visible:{rowVirtualizer.getVirtualItems().length}
          </span>
        </div>
      )}
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
                height: `${virtualItem.size}px`,
                left: 0,
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

export const MailList = memo(
  MailListComponent,
  (previous, next) =>
    previous.messages === next.messages &&
    previous.selectedMessageId === next.selectedMessageId &&
    previous.searchQuery === next.searchQuery &&
    previous.onSelectMessage === next.onSelectMessage &&
    previous.onFocusPreview === next.onFocusPreview
);
