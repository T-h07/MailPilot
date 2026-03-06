export type AccountColorToken = "sky" | "emerald" | "violet" | "amber";

export type MailAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
};

export type ThreadMessageSummary = {
  id: string;
  senderName: string;
  senderEmail: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  isUnread: boolean;
  hasAttachments: boolean;
};

export type MailFlags = {
  needsReply: boolean;
  overdue: boolean;
  dueToday: boolean;
  snoozed: boolean;
};

export type ViewLabelChip = {
  id: string;
  name: string;
  colorToken: string;
};

export type MessageFollowup = {
  status: "OPEN" | "DONE";
  needsReply: boolean;
  dueAt: string | null;
  snoozedUntil: string | null;
};

export type MailAccount = {
  id: string;
  accountEmail: string;
  accountLabel: string;
  colorToken: AccountColorToken;
};

export type MailMessage = {
  id: string;
  accountId: string;
  accountEmail: string;
  accountLabel: string;
  accountColorToken: AccountColorToken;
  senderName: string;
  senderEmail: string;
  senderDomain: string;
  subject: string;
  snippet: string;
  bodyCache: string | null;
  bodyMime: string | null;
  openInGmailUrl: string | null;
  receivedAt: string;
  isUnread: boolean;
  seenInApp: boolean;
  flags: MailFlags;
  tags: string[];
  viewLabels: ViewLabelChip[];
  hasAttachments: boolean;
  attachments: MailAttachment[];
  threadId: string | null;
  threadMessages: ThreadMessageSummary[];
  followup: MessageFollowup;
  highlight?: {
    label: string;
    accent: string;
  } | null;
};

export type MailboxDataset = {
  accounts: MailAccount[];
  messages: MailMessage[];
};

export type AccountScope = "ALL" | string;

export type QuickFilterKey = "UNREAD" | "NEEDS_REPLY" | "OVERDUE" | "DUE_TODAY" | "SNOOZED";
