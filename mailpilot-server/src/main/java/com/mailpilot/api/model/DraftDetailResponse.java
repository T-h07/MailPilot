package com.mailpilot.api.model;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public record DraftDetailResponse(
  UUID id,
  UUID accountId,
  String to,
  String cc,
  String bcc,
  String subject,
  String bodyText,
  String bodyHtml,
  List<DraftAttachment> attachments,
  OffsetDateTime updatedAt
) {

  public record DraftAttachment(String name, String path, Long sizeBytes, String mime) {}
}
