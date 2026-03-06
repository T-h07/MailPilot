package com.mailpilot.api.model;

import java.util.List;
import java.util.UUID;

public record OnboardingViewProposalsApplyRequest(List<CreateItem> create) {

  public record CreateItem(
      String name, Integer priority, Integer sortOrder, AccountsScope accountsScope, Rules rules) {}

  public record AccountsScope(String type, List<UUID> accountIds) {}

  public record Rules(
      List<String> senderDomains,
      List<String> senderEmails,
      List<String> subjectKeywords,
      Boolean unreadOnly) {}
}
