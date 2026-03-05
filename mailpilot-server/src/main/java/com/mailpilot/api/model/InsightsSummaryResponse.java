package com.mailpilot.api.model;

import java.util.List;
import java.util.UUID;

public record InsightsSummaryResponse(
  String range,
  int receivedCount,
  int uniqueSenders,
  Comparison comparison,
  List<DomainCount> topDomains,
  List<SenderCount> topSenders,
  List<AccountCount> volumeByAccount,
  int unreadNow,
  List<DomainCount> unreadByDomain,
  FollowupCountsNow followupCountsNow,
  Series series
) {

  public record DomainCount(String domain, int count) {}

  public record SenderCount(String email, int count) {}

  public record AccountCount(UUID accountId, String email, int count) {}

  public record Comparison(
    int receivedPreviousCount,
    double receivedDeltaPct,
    int uniqueSendersPreviousCount,
    double uniqueSendersDeltaPct
  ) {}

  public record FollowupCountsNow(
    int needsReply,
    int overdue,
    int dueToday,
    int snoozed
  ) {}

  public record Series(List<VolumePoint> volumePerDay, List<VolumePoint> unreadPerDay) {}

  public record VolumePoint(String date, int count) {}
}
