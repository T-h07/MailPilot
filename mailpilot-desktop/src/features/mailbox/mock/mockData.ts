import type {
  AccountColorToken,
  MailAccount,
  MailAttachment,
  MailMessage,
  MailboxDataset,
  ThreadMessageSummary,
} from "@/features/mailbox/model/types";

const senderFirstNames = [
  "Ava",
  "Noah",
  "Maya",
  "Ethan",
  "Lena",
  "Arjun",
  "Zoe",
  "Mateo",
  "Nora",
  "Leo",
  "Iris",
  "Kai",
];

const senderLastNames = [
  "Patel",
  "Miller",
  "Sanchez",
  "Kim",
  "Fischer",
  "Brown",
  "Chen",
  "Carter",
  "Ahmed",
  "Ivanov",
  "Silva",
  "Singh",
];

const domainPool = [
  "company.com",
  "partnersuite.com",
  "vendorhq.com",
  "linkedin.com",
  "lnkd.in",
  "steampowered.com",
  "epicgames.com",
  "discord.com",
  "riotgames.com",
  "mailchimp.com",
  "hubspot.com",
  "marketo.com",
  "campaignhq.com",
  "github.com",
  "notion.so",
  "calendar.app",
];

const subjectParts = [
  "Weekly status update",
  "Invoice review request",
  "Quick sync for roadmap",
  "Campaign performance recap",
  "Connection follow-up",
  "Patch notes discussion",
  "Hiring pipeline update",
  "Launch checklist approval",
  "Meeting notes and next steps",
  "Proposal feedback needed",
  "SLA alert for customer queue",
  "Q4 planning prep",
];

const snippetParts = [
  "Can you take a look and confirm by EOD?",
  "Sharing context before we lock this in.",
  "Need a final call on scope and ownership.",
  "Dropping this here for quick visibility.",
  "This thread has a few action items to triage.",
  "Please confirm if we should proceed with the current plan.",
  "There are open points around timeline and budget.",
  "I added a short summary to keep this moving.",
];

const bodyParagraphs = [
  "This is mock content for the MailPilot preview pane. The final integration will render body cache from synced messages.",
  "Use this shell to validate list performance, message triage ergonomics, and command bar interactions before backend wiring.",
  "If this is marked as needing reply, it represents a thread requiring acknowledgement or a concrete next action.",
  "Thread summaries are synthetic in this phase but mimic the flow of switching between related messages in a conversation.",
];

const fileNames = [
  "timeline.pdf",
  "requirements.docx",
  "campaign-results.csv",
  "budget-review.xlsx",
  "design-brief.pdf",
  "notes.txt",
  "deployment-checklist.md",
];

const mimeTypes = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/markdown",
];

const tagsPool = [
  "finance",
  "product",
  "legal",
  "urgent",
  "ops",
  "social",
  "community",
  "growth",
  "hiring",
];

const mockAccounts: MailAccount[] = [
  {
    id: "acc-01",
    accountEmail: "alex@company.com",
    accountLabel: "Alex · Work",
    colorToken: "sky",
  },
  {
    id: "acc-02",
    accountEmail: "alex+marketing@company.com",
    accountLabel: "Alex · Marketing",
    colorToken: "violet",
  },
  {
    id: "acc-03",
    accountEmail: "alex.network@gmail.com",
    accountLabel: "Alex · Network",
    colorToken: "emerald",
  },
  {
    id: "acc-04",
    accountEmail: "alex.play@outlook.com",
    accountLabel: "Alex · Gaming",
    colorToken: "amber",
  },
];

type ThreadSeed = {
  id: string;
  accountId: string;
  senderName: string;
  senderEmail: string;
  senderDomain: string;
  topic: string;
};

function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function pickOne<T>(items: T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length)];
}

function buildUuid(rng: () => number): string {
  const bytes = Array.from({ length: 16 }, () => Math.floor(rng() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function createSender(rng: () => number, domain?: string): {
  senderName: string;
  senderEmail: string;
  senderDomain: string;
} {
  const first = pickOne(senderFirstNames, rng);
  const last = pickOne(senderLastNames, rng);
  const senderDomain = domain ?? pickOne(domainPool, rng);
  const senderEmail = `${first}.${last}`.toLowerCase().replace(/\s+/g, "") + `@${senderDomain}`;
  return {
    senderName: `${first} ${last}`,
    senderEmail,
    senderDomain,
  };
}

function createAttachments(rng: () => number, messageId: string): MailAttachment[] {
  const attachmentCount = 1 + Math.floor(rng() * 3);
  return Array.from({ length: attachmentCount }, (_, index) => ({
    id: `${messageId}-att-${index + 1}`,
    filename: pickOne(fileNames, rng),
    mimeType: pickOne(mimeTypes, rng),
    sizeBytes: 50_000 + Math.floor(rng() * 4_500_000),
  }));
}

function createThreadSummary(message: MailMessage): ThreadMessageSummary {
  return {
    id: message.id,
    senderName: message.senderName,
    senderEmail: message.senderEmail,
    subject: message.subject,
    snippet: message.snippet,
    receivedAt: message.receivedAt,
    isUnread: message.isUnread,
    hasAttachments: message.hasAttachments,
  };
}

export function generateMockMailboxData(
  messageCount = 2000,
  seed = 9405,
): MailboxDataset {
  const rng = createSeededRng(seed);
  const now = Date.now();
  const messages: MailMessage[] = [];
  const threadSeedsByAccount = new Map<string, ThreadSeed[]>();

  for (const account of mockAccounts) {
    threadSeedsByAccount.set(account.id, []);
  }

  for (let index = 0; index < messageCount; index += 1) {
    const account = pickOne(mockAccounts, rng);
    const accountThreads = threadSeedsByAccount.get(account.id) ?? [];
    const attachToExisting = accountThreads.length > 0 && rng() < 0.36;

    let threadSeed: ThreadSeed;
    if (attachToExisting) {
      threadSeed = pickOne(accountThreads, rng);
    } else {
      const sender = createSender(rng);
      threadSeed = {
        id: buildUuid(rng),
        accountId: account.id,
        senderName: sender.senderName,
        senderEmail: sender.senderEmail,
        senderDomain: sender.senderDomain,
        topic: pickOne(subjectParts, rng),
      };
      accountThreads.push(threadSeed);
    }

    const id = buildUuid(rng);
    const isUnread = rng() < 0.2;
    const needsReply = rng() < 0.14;
    const overdue = needsReply && rng() < 0.35;
    const dueToday = needsReply && !overdue && rng() < 0.3;
    const snoozed = !overdue && rng() < 0.08;
    const hasAttachments = rng() < 0.22;
    const subject = `${threadSeed.topic}${rng() < 0.2 ? " · follow-up" : ""}`;
    const snippet = pickOne(snippetParts, rng);
    const daysBack = Math.floor(rng() * 45);
    const minuteOffset = Math.floor(rng() * 1440);
    const receivedAt = new Date(
      now - daysBack * 24 * 60 * 60 * 1000 - minuteOffset * 60 * 1000,
    ).toISOString();

    const tagCount = rng() < 0.45 ? 1 + Math.floor(rng() * 3) : 0;
    const tags = Array.from(
      new Set(Array.from({ length: tagCount }, () => pickOne(tagsPool, rng))),
    );
    const attachments = hasAttachments ? createAttachments(rng, id) : [];
    const bodyCache =
      rng() < 0.66
        ? [pickOne(bodyParagraphs, rng), pickOne(bodyParagraphs, rng)].join("\n\n")
        : null;

    messages.push({
      id,
      accountId: account.id,
      accountEmail: account.accountEmail,
      accountLabel: account.accountLabel,
      accountColorToken: account.colorToken as AccountColorToken,
      senderName: threadSeed.senderName,
      senderEmail: threadSeed.senderEmail,
      senderDomain: threadSeed.senderDomain,
      subject,
      snippet,
      bodyCache,
      receivedAt,
      isUnread,
      flags: {
        needsReply,
        overdue,
        dueToday,
        snoozed,
      },
      tags,
      hasAttachments,
      attachments,
      threadId: threadSeed.id,
      threadMessages: [],
    });
  }

  messages.sort(
    (a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
  );

  const threadMap = new Map<string, ThreadMessageSummary[]>();
  for (const message of messages) {
    const summaries = threadMap.get(message.threadId) ?? [];
    summaries.push(createThreadSummary(message));
    threadMap.set(message.threadId, summaries);
  }

  for (const message of messages) {
    message.threadMessages = (threadMap.get(message.threadId) ?? []).slice(0, 8);
  }

  return {
    accounts: mockAccounts,
    messages,
  };
}
