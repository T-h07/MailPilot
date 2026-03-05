package com.mailpilot.api.model;

import java.util.UUID;

public record MessageBodyLoadResponse(
  String status,
  UUID messageId,
  String mime,
  String cachedAt,
  int contentLength
) {}
