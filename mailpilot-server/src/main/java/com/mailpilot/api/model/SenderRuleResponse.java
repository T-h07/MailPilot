package com.mailpilot.api.model;

import java.time.OffsetDateTime;
import java.util.UUID;

public record SenderRuleResponse(
  UUID id,
  String matchType,
  String matchValue,
  String label,
  String accent,
  OffsetDateTime createdAt
) {}
