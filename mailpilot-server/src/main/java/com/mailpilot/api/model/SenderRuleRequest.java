package com.mailpilot.api.model;

public record SenderRuleRequest(
  String matchType,
  String matchValue,
  String label,
  String accent
) {}
