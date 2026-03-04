package com.mailpilot.api.model;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public record MailboxQueryResponse(List<Item> items, String nextCursor) {

  public record Item(
    UUID id,
    UUID accountId,
    String accountEmail,
    String senderName,
    String senderEmail,
    String senderDomain,
    String subject,
    String snippet,
    OffsetDateTime receivedAt,
    boolean isUnread,
    boolean hasAttachments,
    List<String> chips,
    List<String> tags,
    Highlight highlight
  ) {}

  public record Highlight(String label, String accent) {}
}
