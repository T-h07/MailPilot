import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AccountScope, QuickFilterKey } from "@/features/mailbox/model/types";
import { generateMockMailboxData } from "@/features/mailbox/mock/mockData";
import { getViewRule, getViewRuleSummary } from "@/features/mailbox/mock/mockRules";
import { CommandBar } from "@/features/mailbox/components/CommandBar";
import { MailList } from "@/features/mailbox/components/MailList";
import { PreviewPanel } from "@/features/mailbox/components/PreviewPanel";
import { filterMessages, mergeReadOverrides } from "@/features/mailbox/utils/filters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type MailboxShellProps = {
  context: "inbox" | "view";
  viewKey?: string;
};

type NoticeState = {
  id: number;
  message: string;
};

function titleCase(input: string): string {
  return input
    .replace(/[-_]/g, " ")
    .split(" ")
    .map((segment) =>
      segment.length > 0 ? `${segment.charAt(0).toUpperCase()}${segment.slice(1)}` : segment,
    )
    .join(" ");
}

export function MailboxShell({ context, viewKey }: MailboxShellProps) {
  const navigate = useNavigate();
  const previewRef = useRef<HTMLDivElement>(null);
  const hideNoticeTimeoutRef = useRef<number | null>(null);

  const dataset = useMemo(() => generateMockMailboxData(2500), []);
  const viewRule = useMemo(() => getViewRule(viewKey), [viewKey]);
  const viewSummaryChips = useMemo(
    () => (viewRule ? getViewRuleSummary(viewRule) : []),
    [viewRule],
  );

  const [accountScope, setAccountScope] = useState<AccountScope>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilters, setActiveFilters] = useState<Set<QuickFilterKey>>(new Set());
  const [readOverrides, setReadOverrides] = useState<Map<string, boolean>>(new Map());
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [notice, setNotice] = useState<NoticeState | null>(null);

  const effectiveMessages = useMemo(
    () => mergeReadOverrides(dataset.messages, readOverrides),
    [dataset.messages, readOverrides],
  );

  const filteredMessages = useMemo(
    () =>
      filterMessages({
        messages: effectiveMessages,
        accountScope,
        searchQuery,
        quickFilters: activeFilters,
        viewRule,
      }),
    [effectiveMessages, accountScope, searchQuery, activeFilters, viewRule],
  );

  useEffect(() => {
    if (filteredMessages.length === 0) {
      setSelectedMessageId(null);
      return;
    }

    const stillSelected = filteredMessages.some((message) => message.id === selectedMessageId);
    if (!stillSelected) {
      setSelectedMessageId(filteredMessages[0].id);
    }
  }, [filteredMessages, selectedMessageId]);

  useEffect(() => {
    return () => {
      if (hideNoticeTimeoutRef.current !== null) {
        window.clearTimeout(hideNoticeTimeoutRef.current);
      }
    };
  }, []);

  const selectedMessage = useMemo(
    () => filteredMessages.find((message) => message.id === selectedMessageId) ?? null,
    [filteredMessages, selectedMessageId],
  );

  const showNotice = useCallback((message: string) => {
    setNotice({ id: Date.now(), message });
    if (hideNoticeTimeoutRef.current !== null) {
      window.clearTimeout(hideNoticeTimeoutRef.current);
    }
    hideNoticeTimeoutRef.current = window.setTimeout(() => {
      setNotice(null);
    }, 2200);
  }, []);

  const toggleQuickFilter = useCallback((filterKey: QuickFilterKey) => {
    setActiveFilters((previous) => {
      const next = new Set(previous);
      if (next.has(filterKey)) {
        next.delete(filterKey);
      } else {
        next.add(filterKey);
      }
      return next;
    });
  }, []);

  const resetFilters = useCallback(() => {
    setActiveFilters(new Set());
    setSearchQuery("");
    setAccountScope("ALL");
  }, []);

  const handleToggleRead = useCallback(() => {
    if (!selectedMessage) {
      return;
    }
    setReadOverrides((previous) => {
      const next = new Map(previous);
      next.set(selectedMessage.id, !selectedMessage.isUnread);
      return next;
    });
    showNotice(selectedMessage.isUnread ? "Marked as read" : "Marked as unread");
  }, [selectedMessage, showNotice]);

  const handleSelectThreadMessage = useCallback(
    (messageId: string) => {
      const exists = filteredMessages.some((message) => message.id === messageId);
      if (exists) {
        setSelectedMessageId(messageId);
      } else {
        showNotice("Thread message is outside the current filter");
      }
    },
    [filteredMessages, showNotice],
  );

  const heading =
    context === "view" ? `View: ${viewRule?.label ?? titleCase(viewKey ?? "Custom")}` : "Inbox";
  const subtitle =
    context === "view"
      ? viewRule?.summary ?? "Rule-backed message lane based on mock mailbox definitions."
      : "Everything is a mailbox: unified queue across accounts and contexts.";

  return (
    <section className="space-y-4">
      <div className="mailbox-panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{heading}</h1>
            <p className="pt-1 text-sm text-muted-foreground">{subtitle}</p>
          </div>
          <Badge variant="secondary">{filteredMessages.length.toLocaleString()} messages</Badge>
        </div>
        {viewSummaryChips.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-3">
            {viewSummaryChips.map((chip) => (
              <Badge className="text-[11px]" key={chip} variant="outline">
                {chip}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <CommandBar
        accountScope={accountScope}
        accounts={dataset.accounts}
        activeFilters={activeFilters}
        onAccountScopeChange={setAccountScope}
        onResetFilters={resetFilters}
        onSearchQueryChange={setSearchQuery}
        onSettingsShortcut={() => navigate("/settings")}
        onToggleFilter={toggleQuickFilter}
        searchQuery={searchQuery}
      />

      <div className="mailbox-grid grid min-h-[560px] gap-4">
        {filteredMessages.length === 0 ? (
          <div className="mailbox-empty-state flex h-full items-center justify-center p-8">
            <div className="text-center">
              <p className="text-sm font-medium">No messages in this view.</p>
              <p className="pt-1 text-xs text-muted-foreground">
                Clear filters or switch account scope to bring messages back.
              </p>
              <Button className="mt-4" onClick={resetFilters} size="sm" variant="outline">
                Reset filters
              </Button>
            </div>
          </div>
        ) : (
          <MailList
            messages={filteredMessages}
            onFocusPreview={() => previewRef.current?.focus()}
            onSelectMessage={setSelectedMessageId}
            searchQuery={searchQuery}
            selectedMessageId={selectedMessageId}
          />
        )}

        <PreviewPanel
          onActionPlaceholder={showNotice}
          onSelectThreadMessage={handleSelectThreadMessage}
          onToggleRead={handleToggleRead}
          ref={previewRef}
          selectedMessage={selectedMessage}
        />
      </div>

      {notice && (
        <div className="mailbox-toast fixed bottom-5 right-5 z-[60] rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-lg">
          {notice.message}
        </div>
      )}
    </section>
  );
}
