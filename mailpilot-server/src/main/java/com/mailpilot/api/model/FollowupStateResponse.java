package com.mailpilot.api.model;

import java.time.OffsetDateTime;
import java.util.UUID;

public record FollowupStateResponse(
  UUID messageId,
  String status,
  boolean needsReply,
  OffsetDateTime dueAt,
  OffsetDateTime snoozedUntil
) {}
