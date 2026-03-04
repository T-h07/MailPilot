package com.mailpilot.api.model;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public record FocusQueueResponse(List<Item> items, String nextCursor) {

  public record Item(
    UUID messageId,
    UUID accountId,
    String accountEmail,
    String senderName,
    String senderEmail,
    String subject,
    String snippet,
    OffsetDateTime receivedAt,
    boolean isUnread,
    String queue,
    OffsetDateTime dueAt,
    OffsetDateTime snoozedUntil,
    boolean needsReply,
    Highlight highlight
  ) {}

  public record Highlight(String label, String accent) {}
}
