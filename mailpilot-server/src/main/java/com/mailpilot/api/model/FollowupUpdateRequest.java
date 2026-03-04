package com.mailpilot.api.model;

import java.time.OffsetDateTime;

public record FollowupUpdateRequest(
  String status,
  Boolean needsReply,
  OffsetDateTime dueAt,
  OffsetDateTime snoozedUntil
) {}
