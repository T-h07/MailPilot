package com.mailpilot.api.model;

public record ViewLabelRequest(
  String name,
  String colorToken,
  Integer sortOrder
) {}
