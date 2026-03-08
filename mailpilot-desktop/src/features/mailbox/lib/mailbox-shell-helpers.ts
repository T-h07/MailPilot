import type { AccountRecord } from "@/lib/api/accounts";
import type { FollowupState } from "@/lib/api/followups";
import type { MailboxListItem, MessageDetailResponse } from "@/lib/api/mailbox";
import type { ViewLabelRecord, ViewRecord } from "@/lib/api/views";
import type {
  AccountColorToken,
  MailAccount,
  MessageFollowup,
  MailMessage,
  ThreadMessageSummary,
  ViewLabelChip as MailViewLabelChip,
} from "@/features/mailbox/model/types";

const ACCOUNT_COLOR_TOKENS: AccountColorToken[] = ["sky", "emerald", "violet", "amber"];

export function nameFromEmail(email: string): string {
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

export function toMailAccount(accountId: string, accountEmail: string): MailAccount {
  return {
    id: accountId,
    accountEmail,
    accountLabel: accountEmail,
    colorToken: accountColorFromId(accountId),
  };
}

export function chipsToFlags(chips: string[]) {
  const chipSet = new Set(chips);
  return {
    needsReply: chipSet.has("NeedsReply"),
    overdue: chipSet.has("Overdue"),
    dueToday: chipSet.has("DueToday"),
    snoozed: chipSet.has("Snoozed"),
  };
}

export function followupToFlags(followup: MessageDetailResponse["followup"]) {
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

export function defaultFollowupState(): MessageFollowup {
  return {
    status: "OPEN",
    needsReply: false,
    dueAt: null,
    snoozedUntil: null,
  };
}

export function toMessageFollowup(
  followup: MessageDetailResponse["followup"] | FollowupState
): MessageFollowup {
  return {
    status: followup.status,
    needsReply: followup.needsReply,
    dueAt: followup.dueAt,
    snoozedUntil: followup.snoozedUntil,
  };
}

export function toSummaryMessage(item: MailboxListItem): MailMessage {
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

export function mergeMessages(existing: MailMessage[], incoming: MailMessage[]): MailMessage[] {
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

export function mergeAccounts(existing: MailAccount[], incoming: MailAccount[]): MailAccount[] {
  const nextById = new Map(existing.map((account) => [account.id, account]));
  for (const account of incoming) {
    nextById.set(account.id, account);
  }
  return Array.from(nextById.values()).sort((left, right) =>
    left.accountEmail.localeCompare(right.accountEmail)
  );
}

export function toThreadSummary(
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

export function buildPreviewMessage(
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
    seenInApp: detail.seenInApp || summary.seenInApp,
    bodyCache: detail.body.content,
    bodyMime: detail.body.mime,
    openInGmailUrl: detail.openInGmailUrl,
    hasAttachments: detail.attachments.length > 0 || summary.hasAttachments,
    attachments: detail.attachments.map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      isInline: attachment.isInline,
      downloadable: attachment.downloadable,
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

export function describeView(view: ViewRecord | null): string {
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

export function summarizeViewRules(view: ViewRecord | null): string[] {
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

export function toLabelChips(records: ViewLabelRecord[]): MailViewLabelChip[] {
  return records.map((record) => ({
    id: record.id,
    name: record.name,
    colorToken: record.colorToken,
  }));
}

export function sanitizeFilename(value: string | null | undefined, fallback: string): string {
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

export function ensurePdfFilename(value: string | null | undefined, fallback: string): string {
  const base = sanitizeFilename(value, fallback);
  return base.toLowerCase().endsWith(".pdf") ? base : `${base}.pdf`;
}

export function leafFilename(pathValue: string): string {
  const normalized = pathValue.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts.length > 0 ? parts[parts.length - 1] : pathValue;
}

export function withSubjectPrefix(prefix: "Re" | "Fwd", subject: string): string {
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

export function buildQuotedSnippet(message: MailMessage): string {
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

export function resolvePreferredAccountId(
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
