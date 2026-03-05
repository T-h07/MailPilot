package com.mailpilot.api.model;

public record DashboardSummaryResponse(
  int unreadTotal,
  int needsReplyOpen,
  int overdue,
  int dueToday,
  int snoozed,
  int unreadBoss,
  String lastUpdatedAt
) {}
