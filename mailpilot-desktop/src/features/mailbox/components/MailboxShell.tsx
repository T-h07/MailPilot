import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import type {
  AccountColorToken,
  AccountScope,
  MailAccount,
  MessageFollowup,
  MailMessage,
  QuickFilterKey,
  ThreadMessageSummary,
  ViewLabelChip as MailViewLabelChip,
} from "@/features/mailbox/model/types";
import { CommandBar } from "@/features/mailbox/components/CommandBar";
import { MailList } from "@/features/mailbox/components/MailList";
import { PreviewPanel } from "@/features/mailbox/components/PreviewPanel";
import { ComposeDialog, type ComposeDraft } from "@/features/mailbox/components/ComposeDialog";
import { listAccounts, type AccountRecord } from "@/lib/api/accounts";
import { downloadAttachmentFile, exportMessagePdf, exportThreadPdf } from "@/lib/api/exports";
import { configCheck, getGmailOAuthStatus, startGmailOAuth } from "@/lib/api/oauth";
import {
  getMessage,
  loadMessageBody,
  markSeenInApp,
  type MailboxMode,
  type MailboxSortOrder,
  queryMailbox,
  queryMailboxView,
  setRead,
  type MailboxListItem,
  type MessageDetailResponse,
} from "@/lib/api/mailbox";
import { runFollowupAction, updateFollowup, type FollowupState } from "@/lib/api/followups";
import { emitFollowupUpdated } from "@/lib/events/followups";
import { useLiveEvents } from "@/lib/events/live-events-context";
import {
  listMessageViewLabels,
  listViewLabels,
  replaceMessageViewLabels,
  type ViewLabelRecord,
  type ViewRecord,
} from "@/lib/api/views";
import { listSenderRules } from "@/lib/api/sender-rules";
import { ApiClientError } from "@/api/client";
import { saveBinaryWithDialog } from "@/lib/files/save-binary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type ForcedMailboxFilters = {
  unreadOnly?: boolean;
  needsReply?: boolean;
  overdue?: boolean;
  dueToday?: boolean;
  snoozed?: boolean;
  allOpen?: boolean;
  senderDomains?: string[];
  senderEmails?: string[];
  accountIds?: string[];
};

type MailboxShellProps = {
  context: "inbox" | "view" | "sent";
  view: ViewRecord | null;
  titleOverride?: string;
  subtitleOverride?: string;
  hideAccountScope?: boolean;
  forcedFilters?: ForcedMailboxFilters;
  forcedMailboxMode?: MailboxMode;
};

type NoticeState = {
  id: number;
  message: string;
};

type BodyViewMode = "collapsed" | "inline" | "modal";

const ACCOUNT_COLOR_TOKENS: AccountColorToken[] = ["sky", "emerald", "violet", "amber"];
const REQUEST_PAGE_SIZE = 50;
const OAUTH_POLL_INTERVAL_MS = 2000;
const OAUTH_POLL_TIMEOUT_MS = 45000;
const ALL_LABEL_FILTER_VALUE = "__ALL_LABELS__";

function nameFromEmail(email: string): string {
  return email
    .split("@")[0]
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
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

function toMessageFollowup(
  followup: MessageDetailResponse["followup"] | FollowupState
): MessageFollowup {
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
    bodyMime: null,
    openInGmailUrl: null,
    receivedAt: item.receivedAt,
    isUnread: item.isUnread,
    seenInApp: item.seenInApp,
    flags: inferredFlags,
    tags: item.tags,
    viewLabels: item.viewLabels ?? [],
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
    left.accountEmail.localeCompare(right.accountEmail)
  );
}

function toThreadSummary(
  threadMessage: MessageDetailResponse["thread"]["messages"][number]
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
  accountLookup: Map<string, MailAccount>
): MailMessage {
  if (!detail) {
    return summary;
  }

  const account =
    accountLookup.get(detail.accountId) ?? toMailAccount(detail.accountId, detail.accountEmail);
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
    seenInApp: detail.seenInApp,
    bodyCache: detail.body.content,
    bodyMime: detail.body.mime,
    openInGmailUrl: detail.openInGmailUrl,
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
    viewLabels: summary.viewLabels,
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
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return ((error as { message: string }).message || "").trim();
  }
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Request failed. Check server logs.";
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

function toLabelChips(records: ViewLabelRecord[]): MailViewLabelChip[] {
  return records.map((record) => ({
    id: record.id,
    name: record.name,
    colorToken: record.colorToken,
  }));
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

function leafFilename(pathValue: string): string {
  const normalized = pathValue.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts.length > 0 ? parts[parts.length - 1] : pathValue;
}

function sleep(durationMs: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, durationMs);
  });
}

function withSubjectPrefix(prefix: "Re" | "Fwd", subject: string): string {
  const normalized = subject.trim();
  if (normalized.length === 0) {
    return `${prefix}: (no subject)`;
  }
  const lowercase = normalized.toLowerCase();
  if (prefix === "Re" && lowercase.startsWith("re:")) {
    return normalized;
  }
  if (prefix === "Fwd" && (lowercase.startsWith("fwd:") || lowercase.startsWith("fw:"))) {
    return normalized;
  }
  return `${prefix}: ${normalized}`;
}

function buildQuotedSnippet(message: MailMessage): string {
  const senderLine = `${message.senderName} <${message.senderEmail}>`;
  const dateLine = new Date(message.receivedAt).toLocaleString();
  const quoteSource = message.bodyCache?.trim() || message.snippet.trim();
  const quoteLines = quoteSource
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => `> ${line}`);

  const header = [
    "",
    "",
    "----- Original message -----",
    `From: ${senderLine}`,
    `Date: ${dateLine}`,
    `Subject: ${message.subject}`,
    "",
  ];
  return [...header, ...quoteLines].join("\n");
}

function resolvePreferredAccountId(
  accountRecords: AccountRecord[],
  accounts: MailAccount[],
  preferredAccountId?: string | null
): string {
  if (preferredAccountId && accountRecords.some((account) => account.id === preferredAccountId)) {
    return preferredAccountId;
  }
  const sendEnabled = accountRecords.find(
    (account) => account.provider === "GMAIL" && account.canSend
  );
  if (sendEnabled) {
    return sendEnabled.id;
  }
  const firstGmail = accountRecords.find((account) => account.provider === "GMAIL");
  if (firstGmail) {
    return firstGmail.id;
  }
  if (accounts.length > 0) {
    return accounts[0].id;
  }
  return "";
}

export function MailboxShell({
  context,
  view,
  titleOverride,
  subtitleOverride,
  hideAccountScope = false,
  forcedFilters,
  forcedMailboxMode,
}: MailboxShellProps) {
  const navigate = useNavigate();
  const previewRef = useRef<HTMLDivElement>(null);
  const hideNoticeTimeoutRef = useRef<number | null>(null);
  const listAbortRef = useRef<AbortController | null>(null);
  const listRequestSequenceRef = useRef(0);
  const detailAbortRef = useRef<AbortController | null>(null);
  const viewLabelsAbortRef = useRef<AbortController | null>(null);
  const messageViewLabelsAbortRef = useRef<AbortController | null>(null);
  const detailRequestSequenceRef = useRef(0);
  const seenInFlightByMessageIdRef = useRef<Set<string>>(new Set());
  const openedMailboxKeyRef = useRef<string | null>(null);
  const previousMailboxQueryKeyRef = useRef<string | null>(null);
  const previousSyncStatesRef = useRef<Record<string, "RUNNING" | "IDLE" | "ERROR">>({});
  const { markInboxOpened, markViewOpened, syncByAccountId } = useLiveEvents();

  const viewSummaryChips = useMemo(() => summarizeViewRules(view), [view]);

  const [accountScope, setAccountScope] = useState<AccountScope>("ALL");
  const [mailboxMode, setMailboxMode] = useState<MailboxMode>(forcedMailboxMode ?? "INBOX");
  const [sortOrder, setSortOrder] = useState<MailboxSortOrder>("RECEIVED_DESC");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [activeFilters, setActiveFilters] = useState<Set<QuickFilterKey>>(new Set());
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [selectedMessageDetail, setSelectedMessageDetail] = useState<MessageDetailResponse | null>(
    null
  );
  const [bodyViewMode, setBodyViewMode] = useState<BodyViewMode>("collapsed");
  const [notice, setNotice] = useState<NoticeState | null>(null);

  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [accountRecords, setAccountRecords] = useState<AccountRecord[]>([]);
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRefreshingMailbox, setIsRefreshingMailbox] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isRefreshingMessage, setIsRefreshingMessage] = useState(false);
  const [bodyLoadingMessageId, setBodyLoadingMessageId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [isUpdatingFollowup, setIsUpdatingFollowup] = useState(false);
  const [activeAttachmentDownloadId, setActiveAttachmentDownloadId] = useState<string | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [viewLabelOptions, setViewLabelOptions] = useState<ViewLabelRecord[]>([]);
  const [senderRuleLabelOptions, setSenderRuleLabelOptions] = useState<string[]>([]);
  const [selectedViewLabels, setSelectedViewLabels] = useState<MailViewLabelChip[]>([]);
  const [isLoadingViewLabels, setIsLoadingViewLabels] = useState(false);
  const [isSavingViewLabels, setIsSavingViewLabels] = useState(false);
  const [selectedLabelFilter, setSelectedLabelFilter] = useState(ALL_LABEL_FILTER_VALUE);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeDraft, setComposeDraft] = useState<ComposeDraft>({
    mode: "NEW",
    accountId: "",
    to: "",
    cc: "",
    bcc: "",
    subject: "",
    bodyText: "",
    replyToMessageDbId: null,
  });

  const accountLookup = useMemo(() => {
    return new Map(accounts.map((account) => [account.id, account]));
  }, [accounts]);
  const hideScope = hideAccountScope || context === "view";
  const isViewContext = context === "view" && Boolean(view);

  const labelFilterOptions = useMemo(() => {
    const labelMap = new Map<string, string>();
    for (const senderRuleLabel of senderRuleLabelOptions) {
      const normalized = senderRuleLabel.trim();
      if (normalized.length === 0) {
        continue;
      }
      const key = normalized.toLowerCase();
      if (!labelMap.has(key)) {
        labelMap.set(key, normalized);
      }
    }
    if (isViewContext) {
      for (const viewLabel of viewLabelOptions) {
        const normalized = viewLabel.name.trim();
        if (normalized.length === 0) {
          continue;
        }
        const key = normalized.toLowerCase();
        if (!labelMap.has(key)) {
          labelMap.set(key, normalized);
        }
      }
    }

    const sortedLabels = Array.from(labelMap.values()).sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base" })
    );

    return [
      { value: ALL_LABEL_FILTER_VALUE, label: "All labels" },
      ...sortedLabels.map((label) => ({ value: label, label })),
    ];
  }, [isViewContext, senderRuleLabelOptions, viewLabelOptions]);

  const selectedLabelNames = useMemo(
    () => (selectedLabelFilter === ALL_LABEL_FILTER_VALUE ? [] : [selectedLabelFilter]),
    [selectedLabelFilter]
  );

  const activeFiltersKey = useMemo(
    () => Array.from(activeFilters).sort().join("|"),
    [activeFilters]
  );
  const forcedFiltersKey = useMemo(() => JSON.stringify(forcedFilters ?? {}), [forcedFilters]);
  const mailboxQueryKey = useMemo(
    () =>
      JSON.stringify({
        context,
        viewId: view?.id ?? null,
        scope: context === "view" ? "VIEW_SCOPE" : accountScope,
        filters: activeFiltersKey,
        forced: forcedFiltersKey,
        q: debouncedSearchQuery,
        labelFilter: selectedLabelFilter,
        sort: sortOrder,
        mode: mailboxMode,
      }),
    [
      accountScope,
      activeFiltersKey,
      context,
      debouncedSearchQuery,
      forcedFiltersKey,
      selectedLabelFilter,
      mailboxMode,
      sortOrder,
      view?.id,
    ]
  );
  const selectedViewLabelIds = useMemo(
    () => selectedViewLabels.map((label) => label.id),
    [selectedViewLabels]
  );

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim());
    }, 250);
    return () => window.clearTimeout(handle);
  }, [searchQuery]);

  useEffect(() => {
    const next = new Set<QuickFilterKey>();
    if (forcedFilters?.unreadOnly) {
      next.add("UNREAD");
    }
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
    if (context === "view") {
      return;
    }
    if (forcedFilters?.accountIds && forcedFilters.accountIds.length === 1) {
      setAccountScope(forcedFilters.accountIds[0]);
      return;
    }
    if (forcedFilters?.accountIds && forcedFilters.accountIds.length > 1) {
      setAccountScope("ALL");
    }
  }, [context, forcedFiltersKey, forcedFilters]);

  useEffect(() => {
    if (forcedMailboxMode) {
      setMailboxMode(forcedMailboxMode);
      return;
    }
    setMailboxMode("INBOX");
  }, [context, forcedMailboxMode, view?.id]);

  useEffect(() => {
    return () => {
      listRequestSequenceRef.current += 1;
      detailRequestSequenceRef.current += 1;
      listAbortRef.current?.abort();
      detailAbortRef.current?.abort();
      viewLabelsAbortRef.current?.abort();
      messageViewLabelsAbortRef.current?.abort();
      seenInFlightByMessageIdRef.current.clear();
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

  const loadAccountRecords = useCallback(async (signal?: AbortSignal) => {
    const apiAccounts = await listAccounts(signal);
    setAccountRecords(apiAccounts);
    const mappedAccounts = apiAccounts.map((account) => toMailAccount(account.id, account.email));
    setAccounts((previous) => mergeAccounts(previous, mappedAccounts));
    return apiAccounts;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadAccountRecords(controller.signal).catch(() => {
      // Accounts can still be discovered from mailbox query responses.
    });
    return () => controller.abort();
  }, [loadAccountRecords]);

  useEffect(() => {
    const controller = new AbortController();
    void listSenderRules(controller.signal)
      .then((rules) => {
        const nextLabels = Array.from(
          new Set(rules.map((rule) => rule.label.trim()).filter((label) => label.length > 0))
        ).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
        setSenderRuleLabelOptions(nextLabels);
      })
      .catch(() => {
        // Label filter remains available for view labels even if sender rules are unavailable.
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    setSelectedLabelFilter(ALL_LABEL_FILTER_VALUE);
  }, [context, view?.id]);

  useEffect(() => {
    if (selectedLabelFilter === ALL_LABEL_FILTER_VALUE) {
      return;
    }
    const exists = labelFilterOptions.some((option) => option.value === selectedLabelFilter);
    if (!exists) {
      setSelectedLabelFilter(ALL_LABEL_FILTER_VALUE);
    }
  }, [labelFilterOptions, selectedLabelFilter]);

  useEffect(() => {
    viewLabelsAbortRef.current?.abort();
    if (!isViewContext || !view?.id) {
      setViewLabelOptions([]);
      return;
    }

    const controller = new AbortController();
    viewLabelsAbortRef.current = controller;

    void listViewLabels(view.id, controller.signal)
      .then((labels) => {
        setViewLabelOptions(labels);
      })
      .catch((error) => {
        const message = toErrorMessage(error);
        if (message) {
          showNotice(`Failed to load view labels: ${message}`);
        }
      });

    return () => controller.abort();
  }, [isViewContext, showNotice, view?.id]);

  const applyFetchedDetail = useCallback(
    (detail: MessageDetailResponse) => {
      setSelectedMessageDetail((current) => {
        if (!selectedMessageId || detail.id !== selectedMessageId) {
          return current;
        }
        return detail;
      });
      setAccounts((previous) =>
        mergeAccounts(previous, [toMailAccount(detail.accountId, detail.accountEmail)])
      );
    },
    [selectedMessageId]
  );

  const refreshMessageDetail = useCallback(
    async (messageId: string, showSpinner = false) => {
      detailAbortRef.current?.abort();
      const controller = new AbortController();
      detailAbortRef.current = controller;
      const requestSequence = detailRequestSequenceRef.current + 1;
      detailRequestSequenceRef.current = requestSequence;

      setDetailError(null);
      setIsLoadingDetail(true);
      if (showSpinner) {
        setIsRefreshingMessage(true);
      }

      try {
        const detail = await getMessage(messageId, controller.signal);
        if (requestSequence !== detailRequestSequenceRef.current) {
          return;
        }
        if (selectedMessageId !== messageId) {
          return;
        }
        applyFetchedDetail(detail);
      } catch (error) {
        const message = toErrorMessage(error);
        if (!message) {
          return;
        }
        if (requestSequence !== detailRequestSequenceRef.current) {
          return;
        }
        setDetailError(message);
      } finally {
        if (requestSequence === detailRequestSequenceRef.current) {
          setIsLoadingDetail(false);
          if (showSpinner) {
            setIsRefreshingMessage(false);
          }
        }
      }
    },
    [applyFetchedDetail, selectedMessageId]
  );

  const refreshSelectedMessage = useCallback(
    async (showSpinner = false) => {
      if (!selectedMessageId) {
        return;
      }
      await refreshMessageDetail(selectedMessageId, showSpinner);
    },
    [refreshMessageDetail, selectedMessageId]
  );

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
      const requestSequence = listRequestSequenceRef.current + 1;
      listRequestSequenceRef.current = requestSequence;

      setListError(null);
      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoadingList(true);
      }

      try {
        const forcedAccountIds = forcedFilters?.accountIds ?? [];
        const resolvedAccountIds =
          forcedAccountIds.length > 0
            ? forcedAccountIds
            : accountScope === "ALL"
              ? []
              : [accountScope];
        const resolvedUnreadOnly = forcedFilters?.unreadOnly ?? activeFilters.has("UNREAD");
        const resolvedNeedsReply = forcedFilters?.needsReply ?? activeFilters.has("NEEDS_REPLY");
        const resolvedOverdue = forcedFilters?.overdue ?? activeFilters.has("OVERDUE");
        const resolvedDueToday = forcedFilters?.dueToday ?? activeFilters.has("DUE_TODAY");
        const resolvedSnoozed = forcedFilters?.snoozed ?? activeFilters.has("SNOOZED");
        const resolvedAllOpen = forcedFilters?.allOpen ?? false;
        const resolvedSenderDomains = forcedFilters?.senderDomains ?? [];
        const resolvedSenderEmails = forcedFilters?.senderEmails ?? [];
        const resolvedLabelNames = selectedLabelNames;

        const response =
          context === "view" && view
            ? await queryMailboxView(
                {
                  viewId: view.id,
                  q: debouncedSearchQuery.length > 0 ? debouncedSearchQuery : null,
                  filtersOverride: {
                    unreadOnly: resolvedUnreadOnly,
                    needsReply: resolvedNeedsReply,
                    overdue: resolvedOverdue,
                    dueToday: resolvedDueToday,
                    snoozed: resolvedSnoozed,
                    allOpen: resolvedAllOpen,
                    labelNames: resolvedLabelNames,
                  },
                  sort: sortOrder,
                  mode: mailboxMode,
                  pageSize: REQUEST_PAGE_SIZE,
                  cursor,
                },
                controller.signal
              )
            : await queryMailbox(
                {
                  scope: resolvedAccountIds.length > 0 ? { accountIds: resolvedAccountIds } : {},
                  q: debouncedSearchQuery.length > 0 ? debouncedSearchQuery : null,
                  filters: {
                    unreadOnly: resolvedUnreadOnly,
                    needsReply: resolvedNeedsReply,
                    overdue: resolvedOverdue,
                    dueToday: resolvedDueToday,
                    snoozed: resolvedSnoozed,
                    allOpen: resolvedAllOpen,
                    senderDomains: resolvedSenderDomains,
                    senderEmails: resolvedSenderEmails,
                    keywords: [],
                    labelNames: resolvedLabelNames,
                  },
                  sort: sortOrder,
                  mode: mailboxMode,
                  pageSize: REQUEST_PAGE_SIZE,
                  cursor,
                },
                controller.signal
              );

        if (requestSequence !== listRequestSequenceRef.current) {
          return;
        }

        const incomingMessages = response.items.map((item) => toSummaryMessage(item));
        const incomingAccounts = response.items.map((item) =>
          toMailAccount(item.accountId, item.accountEmail)
        );

        setAccounts((previous) => mergeAccounts(previous, incomingAccounts));
        setMessages((previous) =>
          append ? mergeMessages(previous, incomingMessages) : incomingMessages
        );
        setNextCursor(response.nextCursor);
      } catch (error) {
        const message = toErrorMessage(error);
        if (!message) {
          return;
        }
        if (requestSequence !== listRequestSequenceRef.current) {
          return;
        }
        setListError(message);
        if (!append) {
          setMessages([]);
          setNextCursor(null);
        }
      } finally {
        const isLatestRequest = requestSequence === listRequestSequenceRef.current;
        if (isLatestRequest) {
          if (append) {
            setIsLoadingMore(false);
          } else {
            setIsLoadingList(false);
            setIsRefreshingMailbox(false);
          }
        }
      }
    },
    [
      context,
      view,
      activeFilters,
      accountScope,
      forcedFiltersKey,
      mailboxMode,
      sortOrder,
      selectedLabelNames,
      debouncedSearchQuery,
    ]
  );

  const refreshMailbox = useCallback(
    (refreshDetail: boolean) => {
      setIsRefreshingMailbox(true);
      setRefreshNonce((previous) => previous + 1);
      if (refreshDetail) {
        void refreshSelectedMessage(true);
      }
    },
    [refreshSelectedMessage]
  );

  const handleRefreshMailbox = useCallback(() => {
    refreshMailbox(true);
  }, [refreshMailbox]);

  const handleRefreshMessage = useCallback(() => {
    void refreshSelectedMessage(true);
  }, [refreshSelectedMessage]);

  useEffect(() => {
    const queryChanged = previousMailboxQueryKeyRef.current !== mailboxQueryKey;
    previousMailboxQueryKeyRef.current = mailboxQueryKey;

    if (queryChanged) {
      setSelectedMessageId(null);
      setSelectedMessageDetail(null);
      setSelectedViewLabels([]);
      setBodyViewMode("collapsed");
      setDetailError(null);
    }

    void fetchMailbox(false, null);
  }, [fetchMailbox, mailboxQueryKey, refreshNonce]);

  useEffect(() => {
    const mailboxKey =
      context === "inbox" ? "INBOX" : context === "view" && view?.id ? `VIEW:${view.id}` : null;
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
    const previousStates = previousSyncStatesRef.current;
    const nextStates: Record<string, "RUNNING" | "IDLE" | "ERROR"> = {};
    let shouldRefresh = false;

    for (const status of Object.values(syncByAccountId)) {
      nextStates[status.accountId] = status.state;
      const previousState = previousStates[status.accountId];
      if (previousState === "RUNNING" && status.state === "IDLE") {
        shouldRefresh = true;
      }
    }

    previousSyncStatesRef.current = nextStates;
    if (shouldRefresh) {
      refreshMailbox(false);
    }
  }, [refreshMailbox, syncByAccountId]);

  useEffect(() => {
    if (messages.length === 0) {
      setSelectedMessageId(null);
      setSelectedMessageDetail(null);
      setSelectedViewLabels([]);
      setBodyViewMode("collapsed");
      return;
    }

    const selectedStillVisible = messages.some((message) => message.id === selectedMessageId);
    if (!selectedStillVisible) {
      setSelectedMessageId(messages[0].id);
      setBodyViewMode("collapsed");
    }
  }, [messages, selectedMessageId]);

  useEffect(() => {
    if (!selectedMessageId) {
      detailAbortRef.current?.abort();
      messageViewLabelsAbortRef.current?.abort();
      detailRequestSequenceRef.current += 1;
      setSelectedMessageDetail(null);
      setSelectedViewLabels([]);
      setBodyViewMode("collapsed");
      setDetailError(null);
      setIsLoadingDetail(false);
      setIsLoadingViewLabels(false);
      setIsRefreshingMessage(false);
      return;
    }
    setSelectedMessageDetail(null);
    void refreshSelectedMessage(false);
  }, [refreshSelectedMessage, selectedMessageId]);

  const selectedSummary = useMemo(
    () => messages.find((message) => message.id === selectedMessageId) ?? null,
    [messages, selectedMessageId]
  );

  useEffect(() => {
    if (!isViewContext || !selectedSummary) {
      setSelectedViewLabels([]);
      return;
    }
    setSelectedViewLabels(selectedSummary.viewLabels);
  }, [isViewContext, selectedSummary]);

  useEffect(() => {
    messageViewLabelsAbortRef.current?.abort();
    if (!isViewContext || !view?.id || !selectedMessageId) {
      setIsLoadingViewLabels(false);
      return;
    }

    const controller = new AbortController();
    messageViewLabelsAbortRef.current = controller;
    setIsLoadingViewLabels(true);

    void listMessageViewLabels(view.id, selectedMessageId, controller.signal)
      .then((labels) => {
        if (controller.signal.aborted) {
          return;
        }
        const nextLabels = toLabelChips(labels);
        setSelectedViewLabels(nextLabels);
        setMessages((previous) =>
          previous.map((message) =>
            message.id === selectedMessageId
              ? {
                  ...message,
                  viewLabels: nextLabels,
                }
              : message
          )
        );
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }
        const message = toErrorMessage(error);
        if (message) {
          showNotice(`Failed to load assigned labels: ${message}`);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoadingViewLabels(false);
        }
      });

    return () => controller.abort();
  }, [isViewContext, selectedMessageId, showNotice, view?.id]);

  const selectedMessage = useMemo(() => {
    if (!selectedSummary) {
      return null;
    }
    if (selectedMessageDetail && selectedMessageDetail.id === selectedSummary.id) {
      return buildPreviewMessage(selectedSummary, selectedMessageDetail, accountLookup);
    }
    return buildPreviewMessage(selectedSummary, undefined, accountLookup);
  }, [accountLookup, selectedMessageDetail, selectedSummary]);

  const applySeenInAppState = useCallback((messageId: string, seenInApp: boolean) => {
    setMessages((previous) =>
      previous.map((message) =>
        message.id === messageId
          ? {
              ...message,
              seenInApp,
            }
          : message
      )
    );

    setSelectedMessageDetail((previous) => {
      if (!previous || previous.id !== messageId) {
        return previous;
      }
      return {
        ...previous,
        seenInApp,
      };
    });
  }, []);

  useEffect(() => {
    if (!selectedSummary || selectedSummary.seenInApp) {
      return;
    }

    const messageId = selectedSummary.id;
    if (seenInFlightByMessageIdRef.current.has(messageId)) {
      return;
    }

    applySeenInAppState(messageId, true);
    seenInFlightByMessageIdRef.current.add(messageId);

    void markSeenInApp(messageId)
      .catch(() => {
        // Keep optimistic UI; next query/detail refresh will reconcile if needed.
      })
      .finally(() => {
        seenInFlightByMessageIdRef.current.delete(messageId);
      });
  }, [applySeenInAppState, selectedSummary]);

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
                  : threadMessage
              ),
            }
          : message
      )
    );

    setSelectedMessageDetail((previous) => {
      if (!previous || previous.id !== messageId) {
        return previous;
      }
      return {
        ...previous,
        isUnread,
        thread: {
          messages: previous.thread.messages.map((threadMessage) =>
            threadMessage.id === messageId
              ? {
                  ...threadMessage,
                  isUnread,
                }
              : threadMessage
          ),
        },
      };
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
          : message
      )
    );

    setSelectedMessageDetail((previous) => {
      if (!previous || previous.id !== messageId) {
        return previous;
      }
      return {
        ...previous,
        followup: {
          status: followup.status,
          needsReply: followup.needsReply,
          dueAt: followup.dueAt,
          snoozedUntil: followup.snoozedUntil,
        },
      };
    });
  }, []);

  const getCurrentFollowup = useCallback(
    (messageId: string): MessageFollowup => {
      const message = messages.find((candidate) => candidate.id === messageId);
      return message?.followup ?? defaultFollowupState();
    },
    [messages]
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
        await refreshMessageDetail(messageId);
        emitFollowupUpdated();
        showNotice(successMessage);
      } catch (error) {
        applyFollowupState(messageId, previousFollowup);
        showNotice(toErrorMessage(error) || "Failed to update followup");
      } finally {
        setIsUpdatingFollowup(false);
      }
    },
    [applyFollowupState, getCurrentFollowup, refreshMessageDetail, showNotice]
  );

  const applyFollowupAction = useCallback(
    async (messageId: string, action: "MARK_DONE" | "MARK_OPEN" | "SNOOZE", days?: 1 | 3 | 7) => {
      setIsUpdatingFollowup(true);
      try {
        const response = await runFollowupAction(messageId, days ? { action, days } : { action });
        applyFollowupState(messageId, toMessageFollowup(response.followup));
        await refreshMessageDetail(messageId);
        emitFollowupUpdated();
        showNotice("Followup updated");
      } catch (error) {
        showNotice(toErrorMessage(error) || "Failed to update followup");
      } finally {
        setIsUpdatingFollowup(false);
      }
    },
    [applyFollowupState, refreshMessageDetail, showNotice]
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
      await refreshSelectedMessage();
    } catch (error) {
      applyUnreadState(selectedMessage.id, selectedMessage.isUnread);
      showNotice(toErrorMessage(error) || "Failed to update read state");
    }
  }, [applyUnreadState, refreshSelectedMessage, selectedMessage, showNotice]);

  const ensureBodyIsLoaded = useCallback(
    async (messageId: string, hasCachedBody: boolean): Promise<boolean> => {
      if (hasCachedBody) {
        return true;
      }

      setBodyLoadingMessageId(messageId);
      try {
        await loadMessageBody(messageId);
        await refreshMessageDetail(messageId, true);
        showNotice("Full body loaded");
        return true;
      } catch (error) {
        showNotice(toErrorMessage(error) || "Failed to load full body");
        return false;
      } finally {
        setBodyLoadingMessageId((current) => (current === messageId ? null : current));
      }
    },
    [refreshMessageDetail, showNotice]
  );

  const handleLoadFullBody = useCallback(async () => {
    if (!selectedMessage) {
      return;
    }

    const loaded = await ensureBodyIsLoaded(selectedMessage.id, selectedMessage.bodyCache !== null);
    if (loaded) {
      setBodyViewMode("inline");
    }
  }, [ensureBodyIsLoaded, selectedMessage]);

  const handleViewFullBody = useCallback(async () => {
    if (!selectedMessage) {
      return;
    }

    const loaded = await ensureBodyIsLoaded(selectedMessage.id, selectedMessage.bodyCache !== null);
    if (loaded) {
      setBodyViewMode("modal");
    }
  }, [ensureBodyIsLoaded, selectedMessage]);

  const handleCollapseBody = useCallback(() => {
    setBodyViewMode("collapsed");
  }, []);

  const handleOpenInGmail = useCallback(async () => {
    if (!selectedMessage?.openInGmailUrl) {
      showNotice("Open in Gmail is unavailable for this message.");
      return;
    }

    try {
      await openUrl(selectedMessage.openInGmailUrl);
    } catch (error) {
      showNotice(toErrorMessage(error) || "Failed to open Gmail");
    }
  }, [selectedMessage, showNotice]);

  const handleSaveViewLabels = useCallback(
    async (nextLabelIds: string[]) => {
      if (!isViewContext || !view?.id || !selectedMessageId) {
        return;
      }

      const labelById = new Map(viewLabelOptions.map((label) => [label.id, label]));
      const normalizedIds = Array.from(
        new Set(nextLabelIds.filter((labelId) => labelById.has(labelId)))
      );
      const nextLabels = normalizedIds
        .map((labelId) => labelById.get(labelId))
        .filter((label): label is ViewLabelRecord => Boolean(label));
      const nextChips = toLabelChips(nextLabels);

      setIsSavingViewLabels(true);
      try {
        await replaceMessageViewLabels(view.id, selectedMessageId, normalizedIds);
        setSelectedViewLabels(nextChips);
        setMessages((previous) =>
          previous.map((message) =>
            message.id === selectedMessageId
              ? {
                  ...message,
                  viewLabels: nextChips,
                }
              : message
          )
        );
        showNotice("View labels updated");
      } catch (error) {
        showNotice(toErrorMessage(error) || "Failed to save view labels");
      } finally {
        setIsSavingViewLabels(false);
      }
    },
    [isViewContext, selectedMessageId, showNotice, view?.id, viewLabelOptions]
  );

  const handleDownloadAttachment = useCallback(
    async (attachmentId: string, attachmentFilename: string) => {
      setActiveAttachmentDownloadId(attachmentId);
      try {
        const response = await downloadAttachmentFile(attachmentId);
        const defaultFileName = sanitizeFilename(
          response.fileName ?? attachmentFilename,
          `attachment-${attachmentId}.bin`
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
    [showNotice]
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
        `mailpilot-message-${selectedMessage.id}`
      );
      const savedPath = await saveBinaryWithDialog({
        defaultFileName,
        bytes: response.bytes,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (savedPath) {
        showNotice(`Saved PDF: ${leafFilename(savedPath)}`);
      }
    } catch (error) {
      const message = toErrorMessage(error);
      showNotice(message ? `Export failed: ${message}` : "Export failed.");
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
        `mailpilot-thread-${selectedMessage.threadId}`
      );
      const savedPath = await saveBinaryWithDialog({
        defaultFileName,
        bytes: response.bytes,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (savedPath) {
        showNotice(`Saved PDF: ${leafFilename(savedPath)}`);
      }
    } catch (error) {
      const message = toErrorMessage(error);
      showNotice(message ? `Export failed: ${message}` : "Export failed.");
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
      nextFollowup.needsReply ? "Marked as needs reply" : "Cleared needs reply"
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
        `Due date set for ${preset === "TODAY" ? "today" : "tomorrow"}`
      );
    },
    [persistFollowup, selectedMessage]
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
      "Due date cleared"
    );
  }, [persistFollowup, selectedMessage]);

  const handleSnoozeDays = useCallback(
    async (days: 1 | 3 | 7) => {
      if (!selectedMessage) {
        return;
      }
      await applyFollowupAction(selectedMessage.id, "SNOOZE", days);
    },
    [applyFollowupAction, selectedMessage]
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
      "Snooze cleared"
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
      setBodyViewMode("collapsed");
    },
    [messages, showNotice]
  );

  const handleSelectMessage = useCallback((messageId: string) => {
    setSelectedMessageId(messageId);
    setBodyViewMode("collapsed");
  }, []);

  const handleFocusPreview = useCallback(() => {
    previewRef.current?.focus();
  }, []);

  const openComposeNew = useCallback(() => {
    const accountId = resolvePreferredAccountId(accountRecords, accounts);
    setComposeDraft({
      mode: "NEW",
      accountId,
      to: "",
      cc: "",
      bcc: "",
      subject: "",
      bodyText: "",
      replyToMessageDbId: null,
    });
    setComposeOpen(true);
  }, [accountRecords, accounts]);

  const openComposeFromPreview = useCallback(
    (action: "reply" | "reply-all" | "forward") => {
      if (!selectedMessage) {
        return;
      }

      const accountId = resolvePreferredAccountId(
        accountRecords,
        accounts,
        selectedMessage.accountId
      );
      const quotedBody = buildQuotedSnippet(selectedMessage);

      if (action === "reply") {
        setComposeDraft({
          mode: "REPLY",
          accountId,
          to: selectedMessage.senderEmail,
          cc: "",
          bcc: "",
          subject: withSubjectPrefix("Re", selectedMessage.subject),
          bodyText: quotedBody,
          replyToMessageDbId: selectedMessage.id,
        });
      } else if (action === "reply-all") {
        setComposeDraft({
          mode: "REPLY_ALL",
          accountId,
          to: selectedMessage.senderEmail,
          cc: "",
          bcc: "",
          subject: withSubjectPrefix("Re", selectedMessage.subject),
          bodyText: quotedBody,
          replyToMessageDbId: selectedMessage.id,
        });
      } else {
        setComposeDraft({
          mode: "FORWARD",
          accountId,
          to: "",
          cc: "",
          bcc: "",
          subject: withSubjectPrefix("Fwd", selectedMessage.subject),
          bodyText: quotedBody,
          replyToMessageDbId: selectedMessage.id,
        });
      }

      setComposeOpen(true);
    },
    [accountRecords, accounts, selectedMessage]
  );

  const handleComposeSendSuccess = useCallback(() => {
    showNotice("Sent");
    refreshMailbox(true);
  }, [refreshMailbox, showNotice]);

  const handleRequestSendReauth = useCallback(
    async (accountId: string) => {
      try {
        const config = await configCheck();
        if (!config.configured) {
          showNotice(config.message || "Google OAuth configuration is missing.");
          return false;
        }

        const startResponse = await startGmailOAuth({
          mode: "SEND",
          returnTo: "mailpilot://oauth-done",
        });

        try {
          await openUrl(startResponse.authUrl);
        } catch {
          const popup = window.open(startResponse.authUrl, "_blank", "noopener,noreferrer");
          if (!popup) {
            throw new ApiClientError("Unable to open the system browser for Google OAuth.");
          }
        }

        const pollStartedAt = Date.now();
        while (Date.now() - pollStartedAt <= OAUTH_POLL_TIMEOUT_MS) {
          await sleep(OAUTH_POLL_INTERVAL_MS);

          const [accountsResult, statusResult] = await Promise.allSettled([
            loadAccountRecords(),
            getGmailOAuthStatus(startResponse.state),
          ]);

          if (accountsResult.status === "fulfilled") {
            const refreshed = accountsResult.value;
            const target = refreshed.find((account) => account.id === accountId);
            if (target?.canSend) {
              showNotice("Sending scope granted.");
              return true;
            }
          }

          if (statusResult.status === "fulfilled" && statusResult.value.status === "ERROR") {
            showNotice(statusResult.value.message);
            return false;
          }
        }

        showNotice("Re-auth timed out. Retry and complete consent in the browser tab.");
        return false;
      } catch (error) {
        showNotice(toErrorMessage(error) || "Failed to start Gmail re-auth.");
        return false;
      }
    },
    [loadAccountRecords, showNotice]
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
    if (forcedFilters?.unreadOnly) {
      next.add("UNREAD");
    }
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
    setSelectedLabelFilter(ALL_LABEL_FILTER_VALUE);
    if (context !== "view" && !hideScope) {
      if (forcedFilters?.accountIds && forcedFilters.accountIds.length === 1) {
        setAccountScope(forcedFilters.accountIds[0]);
      } else {
        setAccountScope("ALL");
      }
    }
  }, [context, forcedFilters, hideScope]);

  const heading =
    titleOverride ??
    (context === "view"
      ? `View: ${view?.name ?? "Missing"}`
      : context === "sent"
        ? "Sent"
        : "Inbox");
  const subtitle =
    subtitleOverride ??
    (context === "view"
      ? describeView(view)
      : context === "sent"
        ? "Unified sent mail across connected accounts."
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
        mailboxMode={mailboxMode}
        onMailboxModeChange={setMailboxMode}
        mailboxModeLocked={forcedMailboxMode !== undefined}
        sortOrder={sortOrder}
        onSortOrderChange={setSortOrder}
        labelFilterValue={selectedLabelFilter}
        labelFilterOptions={labelFilterOptions}
        onLabelFilterChange={setSelectedLabelFilter}
        isSearchLoading={isSearchLoading}
        onSettingsShortcut={() => navigate("/settings")}
        onToggleFilter={toggleQuickFilter}
        onCompose={openComposeNew}
        onRefresh={handleRefreshMailbox}
        isRefreshing={isRefreshingMailbox || isLoadingList}
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
              onFocusPreview={handleFocusPreview}
              onSelectMessage={handleSelectMessage}
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
          isViewContext={isViewContext}
          availableViewLabels={viewLabelOptions}
          selectedViewLabels={selectedViewLabels}
          selectedViewLabelIds={selectedViewLabelIds}
          onSaveViewLabels={(labelIds) => {
            void handleSaveViewLabels(labelIds);
          }}
          isLoadingViewLabels={isLoadingViewLabels}
          isSavingViewLabels={isSavingViewLabels}
          bodyViewMode={bodyViewMode}
          onCollapseBody={handleCollapseBody}
          isLoading={isLoadingDetail}
          onRefreshMessage={handleRefreshMessage}
          isRefreshingMessage={isRefreshingMessage}
          onComposeAction={openComposeFromPreview}
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
          onLoadFullBody={() => {
            void handleLoadFullBody();
          }}
          onViewFullBody={() => {
            void handleViewFullBody();
          }}
          isLoadingBody={selectedMessage ? bodyLoadingMessageId === selectedMessage.id : false}
          onOpenInGmail={() => {
            void handleOpenInGmail();
          }}
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

      <ComposeDialog
        open={composeOpen}
        accounts={accountRecords}
        initialDraft={composeDraft}
        onOpenChange={setComposeOpen}
        onSendSuccess={handleComposeSendSuccess}
        onRequestReauth={handleRequestSendReauth}
      />

      {notice && (
        <div className="mailbox-toast fixed bottom-5 right-5 z-[60] rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-lg">
          {notice.message}
        </div>
      )}
    </section>
  );
}
