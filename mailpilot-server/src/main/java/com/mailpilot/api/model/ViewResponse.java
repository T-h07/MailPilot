package com.mailpilot.api.model;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public record ViewResponse(
  UUID id,
  String name,
  int priority,
  int sortOrder,
  String icon,
  String scopeType,
  List<UUID> selectedAccountIds,
  Rules rules,
  OffsetDateTime updatedAt
) {

  public record Rules(
    List<String> senderDomains,
    List<String> senderEmails,
    List<String> keywords,
    boolean unreadOnly
  ) {}
}
