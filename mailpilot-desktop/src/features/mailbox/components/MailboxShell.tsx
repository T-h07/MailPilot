import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type {
  AccountColorToken,
  AccountScope,
  MailAccount,
  MessageFollowup,
  MailMessage,
  QuickFilterKey,
  ThreadMessageSummary,
} from "@/features/mailbox/model/types";
import { CommandBar } from "@/features/mailbox/components/CommandBar";
import { MailList } from "@/features/mailbox/components/MailList";
import { PreviewPanel } from "@/features/mailbox/components/PreviewPanel";
import { listAccounts } from "@/lib/api/accounts";
import { downloadAttachmentFile, exportMessagePdf, exportThreadPdf } from "@/lib/api/exports";
import {
  getMessage,
  queryMailbox,
  queryMailboxView,
  setRead,
  type MailboxListItem,
  type MessageDetailResponse,
} from "@/lib/api/mailbox";
import { runFollowupAction, updateFollowup, type FollowupState } from "@/lib/api/followups";
import { emitFollowupUpdated } from "@/lib/events/followups";
import { useLiveEvents } from "@/lib/events/live-events-context";
import type { ViewRecord } from "@/lib/api/views";
import { ApiClientError } from "@/lib/api/client";
import { saveBinaryWithDialog } from "@/lib/files/save-binary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type ForcedMailboxFilters = {
  needsReply?: boolean;
  overdue?: boolean;
  dueToday?: boolean;
  snoozed?: boolean;
  allOpen?: boolean;
};

type MailboxShellProps = {
  context: "inbox" | "view";
  view: ViewRecord | null;
  titleOverride?: string;
  subtitleOverride?: string;
  hideAccountScope?: boolean;
  forcedFilters?: ForcedMailboxFilters;
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

function defaultFollowupState(): MessageFollowup {
  return {
    status: "OPEN",
    needsReply: false,
    dueAt: null,
    snoozedUntil: null,
  };
}

function toMessageFollowup(followup: MessageDetailResponse["followup"] | FollowupState): MessageFollowup {
  return {
    status: followup.status,
    needsReply: followup.needsReply,
    dueAt: followup.dueAt,
    snoozedUntil: followup.snoozedUntil,
  };
}

function toSummaryMessage(item: MailboxListItem): MailMessage {
  const account = toMailAccount(item.accountId, item.accountEmail);
  const inferredFlags = chipsToFlags(item.chips);
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
    flags: inferredFlags,
    tags: item.tags,
    hasAttachments: item.hasAttachments,
    attachments: [],
    threadId: null,
    threadMessages: [],
    followup: {
      status: "OPEN",
      needsReply: inferredFlags.needsReply,
      dueAt: null,
      snoozedUntil: null,
    },
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
    followup: toMessageFollowup(detail.followup),
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

function sanitizeFilename(value: string | null | undefined, fallback: string): string {
  const input = value?.trim();
  if (!input) {
    return fallback;
  }
  const sanitized = input
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized.length > 0 ? sanitized : fallback;
}

function ensurePdfFilename(value: string | null | undefined, fallback: string): string {
  const base = sanitizeFilename(value, fallback);
  return base.toLowerCase().endsWith(".pdf") ? base : `${base}.pdf`;
}

export function MailboxShell({
  context,
  view,
  titleOverride,
  subtitleOverride,
  hideAccountScope = false,
  forcedFilters,
}: MailboxShellProps) {
  const navigate = useNavigate();
  const previewRef = useRef<HTMLDivElement>(null);
  const hideNoticeTimeoutRef = useRef<number | null>(null);
  const listAbortRef = useRef<AbortController | null>(null);
  const detailAbortRef = useRef<AbortController | null>(null);
  const openedMailboxKeyRef = useRef<string | null>(null);
  const { markInboxOpened, markViewOpened } = useLiveEvents();

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
  const [isUpdatingFollowup, setIsUpdatingFollowup] = useState(false);
  const [activeAttachmentDownloadId, setActiveAttachmentDownloadId] = useState<string | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const accountLookup = useMemo(() => {
    return new Map(accounts.map((account) => [account.id, account]));
  }, [accounts]);

  const activeFiltersKey = useMemo(() => Array.from(activeFilters).sort().join("|"), [activeFilters]);
  const scopeDependency = context === "inbox" ? accountScope : "VIEW_SCOPE";
  const forcedFiltersKey = useMemo(
    () => JSON.stringify(forcedFilters ?? {}),
    [forcedFilters],
  );
  const hideScope = hideAccountScope || context === "view";

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim());
    }, 250);
    return () => window.clearTimeout(handle);
  }, [searchQuery]);

  useEffect(() => {
    const next = new Set<QuickFilterKey>();
    if (forcedFilters?.needsReply) {
      next.add("NEEDS_REPLY");
    }
    if (forcedFilters?.overdue) {
      next.add("OVERDUE");
    }
    if (forcedFilters?.dueToday) {
      next.add("DUE_TODAY");
    }
    if (forcedFilters?.snoozed) {
      next.add("SNOOZED");
    }
    setActiveFilters(next);
  }, [forcedFiltersKey, forcedFilters]);

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
        const resolvedNeedsReply = forcedFilters?.needsReply ?? activeFilters.has("NEEDS_REPLY");
        const resolvedOverdue = forcedFilters?.overdue ?? activeFilters.has("OVERDUE");
        const resolvedDueToday = forcedFilters?.dueToday ?? activeFilters.has("DUE_TODAY");
        const resolvedSnoozed = forcedFilters?.snoozed ?? activeFilters.has("SNOOZED");
        const resolvedAllOpen = forcedFilters?.allOpen ?? false;

        const response =
          context === "view" && view
            ? await queryMailboxView(
                {
                  viewId: view.id,
                  q: debouncedSearchQuery.length > 0 ? debouncedSearchQuery : null,
                  filtersOverride: {
                    unreadOnly: activeFilters.has("UNREAD"),
                    needsReply: resolvedNeedsReply,
                    overdue: resolvedOverdue,
                    dueToday: resolvedDueToday,
                    snoozed: resolvedSnoozed,
                    allOpen: resolvedAllOpen,
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
                    needsReply: resolvedNeedsReply,
                    overdue: resolvedOverdue,
                    dueToday: resolvedDueToday,
                    snoozed: resolvedSnoozed,
                    allOpen: resolvedAllOpen,
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
    [context, view, debouncedSearchQuery, activeFilters, accountScope, forcedFiltersKey],
  );

  useEffect(() => {
    setSelectedMessageId(null);
    setDetailsById(new Map());
    fetchMailbox(false, null);
  }, [
    fetchMailbox,
    context,
    view?.id,
    scopeDependency,
    debouncedSearchQuery,
    activeFiltersKey,
    forcedFiltersKey,
  ]);

  useEffect(() => {
    const mailboxKey = context === "inbox" ? "INBOX" : view?.id ? `VIEW:${view.id}` : null;
    if (!mailboxKey || isLoadingList) {
      return;
    }
    if (openedMailboxKeyRef.current === mailboxKey) {
      return;
    }

    openedMailboxKeyRef.current = mailboxKey;
    if (context === "inbox") {
      void markInboxOpened();
      return;
    }
    if (view?.id) {
      void markViewOpened(view.id);
    }
  }, [context, isLoadingList, markInboxOpened, markViewOpened, view?.id]);

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

  const applyFollowupState = useCallback((messageId: string, followup: MessageFollowup) => {
    const nextFlags = followupToFlags(followup);

    setMessages((previous) =>
      previous.map((message) =>
        message.id === messageId
          ? {
              ...message,
              followup,
              flags: nextFlags,
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
        followup: {
          status: followup.status,
          needsReply: followup.needsReply,
          dueAt: followup.dueAt,
          snoozedUntil: followup.snoozedUntil,
        },
      });
      return next;
    });
  }, []);

  const getCurrentFollowup = useCallback(
    (messageId: string): MessageFollowup => {
      const message = messages.find((candidate) => candidate.id === messageId);
      return message?.followup ?? defaultFollowupState();
    },
    [messages],
  );

  const persistFollowup = useCallback(
    async (messageId: string, nextFollowup: MessageFollowup, successMessage: string) => {
      const previousFollowup = getCurrentFollowup(messageId);
      applyFollowupState(messageId, nextFollowup);
      setIsUpdatingFollowup(true);

      try {
        const response = await updateFollowup(messageId, {
          status: nextFollowup.status,
          needsReply: nextFollowup.needsReply,
          dueAt: nextFollowup.dueAt,
          snoozedUntil: nextFollowup.snoozedUntil,
        });
        applyFollowupState(messageId, toMessageFollowup(response.followup));
        emitFollowupUpdated();
        showNotice(successMessage);
      } catch (error) {
        applyFollowupState(messageId, previousFollowup);
        showNotice(toErrorMessage(error) || "Failed to update followup");
      } finally {
        setIsUpdatingFollowup(false);
      }
    },
    [applyFollowupState, getCurrentFollowup, showNotice],
  );

  const applyFollowupAction = useCallback(
    async (
      messageId: string,
      action: "MARK_DONE" | "MARK_OPEN" | "SNOOZE",
      days?: 1 | 3 | 7,
    ) => {
      setIsUpdatingFollowup(true);
      try {
        const response = await runFollowupAction(
          messageId,
          days ? { action, days } : { action },
        );
        applyFollowupState(messageId, toMessageFollowup(response.followup));
        emitFollowupUpdated();
        showNotice("Followup updated");
      } catch (error) {
        showNotice(toErrorMessage(error) || "Failed to update followup");
      } finally {
        setIsUpdatingFollowup(false);
      }
    },
    [applyFollowupState, showNotice],
  );

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

  const handleDownloadAttachment = useCallback(
    async (attachmentId: string, attachmentFilename: string) => {
      setActiveAttachmentDownloadId(attachmentId);
      try {
        const response = await downloadAttachmentFile(attachmentId);
        const defaultFileName = sanitizeFilename(
          response.fileName ?? attachmentFilename,
          `attachment-${attachmentId}.bin`,
        );
        const savedPath = await saveBinaryWithDialog({
          defaultFileName,
          bytes: response.bytes,
        });
        if (savedPath) {
          showNotice(`Attachment saved: ${savedPath}`);
        }
      } catch (error) {
        showNotice(toErrorMessage(error) || "Failed to download attachment");
      } finally {
        setActiveAttachmentDownloadId((current) => (current === attachmentId ? null : current));
      }
    },
    [showNotice],
  );

  const handleExportMessagePdf = useCallback(async () => {
    if (!selectedMessage) {
      return;
    }

    setIsExportingPdf(true);
    try {
      const response = await exportMessagePdf(selectedMessage.id);
      const defaultFileName = ensurePdfFilename(
        response.fileName,
        `mailpilot-message-${selectedMessage.id}`,
      );
      const savedPath = await saveBinaryWithDialog({
        defaultFileName,
        bytes: response.bytes,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (savedPath) {
        showNotice(`PDF exported: ${savedPath}`);
      }
    } catch (error) {
      showNotice(toErrorMessage(error) || "Failed to export message PDF");
    } finally {
      setIsExportingPdf(false);
    }
  }, [selectedMessage, showNotice]);

  const handleExportThreadPdf = useCallback(async () => {
    if (!selectedMessage?.threadId) {
      showNotice("Thread export unavailable for this message.");
      return;
    }

    setIsExportingPdf(true);
    try {
      const response = await exportThreadPdf(selectedMessage.threadId);
      const defaultFileName = ensurePdfFilename(
        response.fileName,
        `mailpilot-thread-${selectedMessage.threadId}`,
      );
      const savedPath = await saveBinaryWithDialog({
        defaultFileName,
        bytes: response.bytes,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (savedPath) {
        showNotice(`Thread PDF exported: ${savedPath}`);
      }
    } catch (error) {
      showNotice(toErrorMessage(error) || "Failed to export thread PDF");
    } finally {
      setIsExportingPdf(false);
    }
  }, [selectedMessage, showNotice]);

  const handleToggleNeedsReply = useCallback(async () => {
    if (!selectedMessage) {
      return;
    }
    const nextFollowup: MessageFollowup = {
      ...selectedMessage.followup,
      status: "OPEN",
      needsReply: !selectedMessage.followup.needsReply,
    };
    await persistFollowup(
      selectedMessage.id,
      nextFollowup,
      nextFollowup.needsReply ? "Marked as needs reply" : "Cleared needs reply",
    );
  }, [persistFollowup, selectedMessage]);

  const handleSetDuePreset = useCallback(
    async (preset: "TODAY" | "TOMORROW") => {
      if (!selectedMessage) {
        return;
      }
      const dueLocal = new Date();
      dueLocal.setHours(18, 0, 0, 0);
      if (preset === "TOMORROW") {
        dueLocal.setDate(dueLocal.getDate() + 1);
      }
      await persistFollowup(
        selectedMessage.id,
        {
          ...selectedMessage.followup,
          status: "OPEN",
          dueAt: dueLocal.toISOString(),
        },
        `Due date set for ${preset === "TODAY" ? "today" : "tomorrow"}`,
      );
    },
    [persistFollowup, selectedMessage],
  );

  const handleClearDueDate = useCallback(async () => {
    if (!selectedMessage) {
      return;
    }
    await persistFollowup(
      selectedMessage.id,
      {
        ...selectedMessage.followup,
        dueAt: null,
      },
      "Due date cleared",
    );
  }, [persistFollowup, selectedMessage]);

  const handleSnoozeDays = useCallback(
    async (days: 1 | 3 | 7) => {
      if (!selectedMessage) {
        return;
      }
      await applyFollowupAction(selectedMessage.id, "SNOOZE", days);
    },
    [applyFollowupAction, selectedMessage],
  );

  const handleClearSnooze = useCallback(async () => {
    if (!selectedMessage) {
      return;
    }
    await persistFollowup(
      selectedMessage.id,
      {
        ...selectedMessage.followup,
        snoozedUntil: null,
      },
      "Snooze cleared",
    );
  }, [persistFollowup, selectedMessage]);

  const handleToggleFollowupStatus = useCallback(async () => {
    if (!selectedMessage) {
      return;
    }
    if (selectedMessage.followup.status === "DONE") {
      await applyFollowupAction(selectedMessage.id, "MARK_OPEN");
      return;
    }
    await applyFollowupAction(selectedMessage.id, "MARK_DONE");
  }, [applyFollowupAction, selectedMessage]);

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
    const next = new Set<QuickFilterKey>();
    if (forcedFilters?.needsReply) {
      next.add("NEEDS_REPLY");
    }
    if (forcedFilters?.overdue) {
      next.add("OVERDUE");
    }
    if (forcedFilters?.dueToday) {
      next.add("DUE_TODAY");
    }
    if (forcedFilters?.snoozed) {
      next.add("SNOOZED");
    }
    setActiveFilters(next);
    setSearchQuery("");
    setDebouncedSearchQuery("");
    if (context === "inbox" && !hideScope) {
      setAccountScope("ALL");
    }
  }, [context, forcedFilters, hideScope]);

  const heading = titleOverride ?? (context === "view" ? `View: ${view?.name ?? "Missing"}` : "Inbox");
  const subtitle =
    subtitleOverride ??
    (context === "view"
      ? describeView(view)
      : "Everything is a mailbox: unified queue across accounts and contexts.");
  const isSearchLoading = isLoadingList && debouncedSearchQuery.length > 0;

  return (
    <section className="space-y-4">
      <div className="mailbox-panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{heading}</h1>
            <p className="pt-1 text-sm text-muted-foreground">{subtitle}</p>
            {debouncedSearchQuery.length > 0 && (
              <p className="pt-1 text-xs text-muted-foreground">
                Search results for &quot;{debouncedSearchQuery}&quot;
              </p>
            )}
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
        hideAccountScope={hideScope}
        onAccountScopeChange={setAccountScope}
        onResetFilters={resetFilters}
        onSearchQueryChange={setSearchQuery}
        isSearchLoading={isSearchLoading}
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
          onClearDueDate={handleClearDueDate}
          onClearSnooze={handleClearSnooze}
          onSelectThreadMessage={handleSelectThreadMessage}
          onSetDueToday={() => {
            void handleSetDuePreset("TODAY");
          }}
          onSetDueTomorrow={() => {
            void handleSetDuePreset("TOMORROW");
          }}
          onSnoozeDays={(days) => {
            void handleSnoozeDays(days);
          }}
          onToggleFollowupStatus={() => {
            void handleToggleFollowupStatus();
          }}
          onToggleNeedsReply={() => {
            void handleToggleNeedsReply();
          }}
          onToggleRead={handleToggleRead}
          onDownloadAttachment={(attachmentId, filename) => {
            void handleDownloadAttachment(attachmentId, filename);
          }}
          activeAttachmentDownloadId={activeAttachmentDownloadId}
          onExportMessagePdf={() => {
            void handleExportMessagePdf();
          }}
          onExportThreadPdf={() => {
            void handleExportThreadPdf();
          }}
          isExportingPdf={isExportingPdf}
          ref={previewRef}
          selectedMessage={selectedMessage}
          statusMessage={detailError}
          isFollowupUpdating={isUpdatingFollowup}
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
