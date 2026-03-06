package com.mailpilot.api.model;

import java.util.List;
import java.util.UUID;

public record OnboardingViewProposalsResponse(
    int rangeDays, List<AccountItem> accounts, List<Proposal> proposals, String message) {

  public record AccountItem(UUID id, String email, String role) {}

  public record Proposal(
      String key,
      String name,
      int priority,
      AccountsScope accountsScope,
      Rules rules,
      int estimatedCount,
      double estimatedPct,
      String explanation) {}

  public record AccountsScope(String type, List<UUID> accountIds) {}

  public record Rules(
      List<String> senderDomains,
      List<String> senderEmails,
      List<String> subjectKeywords,
      boolean unreadOnly) {}
}
