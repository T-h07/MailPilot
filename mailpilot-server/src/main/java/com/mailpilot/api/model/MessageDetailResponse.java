package com.mailpilot.api.model;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public record MessageDetailResponse(
  UUID id,
  UUID accountId,
  String accountEmail,
  UUID threadId,
  String senderName,
  String senderEmail,
  String subject,
  String receivedAt,
  String openInGmailUrl,
  boolean isUnread,
  Body body,
  List<Attachment> attachments,
  Thread thread,
  List<String> tags,
  Followup followup,
  Highlight highlight
) {

  public record Body(String mime, String content, boolean isCached) {}

  public record Attachment(UUID id, String filename, String mimeType, long sizeBytes) {}

  public record Thread(List<ThreadMessage> messages) {}

  public record ThreadMessage(
    UUID id,
    String senderEmail,
    String subject,
    OffsetDateTime receivedAt,
    boolean isUnread
  ) {}

  public record Followup(
    String status,
    boolean needsReply,
    OffsetDateTime dueAt,
    OffsetDateTime snoozedUntil
  ) {}

  public record Highlight(String label, String accent) {}
}
