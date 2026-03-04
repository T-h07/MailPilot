package com.mailpilot.api.model;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.util.List;
import java.util.UUID;

public record MailboxQueryRequest(
  Scope scope,
  String q,
  Filters filters,
  String sort,
  @Min(value = 10, message = "pageSize must be between 10 and 200")
  @Max(value = 200, message = "pageSize must be between 10 and 200")
  Integer pageSize,
  String cursor
) {

  public record Scope(List<UUID> accountIds) {}

  public record Filters(
    Boolean unreadOnly,
    Boolean needsReply,
    Boolean overdue,
    Boolean dueToday,
    Boolean snoozed,
    Boolean allOpen,
    List<String> senderDomains,
    List<String> senderEmails,
    List<String> keywords
  ) {}
}
