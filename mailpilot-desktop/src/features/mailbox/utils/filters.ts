import type { MockViewRule } from "@/features/mailbox/mock/mockRules";
import { matchesViewRule } from "@/features/mailbox/mock/mockRules";
import type { MailMessage, QuickFilterKey } from "@/features/mailbox/model/types";

export type QuickFiltersState = Set<QuickFilterKey>;

type FilterMessagesInput = {
  messages: MailMessage[];
  accountScope: string;
  searchQuery: string;
  quickFilters: QuickFiltersState;
  viewRule: MockViewRule | null;
};

function matchesSearch(message: MailMessage, searchQuery: string): boolean {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  const haystack = `${message.senderName} ${message.senderEmail} ${message.subject} ${message.snippet}`.toLowerCase();
  return haystack.includes(normalizedQuery);
}

function matchesQuickFilters(message: MailMessage, quickFilters: QuickFiltersState): boolean {
  if (quickFilters.size === 0) {
    return true;
  }

  for (const filterKey of quickFilters) {
    switch (filterKey) {
      case "UNREAD":
        if (!message.isUnread) {
          return false;
        }
        break;
      case "NEEDS_REPLY":
        if (!message.flags.needsReply) {
          return false;
        }
        break;
      case "OVERDUE":
        if (!message.flags.overdue) {
          return false;
        }
        break;
      case "DUE_TODAY":
        if (!message.flags.dueToday) {
          return false;
        }
        break;
      case "SNOOZED":
        if (!message.flags.snoozed) {
          return false;
        }
        break;
      default:
        return false;
    }
  }

  return true;
}

export function filterMessages({
  messages,
  accountScope,
  searchQuery,
  quickFilters,
  viewRule,
}: FilterMessagesInput): MailMessage[] {
  return messages.filter((message) => {
    if (accountScope !== "ALL" && message.accountId !== accountScope) {
      return false;
    }

    if (!matchesViewRule(message, viewRule)) {
      return false;
    }

    if (!matchesSearch(message, searchQuery)) {
      return false;
    }

    return matchesQuickFilters(message, quickFilters);
  });
}

export function mergeReadOverrides(
  messages: MailMessage[],
  readOverrideMap: Map<string, boolean>,
): MailMessage[] {
  if (readOverrideMap.size === 0) {
    return messages;
  }

  return messages.map((message) => {
    const override = readOverrideMap.get(message.id);
    if (override === undefined) {
      return message;
    }

    return {
      ...message,
      isUnread: override,
      threadMessages: message.threadMessages.map((threadMessage) =>
        threadMessage.id === message.id
          ? {
              ...threadMessage,
              isUnread: override,
            }
          : threadMessage,
      ),
    };
  });
}
