package com.mailpilot.api.model;

import java.time.OffsetDateTime;

public record SendMailResponse(
  String status,
  String providerMessageId,
  String providerThreadId,
  OffsetDateTime sentAt
) {}
