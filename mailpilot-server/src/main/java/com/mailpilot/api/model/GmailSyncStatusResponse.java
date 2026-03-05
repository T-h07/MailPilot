package com.mailpilot.api.model;

import java.time.OffsetDateTime;
import java.util.UUID;

public record GmailSyncStatusResponse(
  UUID accountId,
  String email,
  String status,
  OffsetDateTime lastSyncAt,
  String lastError,
  OffsetDateTime lastRunStartedAt
) {}
