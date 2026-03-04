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
  receivedAt: string;
  isUnread: boolean;
  flags: MailFlags;
  tags: string[];
  hasAttachments: boolean;
  attachments: MailAttachment[];
  threadId: string;
  threadMessages: ThreadMessageSummary[];
};

export type MailboxDataset = {
  accounts: MailAccount[];
  messages: MailMessage[];
};

export type AccountScope = "ALL" | string;

export type QuickFilterKey =
  | "UNREAD"
  | "NEEDS_REPLY"
  | "OVERDUE"
  | "DUE_TODAY"
  | "SNOOZED";
