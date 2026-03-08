package com.mailpilot.api.model;

import java.time.OffsetDateTime;
import java.util.UUID;

public record AccountResponse(
    UUID id,
    String email,
    String provider,
    String status,
    boolean canRead,
    boolean canSend,
    OffsetDateTime lastSyncAt,
    String role,
    String customLabel) {}
