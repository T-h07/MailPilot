package com.mailpilot.api.model;

import java.util.UUID;

public record ViewLabelResponse(
  UUID id,
  UUID viewId,
  String name,
  String colorToken,
  int sortOrder
) {}
