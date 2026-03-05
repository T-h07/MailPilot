package com.mailpilot.api.model;

import java.time.OffsetDateTime;
import java.util.UUID;

public record DraftListItemResponse(
  UUID id,
  UUID accountId,
  String accountEmail,
  String to,
  String subject,
  String snippet,
  OffsetDateTime updatedAt,
  boolean hasAttachments
) {}
