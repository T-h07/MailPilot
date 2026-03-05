package com.mailpilot.service;

import com.mailpilot.api.error.ApiBadRequestException;
import com.mailpilot.api.error.ApiNotFoundException;
import com.mailpilot.service.gmail.GmailClient;
import com.mailpilot.service.gmail.GmailClient.GmailApiException;
import com.mailpilot.service.gmail.GmailClient.GmailAttachmentNotFoundException;
import com.mailpilot.service.gmail.GmailClient.GmailAttachmentResponse;
import com.mailpilot.service.gmail.GmailClient.GmailUnauthorizedException;
import com.mailpilot.service.logging.LogSanitizer;
import com.mailpilot.service.oauth.TokenService;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
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
  private final TokenService tokenService;
  private final Path attachmentCacheRoot;

  public AttachmentDownloadService(
    JdbcTemplate jdbcTemplate,
    GmailClient gmailClient,
    TokenService tokenService,
    @Value("${mailpilot.cacheDir:}") String configuredCacheDir
  ) {
    this.jdbcTemplate = jdbcTemplate;
    this.gmailClient = gmailClient;
    this.tokenService = tokenService;
    this.attachmentCacheRoot = resolveCacheDirectory(configuredCacheDir).resolve("attachments");
  }

  public DownloadedAttachment download(UUID attachmentId) {
    AttachmentRow attachment = loadAttachment(attachmentId);
    if (!StringUtils.hasText(attachment.providerAttachmentId())) {
      throw new ApiBadRequestException("Attachment cannot be downloaded because provider_attachment_id is missing.");
    }
    if (!StringUtils.hasText(attachment.providerMessageId())) {
      throw new ApiBadRequestException("Attachment cannot be downloaded because provider_message_id is missing.");
    }

    String filename = StringUtils.hasText(attachment.filename()) ? attachment.filename().trim() : "attachment.bin";
    String mimeType = StringUtils.hasText(attachment.mimeType())
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
    return jdbcTemplate.query(
      """
      SELECT
        a.id,
        a.message_id,
        a.provider_attachment_id,
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
          resultSet.getString("filename"),
          resultSet.getString("mime_type"),
          resultSet.getLong("size_bytes"),
          resultSet.getObject("account_id", UUID.class),
          resultSet.getString("provider_message_id")
        ),
      attachmentId
    ).stream().findFirst().orElseThrow(() -> new ApiNotFoundException("Attachment not found"));
  }

  private byte[] downloadFromGmail(AttachmentRow attachment) {
    GmailAttachmentResponse response;
    try {
      response = executeWithTokenRetry(
        attachment.accountId(),
        attachment.providerMessageId(),
        attachment.providerAttachmentId()
      );
    } catch (GmailAttachmentNotFoundException exception) {
      throw new ApiNotFoundException("Attachment not found in Gmail");
    } catch (GmailApiException exception) {
      throw new IllegalStateException("Failed to download attachment from Gmail: " + exception.getMessage());
    }

    if (!StringUtils.hasText(response.data())) {
      throw new IllegalStateException("Gmail attachment response did not include data.");
    }

    return decodeBase64Url(response.data());
  }

  private GmailAttachmentResponse executeWithTokenRetry(
    UUID accountId,
    String providerMessageId,
    String providerAttachmentId
  ) {
    String accessToken = tokenService.getValidAccessToken(accountId).accessToken();
    try {
      return gmailClient.getAttachment(accessToken, providerMessageId, providerAttachmentId);
    } catch (GmailUnauthorizedException unauthorizedException) {
      String refreshedAccessToken = tokenService.refreshAccessToken(accountId).accessToken();
      return gmailClient.getAttachment(refreshedAccessToken, providerMessageId, providerAttachmentId);
    }
  }

  private byte[] decodeBase64Url(String value) {
    String trimmed = value.trim();
    int paddingNeeded = (4 - (trimmed.length() % 4)) % 4;
    String padded = trimmed + "=".repeat(paddingNeeded);
    return Base64.getUrlDecoder().decode(padded);
  }

  private Path resolveCachePath(AttachmentRow attachment, String filename) {
    String accountSegment = sanitizePathSegment(attachment.accountId().toString(), "account");
    String messageSegment = sanitizePathSegment(attachment.providerMessageId(), "message");
    String providerAttachmentSegment = sanitizePathSegment(
      attachment.providerAttachmentId(),
      attachment.id().toString()
    );
    String safeFilename = sanitizeFilename(filename);
    return attachmentCacheRoot.resolve(accountSegment).resolve(messageSegment).resolve(providerAttachmentSegment).resolve(safeFilename);
  }

  private byte[] readCache(Path cachePath) {
    if (!Files.exists(cachePath)) {
      return null;
    }
    try {
      return Files.readAllBytes(cachePath);
    } catch (IOException exception) {
      LOGGER.warn("Failed to read cached attachment file: {}", LogSanitizer.sanitizePath(cachePath));
      return null;
    }
  }

  private void writeCache(Path cachePath, byte[] bytes) {
    try {
      Files.createDirectories(cachePath.getParent());
      Files.write(cachePath, bytes);
    } catch (IOException exception) {
      LOGGER.warn("Failed to write attachment cache file: {}", LogSanitizer.sanitizePath(cachePath));
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
    String sanitized = value
      .trim()
      .replaceAll("[\\\\/:*?\"<>|]", "_")
      .replaceAll("\\s+", "_")
      .replaceAll("[^a-zA-Z0-9._-]", "_");
    if (sanitized.isBlank() || ".".equals(sanitized) || "..".equals(sanitized)) {
      return fallback;
    }
    return sanitized;
  }

  public record DownloadedAttachment(UUID id, String filename, String mimeType, long sizeBytes, byte[] bytes) {}

  private record AttachmentRow(
    UUID id,
    UUID messageId,
    String providerAttachmentId,
    String filename,
    String mimeType,
    long sizeBytes,
    UUID accountId,
    String providerMessageId
  ) {}
}
