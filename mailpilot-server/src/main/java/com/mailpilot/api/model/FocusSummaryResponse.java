package com.mailpilot.api.model;

public record FocusSummaryResponse(
  int needsReplyOpen,
  int overdue,
  int dueToday,
  int snoozed,
  int openTotal
) {}
