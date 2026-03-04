import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type {
  AccountColorToken,
  AccountScope,
  MailAccount,
  MailMessage,
  QuickFilterKey,
  ThreadMessageSummary,
} from "@/features/mailbox/model/types";
import { CommandBar } from "@/features/mailbox/components/CommandBar";
import { MailList } from "@/features/mailbox/components/MailList";
import { PreviewPanel } from "@/features/mailbox/components/PreviewPanel";
import { listAccounts } from "@/lib/api/accounts";
import {
  getMessage,
  queryMailbox,
  queryMailboxView,
  setRead,
  type MailboxListItem,
  type MessageDetailResponse,
} from "@/lib/api/mailbox";
import type { ViewRecord } from "@/lib/api/views";
import { ApiClientError } from "@/lib/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type MailboxShellProps = {
  context: "inbox" | "view";
  view: ViewRecord | null;
};

type NoticeState = {
  id: number;
  message: string;
};

const ACCOUNT_COLOR_TOKENS: AccountColorToken[] = ["sky", "emerald", "violet", "amber"];
const REQUEST_PAGE_SIZE = 50;

function nameFromEmail(email: string): string {
  return email.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function accountColorFromId(accountId: string): AccountColorToken {
  let hash = 0;
  for (let index = 0; index < accountId.length; index += 1) {
    hash = (hash * 31 + accountId.charCodeAt(index)) >>> 0;
  }
  return ACCOUNT_COLOR_TOKENS[hash % ACCOUNT_COLOR_TOKENS.length];
}

function toMailAccount(accountId: string, accountEmail: string): MailAccount {
  return {
    id: accountId,
    accountEmail,
    accountLabel: accountEmail,
    colorToken: accountColorFromId(accountId),
  };
}

function chipsToFlags(chips: string[]) {
  const chipSet = new Set(chips);
  return {
    needsReply: chipSet.has("NeedsReply"),
    overdue: chipSet.has("Overdue"),
    dueToday: chipSet.has("DueToday"),
    snoozed: chipSet.has("Snoozed"),
  };
}

function followupToFlags(followup: MessageDetailResponse["followup"]) {
  const dueAt = followup?.dueAt ? new Date(followup.dueAt) : null;
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(todayStart.getDate() + 1);

  return {
    needsReply: followup?.status === "OPEN" && followup.needsReply,
    overdue: followup?.status === "OPEN" && dueAt !== null && dueAt.getTime() < now.getTime(),
    dueToday:
      followup?.status === "OPEN" &&
      dueAt !== null &&
      dueAt.getTime() >= todayStart.getTime() &&
      dueAt.getTime() < tomorrowStart.getTime(),
    snoozed:
      followup?.status === "OPEN" &&
      followup.snoozedUntil !== null &&
      new Date(followup.snoozedUntil).getTime() > now.getTime(),
  };
}

function toSummaryMessage(item: MailboxListItem): MailMessage {
  const account = toMailAccount(item.accountId, item.accountEmail);
  return {
    id: item.id,
    accountId: item.accountId,
    accountEmail: item.accountEmail,
    accountLabel: account.accountLabel,
    accountColorToken: account.colorToken,
    senderName: item.senderName,
    senderEmail: item.senderEmail,
    senderDomain: item.senderDomain,
    subject: item.subject,
    snippet: item.snippet,
    bodyCache: null,
    receivedAt: item.receivedAt,
    isUnread: item.isUnread,
    flags: chipsToFlags(item.chips),
    tags: item.tags,
    hasAttachments: item.hasAttachments,
    attachments: [],
    threadId: item.id,
    threadMessages: [],
    highlight: item.highlight,
  };
}

function mergeMessages(existing: MailMessage[], incoming: MailMessage[]): MailMessage[] {
  if (existing.length === 0) {
    return incoming;
  }

  const indexById = new Map(existing.map((message, index) => [message.id, index]));
  const next = [...existing];
  for (const message of incoming) {
    const existingIndex = indexById.get(message.id);
    if (existingIndex === undefined) {
      next.push(message);
    } else {
      next[existingIndex] = { ...next[existingIndex], ...message };
    }
  }
  return next;
}

function mergeAccounts(existing: MailAccount[], incoming: MailAccount[]): MailAccount[] {
  const nextById = new Map(existing.map((account) => [account.id, account]));
  for (const account of incoming) {
    nextById.set(account.id, account);
  }
  return Array.from(nextById.values()).sort((left, right) =>
    left.accountEmail.localeCompare(right.accountEmail),
  );
}

function toThreadSummary(
  threadMessage: MessageDetailResponse["thread"]["messages"][number],
): ThreadMessageSummary {
  return {
    id: threadMessage.id,
    senderName: nameFromEmail(threadMessage.senderEmail),
    senderEmail: threadMessage.senderEmail,
    subject: threadMessage.subject,
    snippet: "",
    receivedAt: threadMessage.receivedAt,
    isUnread: threadMessage.isUnread,
    hasAttachments: false,
  };
}

function buildPreviewMessage(
  summary: MailMessage,
  detail: MessageDetailResponse | undefined,
  accountLookup: Map<string, MailAccount>,
): MailMessage {
  if (!detail) {
    return summary;
  }

  const account = accountLookup.get(detail.accountId) ?? toMailAccount(detail.accountId, detail.accountEmail);
  return {
    ...summary,
    accountId: detail.accountId,
    accountEmail: detail.accountEmail,
    accountLabel: account.accountLabel,
    accountColorToken: account.colorToken,
    senderName: detail.senderName,
    senderEmail: detail.senderEmail,
    subject: detail.subject,
    receivedAt: detail.receivedAt,
    isUnread: detail.isUnread,
    bodyCache: detail.body.content,
    hasAttachments: detail.attachments.length > 0 || summary.hasAttachments,
    attachments: detail.attachments.map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
    })),
    threadId: detail.threadId ?? summary.threadId,
    threadMessages: detail.thread.messages.map((threadMessage) => toThreadSummary(threadMessage)),
    tags: detail.tags,
    flags: followupToFlags(detail.followup),
    highlight: detail.highlight,
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.message === "Request cancelled") {
      return "";
    }
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unexpected API error";
}

function describeView(view: ViewRecord | null): string {
  if (!view) {
    return "Saved view definition could not be loaded.";
  }

  const parts: string[] = [];
  if (view.rules.senderDomains.length > 0) {
    parts.push(`Domains: ${view.rules.senderDomains.slice(0, 2).join(", ")}`);
  }
  if (view.rules.senderEmails.length > 0) {
    parts.push(`Senders: ${view.rules.senderEmails.slice(0, 2).join(", ")}`);
  }
  if (view.rules.keywords.length > 0) {
    parts.push(`Keywords: ${view.rules.keywords.slice(0, 2).join(", ")}`);
  }
  if (view.rules.unreadOnly) {
    parts.push("Unread only");
  }

  return parts.length > 0
    ? parts.slice(0, 3).join(" • ")
    : "Saved mailbox selection with no explicit rule constraints.";
}

function summarizeViewRules(view: ViewRecord | null): string[] {
  if (!view) {
    return [];
  }

  const chips: string[] = [];
  view.rules.senderDomains.slice(0, 2).forEach((domain) => chips.push(`Domain:${domain}`));
  view.rules.senderEmails.slice(0, 2).forEach((email) => chips.push(`Sender:${email}`));
  view.rules.keywords.slice(0, 2).forEach((keyword) => chips.push(`Keyword:${keyword}`));
  if (view.rules.unreadOnly) {
    chips.push("UnreadOnly");
  }
  return chips;
}

export function MailboxShell({ context, view }: MailboxShellProps) {
  const navigate = useNavigate();
  const previewRef = useRef<HTMLDivElement>(null);
  const hideNoticeTimeoutRef = useRef<number | null>(null);
  const listAbortRef = useRef<AbortController | null>(null);
  const detailAbortRef = useRef<AbortController | null>(null);

  const viewSummaryChips = useMemo(() => summarizeViewRules(view), [view]);

  const [accountScope, setAccountScope] = useState<AccountScope>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [activeFilters, setActiveFilters] = useState<Set<QuickFilterKey>>(new Set());
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [notice, setNotice] = useState<NoticeState | null>(null);

  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [detailsById, setDetailsById] = useState<Map<string, MessageDetailResponse>>(new Map());
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const accountLookup = useMemo(() => {
    return new Map(accounts.map((account) => [account.id, account]));
  }, [accounts]);

  const activeFiltersKey = useMemo(() => Array.from(activeFilters).sort().join("|"), [activeFilters]);
  const scopeDependency = context === "inbox" ? accountScope : "VIEW_SCOPE";

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim());
    }, 250);
    return () => window.clearTimeout(handle);
  }, [searchQuery]);

  useEffect(() => {
    const controller = new AbortController();
    listAccounts(controller.signal)
      .then((apiAccounts) => {
        const mappedAccounts = apiAccounts.map((account) => toMailAccount(account.id, account.email));
        setAccounts(mappedAccounts);
      })
      .catch(() => {
        // Accounts can still be discovered from mailbox query responses.
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    return () => {
      listAbortRef.current?.abort();
      detailAbortRef.current?.abort();
      if (hideNoticeTimeoutRef.current !== null) {
        window.clearTimeout(hideNoticeTimeoutRef.current);
      }
    };
  }, []);

  const showNotice = useCallback((message: string) => {
    if (!message) {
      return;
    }
    setNotice({ id: Date.now(), message });
    if (hideNoticeTimeoutRef.current !== null) {
      window.clearTimeout(hideNoticeTimeoutRef.current);
    }
    hideNoticeTimeoutRef.current = window.setTimeout(() => {
      setNotice(null);
    }, 2400);
  }, []);

  const fetchMailbox = useCallback(
    async (append: boolean, cursor: string | null) => {
      if (append && !cursor) {
        return;
      }

      if (context === "view" && !view) {
        setMessages([]);
        setNextCursor(null);
        setListError("View not found. It may have been removed.");
        return;
      }

      listAbortRef.current?.abort();
      const controller = new AbortController();
      listAbortRef.current = controller;

      setListError(null);
      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoadingList(true);
      }

      try {
        const response =
          context === "view" && view
            ? await queryMailboxView(
                {
                  viewId: view.id,
                  q: debouncedSearchQuery.length > 0 ? debouncedSearchQuery : null,
                  filtersOverride: {
                    unreadOnly: activeFilters.has("UNREAD"),
                    needsReply: activeFilters.has("NEEDS_REPLY"),
                    overdue: activeFilters.has("OVERDUE"),
                    dueToday: activeFilters.has("DUE_TODAY"),
                    snoozed: activeFilters.has("SNOOZED"),
                  },
                  pageSize: REQUEST_PAGE_SIZE,
                  cursor,
                },
                controller.signal,
              )
            : await queryMailbox(
                {
                  scope: accountScope === "ALL" ? {} : { accountIds: [accountScope] },
                  q: debouncedSearchQuery.length > 0 ? debouncedSearchQuery : null,
                  filters: {
                    unreadOnly: activeFilters.has("UNREAD"),
                    needsReply: activeFilters.has("NEEDS_REPLY"),
                    overdue: activeFilters.has("OVERDUE"),
                    dueToday: activeFilters.has("DUE_TODAY"),
                    snoozed: activeFilters.has("SNOOZED"),
                    senderDomains: [],
                    senderEmails: [],
                    keywords: [],
                  },
                  sort: "RECEIVED_DESC",
                  pageSize: REQUEST_PAGE_SIZE,
                  cursor,
                },
                controller.signal,
              );

        const incomingMessages = response.items.map((item) => toSummaryMessage(item));
        const incomingAccounts = response.items.map((item) => toMailAccount(item.accountId, item.accountEmail));

        setAccounts((previous) => mergeAccounts(previous, incomingAccounts));
        setMessages((previous) => (append ? mergeMessages(previous, incomingMessages) : incomingMessages));
        setNextCursor(response.nextCursor);
      } catch (error) {
        const message = toErrorMessage(error);
        if (!message) {
          return;
        }
        setListError(message);
        if (!append) {
          setMessages([]);
          setNextCursor(null);
        }
      } finally {
        if (append) {
          setIsLoadingMore(false);
        } else {
          setIsLoadingList(false);
        }
      }
    },
    [context, view, debouncedSearchQuery, activeFilters, accountScope],
  );

  useEffect(() => {
    setSelectedMessageId(null);
    setDetailsById(new Map());
    fetchMailbox(false, null);
  }, [fetchMailbox, context, view?.id, scopeDependency, debouncedSearchQuery, activeFiltersKey]);

  useEffect(() => {
    if (messages.length === 0) {
      setSelectedMessageId(null);
      return;
    }

    const selectedStillVisible = messages.some((message) => message.id === selectedMessageId);
    if (!selectedStillVisible) {
      setSelectedMessageId(messages[0].id);
    }
  }, [messages, selectedMessageId]);

  useEffect(() => {
    if (!selectedMessageId) {
      setDetailError(null);
      return;
    }
    if (detailsById.has(selectedMessageId)) {
      return;
    }

    detailAbortRef.current?.abort();
    const controller = new AbortController();
    detailAbortRef.current = controller;

    setIsLoadingDetail(true);
    setDetailError(null);

    getMessage(selectedMessageId, controller.signal)
      .then((detail) => {
        setDetailsById((previous) => {
          const next = new Map(previous);
          next.set(detail.id, detail);
          return next;
        });

        setAccounts((previous) =>
          mergeAccounts(previous, [toMailAccount(detail.accountId, detail.accountEmail)]),
        );
      })
      .catch((error) => {
        const message = toErrorMessage(error);
        if (!message) {
          return;
        }
        setDetailError(message);
      })
      .finally(() => {
        setIsLoadingDetail(false);
      });
  }, [detailsById, selectedMessageId]);

  const selectedSummary = useMemo(
    () => messages.find((message) => message.id === selectedMessageId) ?? null,
    [messages, selectedMessageId],
  );

  const selectedMessage = useMemo(() => {
    if (!selectedSummary) {
      return null;
    }
    return buildPreviewMessage(selectedSummary, detailsById.get(selectedSummary.id), accountLookup);
  }, [accountLookup, detailsById, selectedSummary]);

  const applyUnreadState = useCallback((messageId: string, isUnread: boolean) => {
    setMessages((previous) =>
      previous.map((message) =>
        message.id === messageId
          ? {
              ...message,
              isUnread,
              threadMessages: message.threadMessages.map((threadMessage) =>
                threadMessage.id === messageId
                  ? {
                      ...threadMessage,
                      isUnread,
                    }
                  : threadMessage,
              ),
            }
          : message,
      ),
    );

    setDetailsById((previous) => {
      const detail = previous.get(messageId);
      if (!detail) {
        return previous;
      }
      const next = new Map(previous);
      next.set(messageId, {
        ...detail,
        isUnread,
        thread: {
          messages: detail.thread.messages.map((threadMessage) =>
            threadMessage.id === messageId
              ? {
                  ...threadMessage,
                  isUnread,
                }
              : threadMessage,
          ),
        },
      });
      return next;
    });
  }, []);

  const handleToggleRead = useCallback(async () => {
    if (!selectedMessage) {
      return;
    }

    const nextIsUnread = !selectedMessage.isUnread;
    applyUnreadState(selectedMessage.id, nextIsUnread);
    showNotice(nextIsUnread ? "Marked as unread" : "Marked as read");

    try {
      await setRead(selectedMessage.id, nextIsUnread);
    } catch (error) {
      applyUnreadState(selectedMessage.id, selectedMessage.isUnread);
      showNotice(toErrorMessage(error) || "Failed to update read state");
    }
  }, [applyUnreadState, selectedMessage, showNotice]);

  const handleSelectThreadMessage = useCallback(
    (messageId: string) => {
      const exists = messages.some((message) => message.id === messageId);
      if (!exists) {
        showNotice("Thread message is outside the current filter");
        return;
      }
      setSelectedMessageId(messageId);
    },
    [messages, showNotice],
  );

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
    setDebouncedSearchQuery("");
    if (context === "inbox") {
      setAccountScope("ALL");
    }
  }, [context]);

  const heading = context === "view" ? `View: ${view?.name ?? "Missing"}` : "Inbox";
  const subtitle =
    context === "view"
      ? describeView(view)
      : "Everything is a mailbox: unified queue across accounts and contexts.";

  return (
    <section className="space-y-4">
      <div className="mailbox-panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{heading}</h1>
            <p className="pt-1 text-sm text-muted-foreground">{subtitle}</p>
          </div>
          <Badge variant="secondary">
            {isLoadingList && messages.length === 0
              ? "Loading..."
              : `${messages.length.toLocaleString()} messages`}
          </Badge>
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
        accounts={accounts}
        activeFilters={activeFilters}
        hideAccountScope={context === "view"}
        onAccountScopeChange={setAccountScope}
        onResetFilters={resetFilters}
        onSearchQueryChange={setSearchQuery}
        onSettingsShortcut={() => navigate("/settings")}
        onToggleFilter={toggleQuickFilter}
        searchQuery={searchQuery}
      />

      <div className="mailbox-grid grid min-h-[560px] gap-4">
        <div className="flex h-full flex-col gap-3">
          {listError ? (
            <div className="mailbox-empty-state flex h-full items-center justify-center p-8">
              <div className="text-center">
                <p className="text-sm font-medium">Could not load mailbox.</p>
                <p className="pt-1 text-xs text-muted-foreground">{listError}</p>
                <Button
                  className="mt-4"
                  onClick={() => fetchMailbox(false, null)}
                  size="sm"
                  variant="outline"
                >
                  Retry
                </Button>
              </div>
            </div>
          ) : messages.length === 0 ? (
            <div className="mailbox-empty-state flex h-full items-center justify-center p-8">
              <div className="text-center">
                <p className="text-sm font-medium">
                  {isLoadingList ? "Loading mailbox..." : "No messages in this view."}
                </p>
                <p className="pt-1 text-xs text-muted-foreground">
                  {isLoadingList
                    ? "Fetching data from the server."
                    : "Clear filters to bring messages back."}
                </p>
                {!isLoadingList && (
                  <Button className="mt-4" onClick={resetFilters} size="sm" variant="outline">
                    Reset filters
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <MailList
              messages={messages}
              onFocusPreview={() => previewRef.current?.focus()}
              onSelectMessage={setSelectedMessageId}
              searchQuery={debouncedSearchQuery}
              selectedMessageId={selectedMessageId}
            />
          )}

          {nextCursor && !listError && messages.length > 0 && (
            <div className="flex justify-center">
              <Button
                disabled={isLoadingMore}
                onClick={() => fetchMailbox(true, nextCursor)}
                size="sm"
                variant="outline"
              >
                {isLoadingMore ? "Loading..." : "Load more"}
              </Button>
            </div>
          )}
        </div>

        <PreviewPanel
          isLoading={isLoadingDetail}
          onActionPlaceholder={showNotice}
          onSelectThreadMessage={handleSelectThreadMessage}
          onToggleRead={handleToggleRead}
          ref={previewRef}
          selectedMessage={selectedMessage}
          statusMessage={detailError}
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
