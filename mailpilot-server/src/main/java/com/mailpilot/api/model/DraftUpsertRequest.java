package com.mailpilot.api.model;

import java.util.List;
import java.util.UUID;

public record DraftUpsertRequest(
  UUID accountId,
  String to,
  String cc,
  String bcc,
  String subject,
  String bodyText,
  String bodyHtml,
  List<DraftAttachment> attachments
) {

  public record DraftAttachment(String name, String path, Long sizeBytes, String mime) {}
}
