package com.mailpilot.api.model;

import java.util.List;
import java.util.UUID;

public record OnboardingViewProposalsResponse(
    int rangeDays,
    int analyzedMessages,
    List<AccountItem> accounts,
    Summary summary,
    List<Proposal> proposals,
    List<Proposal> moreSuggestions,
    String message) {

  public record AccountItem(UUID id, String email, String role) {}

  public record Summary(int totalCandidates, int returnedProposals, int suppressedCandidates) {}

  public record Proposal(
      String key,
      String category,
      String name,
      int confidenceScore,
      String confidenceLevel,
      int priority,
      AccountsScope accountsScope,
      Rules rules,
      int estimatedCount,
      double estimatedPct,
      String explanation,
      List<String> topDomains,
      List<String> topSenders,
      List<SampleMessage> sampleMessages,
      List<AccountDistribution> accountDistribution) {}

  public record AccountsScope(String type, List<UUID> accountIds) {}

  public record Rules(
      List<String> senderDomains,
      List<String> senderEmails,
      List<String> subjectKeywords,
      boolean unreadOnly) {}

  public record SampleMessage(String subject, String senderEmail, String receivedAt) {}

  public record AccountDistribution(UUID accountId, String email, int count) {}
}
