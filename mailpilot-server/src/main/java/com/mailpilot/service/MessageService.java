package com.mailpilot.service;

import com.mailpilot.api.error.ApiBadRequestException;
import com.mailpilot.api.error.ApiNotFoundException;
import com.mailpilot.api.model.MessageBodyLoadResponse;
import com.mailpilot.api.model.MessageDetailResponse;
import com.mailpilot.service.gmail.GmailClient;
import com.mailpilot.service.gmail.GmailClient.GmailBody;
import com.mailpilot.service.gmail.GmailClient.GmailMessageResponse;
import com.mailpilot.service.gmail.GmailClient.GmailPayload;
import com.mailpilot.service.gmail.GmailClient.GmailUnauthorizedException;
import com.mailpilot.service.oauth.TokenService;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.function.Function;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class MessageService {

  private static final int MAX_BODY_CACHE_BYTES = 5 * 1024 * 1024;
  private static final String GMAIL_PROVIDER = "GMAIL";

  private final JdbcTemplate jdbcTemplate;
  private final SenderHighlightResolver senderHighlightResolver;
  private final GmailClient gmailClient;
  private final TokenService tokenService;

  public MessageService(
    JdbcTemplate jdbcTemplate,
    SenderHighlightResolver senderHighlightResolver,
    GmailClient gmailClient,
    TokenService tokenService
  ) {
    this.jdbcTemplate = jdbcTemplate;
    this.senderHighlightResolver = senderHighlightResolver;
    this.gmailClient = gmailClient;
    this.tokenService = tokenService;
  }

  public MessageDetailResponse getMessageDetail(UUID messageId) {
    String messageSql =
      """
      SELECT
        m.id,
        m.account_id,
        a.email AS account_email,
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

    List<MessageRow> messageRows = jdbcTemplate.query(
      messageSql,
      (resultSet, rowNum) -> mapMessageRow(resultSet),
      messageId
    );

    if (messageRows.isEmpty()) {
      throw new ApiNotFoundException("Message not found");
    }

    MessageRow messageRow = messageRows.getFirst();

    List<MessageDetailResponse.Attachment> attachments = jdbcTemplate.query(
      "SELECT id, filename, mime_type, size_bytes FROM attachments WHERE message_id = ? ORDER BY filename",
      (resultSet, rowNum) ->
        new MessageDetailResponse.Attachment(
          resultSet.getObject("id", UUID.class),
          resultSet.getString("filename"),
          resultSet.getString("mime_type"),
          resultSet.getLong("size_bytes")
        ),
      messageId
    );

    List<MessageDetailResponse.ThreadMessage> threadMessages;
    if (messageRow.threadId() != null) {
      threadMessages = jdbcTemplate.query(
        """
        SELECT id, sender_email, COALESCE(subject, '(no subject)') AS subject, received_at, NOT is_read AS is_unread
        FROM messages
        WHERE thread_id = ?
        ORDER BY received_at DESC, id DESC
        LIMIT 200
        """,
        (resultSet, rowNum) -> mapThreadMessage(resultSet),
        messageRow.threadId()
      );
    } else {
      threadMessages = List.of(
        new MessageDetailResponse.ThreadMessage(
          messageRow.id(),
          messageRow.senderEmail(),
          messageRow.subject(),
          messageRow.receivedAt(),
          messageRow.isUnread()
        )
      );
    }

    List<String> tags = jdbcTemplate.query(
      """
      SELECT t.name
      FROM message_tags mt
      JOIN tags t ON t.id = mt.tag_id
      WHERE mt.message_id = ?
      ORDER BY t.name
      """,
      (resultSet, rowNum) -> resultSet.getString("name"),
      messageId
    );

    MessageDetailResponse.Body body = new MessageDetailResponse.Body(
      messageRow.bodyCacheMime() == null ? "text/plain" : messageRow.bodyCacheMime(),
      messageRow.bodyCache(),
      messageRow.bodyCache() != null
    );

    MessageDetailResponse.Followup followup = new MessageDetailResponse.Followup(
      messageRow.followupStatus() == null ? "OPEN" : messageRow.followupStatus(),
      Boolean.TRUE.equals(messageRow.needsReply()),
      messageRow.dueAt(),
      messageRow.snoozedUntil()
    );

    SenderHighlightResolver.Highlight resolvedHighlight = senderHighlightResolver.resolveSingle(
      messageRow.senderEmail(),
      messageRow.senderDomain()
    );
    MessageDetailResponse.Highlight highlight = resolvedHighlight == null
      ? null
      : new MessageDetailResponse.Highlight(resolvedHighlight.label(), resolvedHighlight.accent());

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
      highlight
    );
  }

  public MessageBodyLoadResponse loadBody(UUID messageId, boolean force) {
    BodyLoadRow message = loadBodyRow(messageId);

    if (!GMAIL_PROVIDER.equalsIgnoreCase(message.accountProvider())) {
      throw new ApiBadRequestException("Message body loading is only supported for GMAIL accounts.");
    }
    if (!StringUtils.hasText(message.providerMessageId())) {
      throw new ApiBadRequestException("provider_message_id is missing for this message.");
    }

    if (!force && StringUtils.hasText(message.bodyCache()) && StringUtils.hasText(message.bodyCacheMime())) {
      String existingMime = message.bodyCacheMime().trim();
      OffsetDateTime cachedAt = message.bodyCachedAt() == null
        ? OffsetDateTime.now(ZoneOffset.UTC)
        : message.bodyCachedAt();
      return new MessageBodyLoadResponse(
        "ok",
        message.id(),
        existingMime,
        cachedAt.toString(),
        utf8Length(message.bodyCache())
      );
    }

    GmailMessageResponse response = executeWithTokenRetry(
      message.accountId(),
      (accessToken) -> gmailClient.getMessageFull(accessToken, message.providerMessageId().trim())
    );

    CachedBody extractedBody = extractBody(response.payload());
    int contentLength = utf8Length(extractedBody.content());
    if (contentLength > MAX_BODY_CACHE_BYTES) {
      throw new ApiBadRequestException("Message body exceeds the 5 MB cache limit.");
    }

    OffsetDateTime cachedAt = OffsetDateTime.now(ZoneOffset.UTC);
    int updatedRows = jdbcTemplate.update(
      """
      UPDATE messages
      SET body_cache = ?, body_cache_mime = ?, body_cached_at = ?
      WHERE id = ?
      """,
      extractedBody.content(),
      extractedBody.mime(),
      cachedAt,
      message.id()
    );
    if (updatedRows == 0) {
      throw new ApiNotFoundException("Message not found");
    }

    return new MessageBodyLoadResponse(
      "ok",
      message.id(),
      extractedBody.mime(),
      cachedAt.toString(),
      contentLength
    );
  }

  public BodyCacheSnapshot ensureBodyCached(UUID messageId) {
    BodyLoadRow message = loadBodyRow(messageId);
    boolean missingCache = !StringUtils.hasText(message.bodyCache()) || !StringUtils.hasText(message.bodyCacheMime());
    if (missingCache && GMAIL_PROVIDER.equalsIgnoreCase(message.accountProvider())) {
      loadBody(messageId, true);
      message = loadBodyRow(messageId);
    }

    return new BodyCacheSnapshot(
      message.id(),
      message.accountProvider(),
      message.bodyCache(),
      message.bodyCacheMime()
    );
  }

  public void setUnread(UUID messageId, boolean isUnread) {
    int updatedRows = jdbcTemplate.update("UPDATE messages SET is_read = ? WHERE id = ?", !isUnread, messageId);
    if (updatedRows == 0) {
      throw new ApiNotFoundException("Message not found");
    }
  }

  public void markSeenInApp(UUID messageId) {
    int updatedRows = jdbcTemplate.update(
      """
      UPDATE messages
      SET seen_in_app = true,
          seen_in_app_at = COALESCE(seen_in_app_at, now())
      WHERE id = ?
      """,
      messageId
    );
    if (updatedRows == 0) {
      throw new ApiNotFoundException("Message not found");
    }
  }

  private CachedBody extractBody(GmailPayload payload) {
    BodyCollector collector = new BodyCollector(new ArrayList<>(), new ArrayList<>());
    collectBodyParts(payload, collector);

    String html = joinCollectedParts(collector.htmlParts());
    if (StringUtils.hasText(html)) {
      return new CachedBody("text/html", html);
    }

    String plain = joinCollectedParts(collector.plainParts());
    if (StringUtils.hasText(plain)) {
      return new CachedBody("text/plain", plain);
    }

    if (collector.attachmentOnlyBody()) {
      throw new ApiBadRequestException("Message body is stored as attachment-only content and cannot be loaded yet.");
    }
    throw new ApiBadRequestException("No body content available from Gmail for this message.");
  }

  private void collectBodyParts(GmailPayload payload, BodyCollector collector) {
    if (payload == null) {
      return;
    }

    String mimeType = normalizeMime(payload.mimeType());
    if (mimeType.startsWith("text/plain")) {
      collectBodyPart(payload.body(), collector.plainParts(), collector);
    } else if (mimeType.startsWith("text/html")) {
      collectBodyPart(payload.body(), collector.htmlParts(), collector);
    }

    List<GmailPayload> parts = payload.parts();
    if (parts == null || parts.isEmpty()) {
      return;
    }
    for (GmailPayload part : parts) {
      collectBodyParts(part, collector);
    }
  }

  private void collectBodyPart(GmailBody body, List<String> target, BodyCollector collector) {
    if (body == null) {
      return;
    }

    if (StringUtils.hasText(body.data())) {
      String decoded = decodeBase64UrlToText(body.data());
      if (StringUtils.hasText(decoded)) {
        target.add(decoded);
      }
      return;
    }

    if (StringUtils.hasText(body.attachmentId())) {
      collector.markAttachmentOnlyBody();
    }
  }

  private String joinCollectedParts(List<String> parts) {
    if (parts == null || parts.isEmpty()) {
      return "";
    }
    return String.join("\n\n", parts).trim();
  }

  private String decodeBase64UrlToText(String value) {
    String trimmed = value.trim();
    int paddingNeeded = (4 - (trimmed.length() % 4)) % 4;
    String padded = trimmed + "=".repeat(paddingNeeded);
    try {
      byte[] decoded = Base64.getUrlDecoder().decode(padded);
      return new String(decoded, StandardCharsets.UTF_8);
    } catch (IllegalArgumentException exception) {
      throw new ApiBadRequestException("Message body returned invalid base64 encoding.");
    }
  }

  private <T> T executeWithTokenRetry(UUID accountId, Function<String, T> request) {
    String accessToken = tokenService.getValidAccessToken(accountId).accessToken();
    try {
      return request.apply(accessToken);
    } catch (GmailUnauthorizedException unauthorizedException) {
      String refreshedAccessToken = tokenService.refreshAccessToken(accountId).accessToken();
      return request.apply(refreshedAccessToken);
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

  private String normalizeMime(String mimeType) {
    if (!StringUtils.hasText(mimeType)) {
      return "";
    }
    return mimeType.trim().toLowerCase(Locale.ROOT);
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
      resultSet.getObject("snoozed_until", OffsetDateTime.class)
    );
  }

  private MessageDetailResponse.ThreadMessage mapThreadMessage(ResultSet resultSet) throws SQLException {
    return new MessageDetailResponse.ThreadMessage(
      resultSet.getObject("id", UUID.class),
      resultSet.getString("sender_email"),
      resultSet.getString("subject"),
      resultSet.getObject("received_at", OffsetDateTime.class),
      resultSet.getBoolean("is_unread")
    );
  }

  private record MessageRow(
    UUID id,
    UUID accountId,
    String accountEmail,
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
    OffsetDateTime snoozedUntil
  ) {}

  private record BodyLoadRow(
    UUID id,
    UUID accountId,
    String accountEmail,
    String accountProvider,
    String providerMessageId,
    String bodyCache,
    String bodyCacheMime,
    OffsetDateTime bodyCachedAt
  ) {}

  private record CachedBody(String mime, String content) {}

  private BodyLoadRow loadBodyRow(UUID messageId) {
    return jdbcTemplate.query(
      """
      SELECT
        m.id,
        m.account_id,
        a.email AS account_email,
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
          resultSet.getString("account_email"),
          resultSet.getString("account_provider"),
          resultSet.getString("provider_message_id"),
          resultSet.getString("body_cache"),
          resultSet.getString("body_cache_mime"),
          resultSet.getObject("body_cached_at", OffsetDateTime.class)
        ),
      messageId
    ).stream().findFirst().orElseThrow(() -> new ApiNotFoundException("Message not found"));
  }

  public record BodyCacheSnapshot(UUID messageId, String accountProvider, String bodyCache, String bodyCacheMime) {}

  private static final class BodyCollector {

    private final List<String> plainParts;
    private final List<String> htmlParts;
    private boolean attachmentOnlyBody;

    private BodyCollector(List<String> plainParts, List<String> htmlParts) {
      this.plainParts = plainParts;
      this.htmlParts = htmlParts;
      this.attachmentOnlyBody = false;
    }

    private List<String> plainParts() {
      return plainParts;
    }

    private List<String> htmlParts() {
      return htmlParts;
    }

    private boolean attachmentOnlyBody() {
      return attachmentOnlyBody;
    }

    private void markAttachmentOnlyBody() {
      attachmentOnlyBody = true;
    }
  }
}
