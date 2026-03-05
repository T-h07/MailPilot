package com.mailpilot.api.model;

import java.util.List;
import java.util.UUID;

public record DashboardSummaryResponse(
  int unreadTotal,
  int needsReplyOpen,
  int overdue,
  int dueToday,
  int snoozed,
  int unreadBoss,
  int receivedLast24h,
  int receivedPrev24h,
  double receivedDeltaPct,
  int unreadDelta,
  int overdueDelta,
  int needsReplyDelta,
  List<DomainCount> topDomainsUnread,
  List<SenderCount> topSendersUnread,
  List<DomainCount> topDomainsReceived24h,
  List<SenderCount> topSendersReceived24h,
  List<AccountCount> unreadByAccount,
  List<String> bossSenderDomains,
  List<String> bossSenderEmails,
  int openFollowupsTotal,
  int snoozedWakingNext24h,
  List<SeriesPoint> series7d,
  String lastUpdatedAt
) {

  public record DomainCount(String domain, int count) {}

  public record SenderCount(String email, int count) {}

  public record AccountCount(UUID accountId, String email, int count) {}

  public record SeriesPoint(
    String date,
    int unreadNow,
    int needsReplyOpen,
    int overdue,
    int dueToday,
    int snoozed,
    int unreadBoss
  ) {}
}
