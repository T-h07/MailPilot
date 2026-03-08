package com.mailpilot.service;

import com.mailpilot.service.gmail.GmailClient.GmailPayload;
import com.mailpilot.service.gmail.GmailMimeParser;
import com.mailpilot.service.gmail.GmailMimeParser.GmailAttachmentPart;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class AttachmentMetadataService {

  private final JdbcTemplate jdbcTemplate;
  private final GmailMimeParser gmailMimeParser;

  public AttachmentMetadataService(JdbcTemplate jdbcTemplate, GmailMimeParser gmailMimeParser) {
    this.jdbcTemplate = jdbcTemplate;
    this.gmailMimeParser = gmailMimeParser;
  }

  public List<GmailAttachmentPart> extractDownloadableAttachments(GmailPayload payload) {
    return gmailMimeParser.extractAttachments(payload).stream()
        .filter((attachment) -> !attachment.isInline())
        .toList();
  }

  public List<StoredAttachment> listDownloadableAttachments(UUID messageId) {
    return jdbcTemplate.query(
        """
      SELECT id, filename, mime_type, size_bytes, COALESCE(is_inline, false) AS is_inline
      FROM attachments
      WHERE message_id = ?
        AND COALESCE(is_inline, false) = false
      ORDER BY filename
      """,
        (resultSet, rowNum) ->
            new StoredAttachment(
                resultSet.getObject("id", UUID.class),
                resultSet.getString("filename"),
                resultSet.getString("mime_type"),
                resultSet.getLong("size_bytes"),
                resultSet.getBoolean("is_inline")),
        messageId);
  }

  public void syncAttachments(UUID messageId, List<GmailAttachmentPart> attachments) {
    List<GmailAttachmentPart> downloadableAttachments =
        attachments == null
            ? List.of()
            : attachments.stream().filter((attachment) -> !attachment.isInline()).toList();

    if (downloadableAttachments.isEmpty()) {
      jdbcTemplate.update("DELETE FROM attachments WHERE message_id = ?", messageId);
      return;
    }

    for (GmailAttachmentPart attachment : downloadableAttachments) {
      if (StringUtils.hasText(attachment.providerAttachmentId())) {
        int updatedRows =
            jdbcTemplate.update(
                """
          UPDATE attachments
          SET filename = ?, mime_type = ?, size_bytes = ?, is_inline = ?, part_id = ?, content_id = ?
          WHERE message_id = ? AND provider_attachment_id = ?
          """,
                attachment.filename(),
                attachment.mimeType(),
                attachment.sizeBytes(),
                attachment.isInline(),
                attachment.partId(),
                attachment.contentId(),
                messageId,
                attachment.providerAttachmentId());

        if (updatedRows == 0) {
          jdbcTemplate.update(
              """
            INSERT INTO attachments (
              message_id,
              provider_attachment_id,
              filename,
              mime_type,
              size_bytes,
              is_inline,
              part_id,
              content_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
              messageId,
              attachment.providerAttachmentId(),
              attachment.filename(),
              attachment.mimeType(),
              attachment.sizeBytes(),
              attachment.isInline(),
              attachment.partId(),
              attachment.contentId());
        }
        continue;
      }

      UUID existingId = findExistingAttachmentId(messageId, attachment);
      if (existingId != null) {
        jdbcTemplate.update(
            """
          UPDATE attachments
          SET
            filename = ?,
            mime_type = ?,
            size_bytes = ?,
            is_inline = ?,
            part_id = ?,
            content_id = ?
          WHERE id = ?
          """,
            attachment.filename(),
            attachment.mimeType(),
            attachment.sizeBytes(),
            attachment.isInline(),
            attachment.partId(),
            attachment.contentId(),
            existingId);
      } else {
        jdbcTemplate.update(
            """
          INSERT INTO attachments (
            message_id,
            provider_attachment_id,
            filename,
            mime_type,
            size_bytes,
            is_inline,
            part_id,
            content_id
          )
          VALUES (?, NULL, ?, ?, ?, ?, ?, ?)
          """,
            messageId,
            attachment.filename(),
            attachment.mimeType(),
            attachment.sizeBytes(),
            attachment.isInline(),
            attachment.partId(),
            attachment.contentId());
      }
    }
  }

  private UUID findExistingAttachmentId(UUID messageId, GmailAttachmentPart attachment) {
    if (StringUtils.hasText(attachment.partId())) {
      UUID byPartId =
          jdbcTemplate
              .query(
                  """
          SELECT id
          FROM attachments
          WHERE message_id = ?
            AND part_id = ?
          ORDER BY created_at DESC
          LIMIT 1
          """,
                  (resultSet, rowNum) -> resultSet.getObject("id", UUID.class),
                  messageId,
                  attachment.partId())
              .stream()
              .findFirst()
              .orElse(null);
      if (byPartId != null) {
        return byPartId;
      }
    }

    return jdbcTemplate
        .query(
            """
        SELECT id
        FROM attachments
        WHERE message_id = ?
          AND provider_attachment_id IS NULL
          AND filename = ?
          AND size_bytes = ?
        ORDER BY created_at DESC
        LIMIT 1
        """,
            (resultSet, rowNum) -> resultSet.getObject("id", UUID.class),
            messageId,
            attachment.filename(),
            attachment.sizeBytes())
        .stream()
        .findFirst()
        .orElse(null);
  }

  public record StoredAttachment(
      UUID id, String filename, String mimeType, long sizeBytes, boolean isInline) {}
}
