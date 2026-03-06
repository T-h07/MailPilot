package com.mailpilot.api.model;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public record FocusSummaryResponse(
    int needsReplyOpen,
    int overdue,
    int dueToday,
    int snoozed,
    int openTotal,
    int wakeupsNext24h,
    List<ByAccount> byAccount,
    List<TopSender> topSenders,
    OffsetDateTime lastUpdatedAt) {

  public record ByAccount(UUID accountId, String email, int count) {}

  public record TopSender(String senderEmail, String senderName, int count) {}
}
