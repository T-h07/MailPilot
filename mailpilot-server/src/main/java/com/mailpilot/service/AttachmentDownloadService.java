package com.mailpilot.service;

import com.mailpilot.api.error.ApiBadRequestException;
import com.mailpilot.api.error.ApiConflictException;
import com.mailpilot.api.error.ApiNotFoundException;
import com.mailpilot.api.errors.UpstreamException;
import com.mailpilot.service.gmail.GmailApiExecutor;
import com.mailpilot.service.gmail.GmailClient;
import com.mailpilot.service.gmail.GmailClient.GmailApiException;
import com.mailpilot.service.gmail.GmailClient.GmailAttachmentNotFoundException;
import com.mailpilot.service.gmail.GmailClient.GmailAttachmentResponse;
import com.mailpilot.service.gmail.GmailClient.GmailMessageNotFoundException;
import com.mailpilot.service.gmail.GmailClient.GmailMessageResponse;
import com.mailpilot.service.gmail.GmailClient.GmailPayload;
import com.mailpilot.service.gmail.GmailClient.GmailUnauthorizedException;
import com.mailpilot.service.gmail.GmailMimeParser;
import com.mailpilot.service.gmail.GmailMimeParser.AttachmentLookup;
import com.mailpilot.service.logging.LogSanitizer;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class AttachmentDownloadService {

  private static final Logger LOGGER = LoggerFactory.getLogger(AttachmentDownloadService.class);

  private final JdbcTemplate jdbcTemplate;
  private final GmailClient gmailClient;
  private final GmailApiExecutor gmailApiExecutor;
  private final GmailMimeParser gmailMimeParser;
  private final Path attachmentCacheRoot;

  public AttachmentDownloadService(
      JdbcTemplate jdbcTemplate,
      GmailClient gmailClient,
      GmailApiExecutor gmailApiExecutor,
      GmailMimeParser gmailMimeParser,
      @Value("${mailpilot.cacheDir:}") String configuredCacheDir) {
    this.jdbcTemplate = jdbcTemplate;
    this.gmailClient = gmailClient;
    this.gmailApiExecutor = gmailApiExecutor;
    this.gmailMimeParser = gmailMimeParser;
    this.attachmentCacheRoot = resolveCacheDirectory(configuredCacheDir).resolve("attachments");
  }

  public DownloadedAttachment download(UUID attachmentId) {
    AttachmentRow attachment = loadAttachment(attachmentId);
    if (!StringUtils.hasText(attachment.providerMessageId())) {
      throw new ApiBadRequestException(
          "Attachment cannot be downloaded because provider_message_id is missing.");
    }

    String filename =
        StringUtils.hasText(attachment.filename())
            ? attachment.filename().trim()
            : "attachment.bin";
    String mimeType =
        StringUtils.hasText(attachment.mimeType())
            ? attachment.mimeType().trim()
            : "application/octet-stream";

    Path cachedFile = resolveCachePath(attachment, filename);
    byte[] bytes = readCache(cachedFile);
    if (bytes == null) {
      bytes = downloadFromGmail(attachment);
      writeCache(cachedFile, bytes);
    }

    return new DownloadedAttachment(attachment.id(), filename, mimeType, bytes.length, bytes);
  }

  private AttachmentRow loadAttachment(UUID attachmentId) {
    return jdbcTemplate
        .query(
            """
      SELECT
        a.id,
        a.message_id,
        a.provider_attachment_id,
        a.part_id,
        a.content_id,
        COALESCE(a.is_inline, false) AS is_inline,
        a.filename,
        a.mime_type,
        a.size_bytes,
        m.account_id,
        m.provider_message_id
      FROM attachments a
      JOIN messages m ON m.id = a.message_id
      WHERE a.id = ?
      """,
            (resultSet, rowNum) ->
                new AttachmentRow(
                    resultSet.getObject("id", UUID.class),
                    resultSet.getObject("message_id", UUID.class),
                    resultSet.getString("provider_attachment_id"),
                    resultSet.getString("part_id"),
                    resultSet.getString("content_id"),
                    resultSet.getBoolean("is_inline"),
                    resultSet.getString("filename"),
                    resultSet.getString("mime_type"),
                    resultSet.getLong("size_bytes"),
                    resultSet.getObject("account_id", UUID.class),
                    resultSet.getString("provider_message_id")),
            attachmentId)
        .stream()
        .findFirst()
        .orElseThrow(() -> new ApiNotFoundException("Attachment not found"));
  }

  private byte[] downloadFromGmail(AttachmentRow attachment) {
    try {
      if (StringUtils.hasText(attachment.providerAttachmentId())) {
        LOGGER.info(
            "Downloading attachment {} for message {} via Gmail attachment endpoint",
            attachment.id(),
            attachment.messageId());
        return downloadByAttachmentId(attachment);
      }
      LOGGER.info(
          "Downloading attachment {} for message {} via inline MIME payload",
          attachment.id(),
          attachment.messageId());
      return downloadInlineAttachment(attachment);
    } catch (GmailAttachmentNotFoundException exception) {
      return downloadInlineAttachment(attachment);
    } catch (GmailMessageNotFoundException exception) {
      throw new ApiNotFoundException("Attachment source message not found in Gmail");
    } catch (GmailUnauthorizedException exception) {
      throw new ApiConflictException("Gmail re-auth required to download this attachment.");
    } catch (GmailApiException exception) {
      throw new UpstreamException("Failed to fetch attachment from Gmail.");
    } catch (IllegalStateException exception) {
      throw new ApiConflictException("Gmail re-auth required to download this attachment.");
    }
  }

  private byte[] downloadByAttachmentId(AttachmentRow attachment) {
    GmailAttachmentResponse response =
        gmailApiExecutor.execute(
            attachment.accountId(),
            (accessToken) ->
                gmailClient.getAttachment(
                    accessToken,
                    attachment.providerMessageId(),
                    attachment.providerAttachmentId()));
    if (!StringUtils.hasText(response.data())) {
      throw new UpstreamException("Gmail attachment response did not include data.");
    }
    return decodeAttachmentData(response.data());
  }

  private byte[] downloadInlineAttachment(AttachmentRow attachment) {
    GmailMessageResponse messageResponse =
        gmailApiExecutor.execute(
            attachment.accountId(),
            (accessToken) -> gmailClient.getMessageFull(accessToken, attachment.providerMessageId()));
    GmailPayload matchingPart =
        gmailMimeParser.findInlineAttachmentPayload(
            messageResponse.payload(),
            new AttachmentLookup(
                attachment.partId(),
                attachment.contentId(),
                attachment.filename(),
                attachment.mimeType(),
                attachment.sizeBytes()));
    if (matchingPart == null
        || matchingPart.body() == null
        || !StringUtils.hasText(matchingPart.body().data())) {
      throw new ApiNotFoundException("Attachment not found in Gmail");
    }
    return decodeAttachmentData(matchingPart.body().data());
  }

  private Path resolveCachePath(AttachmentRow attachment, String filename) {
    String accountSegment = sanitizePathSegment(attachment.accountId().toString(), "account");
    String messageSegment = sanitizePathSegment(attachment.providerMessageId(), "message");
    String providerAttachmentSegment =
        sanitizePathSegment(
            StringUtils.hasText(attachment.providerAttachmentId())
                ? attachment.providerAttachmentId()
                : attachment.partId(),
            attachment.id().toString());
    String safeFilename = sanitizeFilename(filename);
    return attachmentCacheRoot
        .resolve(accountSegment)
        .resolve(messageSegment)
        .resolve(providerAttachmentSegment)
        .resolve(safeFilename);
  }

  private byte[] readCache(Path cachePath) {
    if (!Files.exists(cachePath)) {
      return null;
    }
    try {
      return Files.readAllBytes(cachePath);
    } catch (IOException exception) {
      LOGGER.warn(
          "Failed to read cached attachment file: {}", LogSanitizer.sanitizePath(cachePath));
      return null;
    }
  }

  private void writeCache(Path cachePath, byte[] bytes) {
    try {
      Files.createDirectories(cachePath.getParent());
      Files.write(cachePath, bytes);
    } catch (IOException exception) {
      LOGGER.warn(
          "Failed to write attachment cache file: {}", LogSanitizer.sanitizePath(cachePath));
    }
  }

  private Path resolveCacheDirectory(String configuredCacheDir) {
    if (StringUtils.hasText(configuredCacheDir)) {
      return Path.of(configuredCacheDir.trim());
    }

    String localAppData = System.getenv("LOCALAPPDATA");
    if (StringUtils.hasText(localAppData)) {
      return Path.of(localAppData, "MailPilot", "cache");
    }

    String userHome = System.getProperty("user.home", ".");
    return Path.of(userHome, "AppData", "Local", "MailPilot", "cache");
  }

  private String sanitizeFilename(String rawFilename) {
    String normalized = sanitizePathSegment(rawFilename, "attachment.bin");
    return normalized.length() > 180 ? normalized.substring(0, 180) : normalized;
  }

  private String sanitizePathSegment(String value, String fallback) {
    if (!StringUtils.hasText(value)) {
      return fallback;
    }
    String sanitized =
        value
            .trim()
            .replaceAll("[\\\\/:*?\"<>|]", "_")
            .replaceAll("\\s+", "_")
            .replaceAll("[^a-zA-Z0-9._-]", "_");
    if (sanitized.isBlank() || ".".equals(sanitized) || "..".equals(sanitized)) {
      return fallback;
    }
    return sanitized;
  }

  private byte[] decodeAttachmentData(String value) {
    try {
      return gmailMimeParser.decodeBase64Url(value);
    } catch (IllegalArgumentException exception) {
      throw new UpstreamException("Gmail returned malformed attachment data.");
    }
  }

  public record DownloadedAttachment(
      UUID id, String filename, String mimeType, long sizeBytes, byte[] bytes) {}

  private record AttachmentRow(
      UUID id,
      UUID messageId,
      String providerAttachmentId,
      String partId,
      String contentId,
      boolean ignoredIsInline,
      String filename,
      String mimeType,
      long sizeBytes,
      UUID accountId,
      String providerMessageId) {}
}
