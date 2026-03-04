package com.mailpilot.api.model;

import java.util.List;
import java.util.UUID;

public record ViewUpsertRequest(
  String name,
  Integer priority,
  Integer sortOrder,
  String icon,
  String scopeType,
  List<UUID> selectedAccountIds,
  Rules rules
) {

  public record Rules(
    List<String> senderDomains,
    List<String> senderEmails,
    List<String> keywords,
    Boolean unreadOnly
  ) {}
}
