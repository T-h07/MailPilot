package com.mailpilot.service;

import com.mailpilot.api.error.ApiBadRequestException;
import com.mailpilot.api.error.ApiNotFoundException;
import com.mailpilot.api.model.MessageBodyLoadResponse;
import com.mailpilot.api.model.MessageDetailResponse;
import com.mailpilot.service.AttachmentMetadataService.StoredAttachment;
import com.mailpilot.service.gmail.GmailApiExecutor;
import com.mailpilot.service.gmail.GmailClient;
import com.mailpilot.service.gmail.GmailClient.GmailMessageResponse;
import com.mailpilot.service.gmail.GmailClient.GmailPayload;
import com.mailpilot.service.gmail.GmailMimeParser;
import com.mailpilot.service.gmail.GmailMimeParser.DecodedBody;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class MessageService {

  private static final Logger LOGGER = LoggerFactory.getLogger(MessageService.class);
  private static final int MAX_BODY_CACHE_BYTES = 5 * 1024 * 1024;
  private static final String GMAIL_PROVIDER = "GMAIL";

  private final JdbcTemplate jdbcTemplate;
  private final SenderHighlightResolver senderHighlightResolver;
  private final GmailClient gmailClient;
  private final GmailApiExecutor gmailApiExecutor;
  private final GmailMimeParser gmailMimeParser;
  private final AttachmentMetadataService attachmentMetadataService;

  public MessageService(
      JdbcTemplate jdbcTemplate,
      SenderHighlightResolver senderHighlightResolver,
      GmailClient gmailClient,
      GmailApiExecutor gmailApiExecutor,
      GmailMimeParser gmailMimeParser,
      AttachmentMetadataService attachmentMetadataService) {
    this.jdbcTemplate = jdbcTemplate;
    this.senderHighlightResolver = senderHighlightResolver;
    this.gmailClient = gmailClient;
    this.gmailApiExecutor = gmailApiExecutor;
    this.gmailMimeParser = gmailMimeParser;
    this.attachmentMetadataService = attachmentMetadataService;
  }

  public MessageDetailResponse getMessageDetail(UUID messageId) {
    String messageSql =
        """
      SELECT
        m.id,
        m.account_id,
        a.email AS account_email,
        a.provider AS account_provider,
        m.provider_message_id,
        m.thread_id,
        COALESCE(m.sender_name, split_part(m.sender_email, '@', 1)) AS sender_name,
        m.sender_email,
        m.sender_domain,
        COALESCE(m.subject, '(no subject)') AS subject,
        COALESCE(m.snippet, '') AS snippet,
        m.received_at,
        NOT m.is_read AS is_unread,
        m.seen_in_app,
        m.is_sent,
        m.body_cache,
        m.body_cache_mime,
        f.status AS followup_status,
        f.needs_reply,
        f.due_at,
        f.snoozed_until
      FROM messages m
      JOIN accounts a ON a.id = m.account_id
      LEFT JOIN followups f ON f.message_id = m.id
      WHERE m.id = ?
      """;

    List<MessageRow> messageRows =
        jdbcTemplate.query(messageSql, (resultSet, rowNum) -> mapMessageRow(resultSet), messageId);

    if (messageRows.isEmpty()) {
      throw new ApiNotFoundException("Message not found");
    }

    MessageRow messageRow = messageRows.getFirst();

    List<MessageDetailResponse.Attachment> attachments = loadMessageAttachments(messageId);
    if (attachments.isEmpty() && shouldRefreshAttachments(messageRow)) {
      refreshAttachmentMetadata(messageRow);
      attachments = loadMessageAttachments(messageId);
    }

    List<MessageDetailResponse.ThreadMessage> threadMessages;
    if (messageRow.threadId() != null) {
      threadMessages =
          jdbcTemplate.query(
              """
        SELECT id, sender_email, COALESCE(subject, '(no subject)') AS subject, received_at, NOT is_read AS is_unread
        FROM messages
        WHERE thread_id = ?
        ORDER BY received_at DESC, id DESC
        LIMIT 200
        """,
              (resultSet, rowNum) -> mapThreadMessage(resultSet),
              messageRow.threadId());
    } else {
      threadMessages =
          List.of(
              new MessageDetailResponse.ThreadMessage(
                  messageRow.id(),
                  messageRow.senderEmail(),
                  messageRow.subject(),
                  messageRow.receivedAt(),
                  messageRow.isUnread()));
    }

    List<String> tags =
        jdbcTemplate.query(
            """
      SELECT t.name
      FROM message_tags mt
      JOIN tags t ON t.id = mt.tag_id
      WHERE mt.message_id = ?
      ORDER BY t.name
      """,
            (resultSet, rowNum) -> resultSet.getString("name"),
            messageId);

    MessageDetailResponse.Body body =
        new MessageDetailResponse.Body(
            messageRow.bodyCacheMime() == null ? "text/plain" : messageRow.bodyCacheMime(),
            messageRow.bodyCache(),
            messageRow.bodyCache() != null);

    MessageDetailResponse.Followup followup =
        new MessageDetailResponse.Followup(
            messageRow.followupStatus() == null ? "OPEN" : messageRow.followupStatus(),
            Boolean.TRUE.equals(messageRow.needsReply()),
            messageRow.dueAt(),
            messageRow.snoozedUntil());

    SenderHighlightResolver.Highlight resolvedHighlight =
        senderHighlightResolver.resolveSingle(messageRow.senderEmail(), messageRow.senderDomain());
    MessageDetailResponse.Highlight highlight =
        resolvedHighlight == null
            ? null
            : new MessageDetailResponse.Highlight(
                resolvedHighlight.label(), resolvedHighlight.accent());

    return new MessageDetailResponse(
        messageRow.id(),
        messageRow.accountId(),
        messageRow.accountEmail(),
        messageRow.threadId(),
        messageRow.senderName(),
        messageRow.senderEmail(),
        messageRow.subject(),
        messageRow.receivedAt().toString(),
        buildOpenInGmailUrl(messageRow.accountEmail(), messageRow.providerMessageId()),
        messageRow.isUnread(),
        messageRow.seenInApp(),
        messageRow.isSent(),
        body,
        attachments,
        new MessageDetailResponse.Thread(threadMessages),
        tags,
        followup,
        highlight);
  }

  public MessageBodyLoadResponse loadBody(UUID messageId, boolean force) {
    BodyLoadRow message = loadBodyRow(messageId);

    if (!GMAIL_PROVIDER.equalsIgnoreCase(message.accountProvider())) {
      throw new ApiBadRequestException(
          "Message body loading is only supported for GMAIL accounts.");
    }
    if (!StringUtils.hasText(message.providerMessageId())) {
      throw new ApiBadRequestException("provider_message_id is missing for this message.");
    }

    if (!force
        && StringUtils.hasText(message.bodyCache())
        && StringUtils.hasText(message.bodyCacheMime())) {
      String existingMime = message.bodyCacheMime().trim();
      OffsetDateTime cachedAt =
          message.bodyCachedAt() == null
              ? OffsetDateTime.now(ZoneOffset.UTC)
              : message.bodyCachedAt();
      return new MessageBodyLoadResponse(
          "ok", message.id(), existingMime, cachedAt.toString(), utf8Length(message.bodyCache()));
    }

    GmailMessageResponse response =
        gmailApiExecutor.execute(
            message.accountId(),
            (accessToken) ->
                gmailClient.getMessageFull(accessToken, message.providerMessageId().trim()));

    DecodedBody extractedBody = gmailMimeParser.extractPreferredBody(response.payload());
    int contentLength = utf8Length(extractedBody.content());
    if (contentLength > MAX_BODY_CACHE_BYTES) {
      throw new ApiBadRequestException("Message body exceeds the 5 MB cache limit.");
    }

    OffsetDateTime cachedAt = OffsetDateTime.now(ZoneOffset.UTC);
    var refreshedAttachments = attachmentMetadataService.extractDownloadableAttachments(response.payload());
    attachmentMetadataService.syncAttachments(message.id(), refreshedAttachments);
    boolean hasAttachments = !refreshedAttachments.isEmpty();

    int updatedRows =
        jdbcTemplate.update(
            """
      UPDATE messages
      SET body_cache = ?, body_cache_mime = ?, body_cached_at = ?, has_attachments = ?
      WHERE id = ?
      """,
            extractedBody.content(),
            extractedBody.mimeType(),
            cachedAt,
            hasAttachments,
            message.id());
    if (updatedRows == 0) {
      throw new ApiNotFoundException("Message not found");
    }

    return new MessageBodyLoadResponse(
        "ok", message.id(), extractedBody.mimeType(), cachedAt.toString(), contentLength);
  }

  public BodyCacheSnapshot ensureBodyCached(UUID messageId) {
    BodyLoadRow message = loadBodyRow(messageId);
    boolean missingCache =
        !StringUtils.hasText(message.bodyCache()) || !StringUtils.hasText(message.bodyCacheMime());
    if (missingCache && GMAIL_PROVIDER.equalsIgnoreCase(message.accountProvider())) {
      loadBody(messageId, true);
      message = loadBodyRow(messageId);
    }

    return new BodyCacheSnapshot(
        message.id(), message.accountProvider(), message.bodyCache(), message.bodyCacheMime());
  }

  public void setUnread(UUID messageId, boolean isUnread) {
    int updatedRows =
        jdbcTemplate.update("UPDATE messages SET is_read = ? WHERE id = ?", !isUnread, messageId);
    if (updatedRows == 0) {
      throw new ApiNotFoundException("Message not found");
    }
  }

  public void markSeenInApp(UUID messageId) {
    int updatedRows =
        jdbcTemplate.update(
            """
      UPDATE messages
      SET seen_in_app = true,
          seen_in_app_at = COALESCE(seen_in_app_at, now())
      WHERE id = ?
      """,
            messageId);
    if (updatedRows == 0) {
      throw new ApiNotFoundException("Message not found");
    }
  }

  private String buildOpenInGmailUrl(String accountEmail, String providerMessageId) {
    if (!StringUtils.hasText(accountEmail) || !StringUtils.hasText(providerMessageId)) {
      return null;
    }

    String authUser = URLEncoder.encode(accountEmail.trim(), StandardCharsets.UTF_8);
    String messageId = URLEncoder.encode(providerMessageId.trim(), StandardCharsets.UTF_8);
    return "https://mail.google.com/mail/u/?authuser=" + authUser + "#all/" + messageId;
  }
  private int utf8Length(String value) {
    if (value == null) {
      return 0;
    }
    return value.getBytes(StandardCharsets.UTF_8).length;
  }

  private MessageRow mapMessageRow(ResultSet resultSet) throws SQLException {
    return new MessageRow(
        resultSet.getObject("id", UUID.class),
        resultSet.getObject("account_id", UUID.class),
        resultSet.getString("account_email"),
        resultSet.getString("account_provider"),
        resultSet.getString("provider_message_id"),
        resultSet.getObject("thread_id", UUID.class),
        resultSet.getString("sender_name"),
        resultSet.getString("sender_email"),
        resultSet.getString("sender_domain"),
        resultSet.getString("subject"),
        resultSet.getString("snippet"),
        resultSet.getObject("received_at", OffsetDateTime.class),
        resultSet.getBoolean("is_unread"),
        resultSet.getBoolean("seen_in_app"),
        resultSet.getBoolean("is_sent"),
        resultSet.getString("body_cache"),
        resultSet.getString("body_cache_mime"),
        resultSet.getString("followup_status"),
        (Boolean) resultSet.getObject("needs_reply"),
        resultSet.getObject("due_at", OffsetDateTime.class),
        resultSet.getObject("snoozed_until", OffsetDateTime.class));
  }

  private MessageDetailResponse.ThreadMessage mapThreadMessage(ResultSet resultSet)
      throws SQLException {
    return new MessageDetailResponse.ThreadMessage(
        resultSet.getObject("id", UUID.class),
        resultSet.getString("sender_email"),
        resultSet.getString("subject"),
        resultSet.getObject("received_at", OffsetDateTime.class),
        resultSet.getBoolean("is_unread"));
  }

  private record MessageRow(
      UUID id,
      UUID accountId,
      String accountEmail,
      String accountProvider,
      String providerMessageId,
      UUID threadId,
      String senderName,
      String senderEmail,
      String senderDomain,
      String subject,
      String snippet,
      OffsetDateTime receivedAt,
      boolean isUnread,
      boolean seenInApp,
      boolean isSent,
      String bodyCache,
      String bodyCacheMime,
      String followupStatus,
      Boolean needsReply,
      OffsetDateTime dueAt,
      OffsetDateTime snoozedUntil) {}

  private record BodyLoadRow(
      UUID id,
      UUID accountId,
      String accountProvider,
      String providerMessageId,
      String bodyCache,
      String bodyCacheMime,
      OffsetDateTime bodyCachedAt) {}

  private BodyLoadRow loadBodyRow(UUID messageId) {
    return jdbcTemplate
        .query(
            """
      SELECT
        m.id,
        m.account_id,
        a.provider AS account_provider,
        m.provider_message_id,
        m.body_cache,
        m.body_cache_mime,
        m.body_cached_at
      FROM messages m
      JOIN accounts a ON a.id = m.account_id
      WHERE m.id = ?
      """,
            (resultSet, rowNum) ->
                new BodyLoadRow(
                    resultSet.getObject("id", UUID.class),
                    resultSet.getObject("account_id", UUID.class),
                    resultSet.getString("account_provider"),
                    resultSet.getString("provider_message_id"),
                    resultSet.getString("body_cache"),
                    resultSet.getString("body_cache_mime"),
                    resultSet.getObject("body_cached_at", OffsetDateTime.class)),
            messageId)
        .stream()
        .findFirst()
        .orElseThrow(() -> new ApiNotFoundException("Message not found"));
  }

  public record BodyCacheSnapshot(
      UUID messageId, String accountProvider, String bodyCache, String bodyCacheMime) {}
  private List<MessageDetailResponse.Attachment> loadMessageAttachments(UUID messageId) {
    return attachmentMetadataService.listDownloadableAttachments(messageId).stream()
        .map(this::toMessageAttachment)
        .toList();
  }

  private boolean shouldRefreshAttachments(MessageRow messageRow) {
    return GMAIL_PROVIDER.equalsIgnoreCase(messageRow.accountProvider())
        && StringUtils.hasText(messageRow.providerMessageId());
  }

  private void refreshAttachmentMetadata(MessageRow messageRow) {
    try {
      GmailMessageResponse response =
          gmailApiExecutor.execute(
              messageRow.accountId(),
              (accessToken) ->
                  gmailClient.getMessageFull(accessToken, messageRow.providerMessageId()));
      var attachments = attachmentMetadataService.extractDownloadableAttachments(response.payload());
      attachmentMetadataService.syncAttachments(messageRow.id(), attachments);
      jdbcTemplate.update(
          "UPDATE messages SET has_attachments = ? WHERE id = ?",
          !attachments.isEmpty(),
          messageRow.id());
    } catch (Exception exception) {
      LOGGER.debug(
          "Unable to refresh attachment metadata for message {}: {}",
          messageRow.id(),
          exception.getMessage());
    }
  }

  private MessageDetailResponse.Attachment toMessageAttachment(StoredAttachment attachment) {
    return new MessageDetailResponse.Attachment(
        attachment.id(),
        attachment.filename(),
        attachment.mimeType(),
        attachment.sizeBytes(),
        attachment.isInline(),
        true);
  }
}
