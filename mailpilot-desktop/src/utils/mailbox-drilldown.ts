export type InboxDrilldownParams = {
  unread?: boolean;
  needsReply?: boolean;
  overdue?: boolean;
  dueToday?: boolean;
  snoozed?: boolean;
  allOpen?: boolean;
  senderDomains?: string[];
  senderEmails?: string[];
  accountIds?: string[];
};

export function buildInboxDrilldownPath(params: InboxDrilldownParams): string {
  const searchParams = new URLSearchParams();
  if (params.unread) {
    searchParams.set("unread", "1");
  }
  if (params.needsReply) {
    searchParams.set("needsReply", "1");
  }
  if (params.overdue) {
    searchParams.set("overdue", "1");
  }
  if (params.dueToday) {
    searchParams.set("dueToday", "1");
  }
  if (params.snoozed) {
    searchParams.set("snoozed", "1");
  }
  if (params.allOpen) {
    searchParams.set("allOpen", "1");
  }
  for (const domain of params.senderDomains ?? []) {
    searchParams.append("senderDomain", domain);
  }
  for (const sender of params.senderEmails ?? []) {
    searchParams.append("senderEmail", sender);
  }
  for (const accountId of params.accountIds ?? []) {
    searchParams.append("accountId", accountId);
  }
  const query = searchParams.toString();
  return query.length > 0 ? `/inbox?${query}` : "/inbox";
}
