import type { MailMessage } from "@/features/mailbox/model/types";

export type MailboxViewKey = "work" | "linkedin" | "gaming" | "marketing";

export type MockViewRule = {
  key: MailboxViewKey;
  label: string;
  summary: string;
  domains: string[];
  keywords: string[];
};

const viewRules: Record<MailboxViewKey, MockViewRule> = {
  work: {
    key: "work",
    label: "Work",
    summary: "Company and execution-heavy threads.",
    domains: ["company.com", "partnersuite.com", "vendorhq.com"],
    keywords: ["invoice", "meeting", "proposal", "roadmap", "status update"],
  },
  linkedin: {
    key: "linkedin",
    label: "LinkedIn",
    summary: "Career and network conversations.",
    domains: ["linkedin.com", "lnkd.in"],
    keywords: ["profile", "connection", "recruiter", "opportunity"],
  },
  gaming: {
    key: "gaming",
    label: "Gaming",
    summary: "Community and platform updates.",
    domains: ["steampowered.com", "epicgames.com", "discord.com", "riotgames.com"],
    keywords: ["patch notes", "guild", "season", "tournament", "match"],
  },
  marketing: {
    key: "marketing",
    label: "Marketing",
    summary: "Campaign and growth workflows.",
    domains: ["mailchimp.com", "hubspot.com", "marketo.com", "campaignhq.com"],
    keywords: ["campaign", "CTR", "open rate", "audience", "funnel"],
  },
};

function containsKeyword(input: string, keywords: string[]): boolean {
  const haystack = input.toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
}

export function getViewRule(viewKey: string | undefined): MockViewRule | null {
  if (!viewKey) {
    return null;
  }

  const normalized = viewKey.toLowerCase() as MailboxViewKey;
  return viewRules[normalized] ?? null;
}

export function getViewRuleSummary(rule: MockViewRule): string[] {
  const domainSummary = rule.domains.slice(0, 2).map((domain) => `Domain:${domain}`);
  const keywordSummary = rule.keywords.slice(0, 2).map((keyword) => `Keyword:${keyword}`);
  return [...domainSummary, ...keywordSummary];
}

export function matchesViewRule(message: MailMessage, rule: MockViewRule | null): boolean {
  if (!rule) {
    return true;
  }

  const senderDomainMatch = rule.domains.some((domain) =>
    message.senderDomain.toLowerCase().includes(domain.toLowerCase()),
  );

  const keywordMatch = containsKeyword(
    `${message.subject} ${message.snippet} ${message.senderName}`,
    rule.keywords,
  );

  return senderDomainMatch || keywordMatch;
}
