package com.mailpilot.service.sync;

import com.mailpilot.api.error.ApiBadRequestException;
import com.mailpilot.service.gmail.GmailClient;
import com.mailpilot.service.gmail.GmailClient.GmailBody;
import com.mailpilot.service.gmail.GmailClient.GmailHeader;
import com.mailpilot.service.gmail.GmailClient.GmailHistoryExpiredException;
import com.mailpilot.service.gmail.GmailClient.GmailMessageNotFoundException;
import com.mailpilot.service.gmail.GmailClient.GmailMessageResponse;
import com.mailpilot.service.gmail.GmailClient.GmailPayload;
import com.mailpilot.service.gmail.GmailClient.GmailProfileResponse;
import com.mailpilot.service.gmail.GmailClient.GmailUnauthorizedException;
import com.mailpilot.service.gmail.GmailClient.HistoryListResponse;
import com.mailpilot.service.gmail.GmailClient.HistoryMessageContainer;
import com.mailpilot.service.gmail.GmailClient.HistoryRecord;
import com.mailpilot.service.gmail.GmailClient.MessageListResponse;
import com.mailpilot.service.gmail.GmailClient.MessageRef;
import com.mailpilot.service.oauth.TokenService;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Function;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class GmailSyncService {

  public static final int DEFAULT_MAX_MESSAGES = 500;
  public static final int MAX_MAX_MESSAGES = 2000;
  private static final int GMAIL_LIST_PAGE_SIZE = 100;

  private static final Logger LOGGER = LoggerFactory.getLogger(GmailSyncService.class);
  private static final Pattern ANGLE_BRACKET_EMAIL = Pattern.compile("<([^>]+)>");
  private static final Pattern SIMPLE_EMAIL =
    Pattern.compile("([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,})");

  private final JdbcTemplate jdbcTemplate;
  private final GmailClient gmailClient;
  private final TokenService tokenService;
  private final ExecutorService messageFetchExecutor = Executors.newFixedThreadPool(4);

  public GmailSyncService(
    JdbcTemplate jdbcTemplate,
    GmailClient gmailClient,
    TokenService tokenService
  ) {
    this.jdbcTemplate = jdbcTemplate;
    this.gmailClient = gmailClient;
    this.tokenService = tokenService;
  }

  @PreDestroy
  public void shutdown() {
    messageFetchExecutor.shutdownNow();
  }

  public int normalizeMaxMessages(Integer rawMaxMessages) {
    if (rawMaxMessages == null) {
      return DEFAULT_MAX_MESSAGES;
    }
    if (rawMaxMessages < 1 || rawMaxMessages > MAX_MAX_MESSAGES) {
      throw new ApiBadRequestException("maxMessages must be between 1 and " + MAX_MAX_MESSAGES);
    }
    return rawMaxMessages;
  }

  public SyncResult syncAccount(UUID accountId, int maxMessages) {
    AccountRow account = loadAccount(accountId);
    if (!"GMAIL".equalsIgnoreCase(account.provider())) {
      throw new ApiBadRequestException("Account provider must be GMAIL");
    }
    if (!"CONNECTED".equalsIgnoreCase(account.status())) {
      throw new ApiBadRequestException("Account is not in CONNECTED state");
    }

    GmailProfileResponse profile = executeWithTokenRetry(
      accountId,
      (accessToken) -> gmailClient.getProfile(accessToken)
    );

    String profileEmail = normalize(profile.emailAddress());
    if (!StringUtils.hasText(profileEmail)) {
      throw new IllegalStateException("Gmail profile response missing email address");
    }
    if (!profileEmail.equalsIgnoreCase(account.email())) {
      throw new IllegalStateException("Connected Gmail profile email does not match account email");
    }
    if (!StringUtils.hasText(profile.historyId())) {
      throw new IllegalStateException("Gmail profile response missing historyId");
    }

    SyncCounters counters;
    boolean usedBootstrapFallback = false;

    if (!StringUtils.hasText(account.gmailHistoryId())) {
      counters = runBootstrapSync(accountId, maxMessages);
    } else {
      try {
        counters = runIncrementalSync(accountId, account.gmailHistoryId(), maxMessages);
      } catch (GmailHistoryExpiredException exception) {
        LOGGER.info(
          "Gmail history cursor expired for account {} ({}). Running bounded bootstrap sync.",
          accountId,
          account.email()
        );
        counters = runBootstrapSync(accountId, maxMessages);
        usedBootstrapFallback = true;
      }
    }

    GmailProfileResponse latestProfile = executeWithTokenRetry(
      accountId,
      (accessToken) -> gmailClient.getProfile(accessToken)
    );
    String latestHistoryId = StringUtils.hasText(latestProfile.historyId())
      ? latestProfile.historyId()
      : profile.historyId();

    jdbcTemplate.update(
      """
      UPDATE accounts
      SET gmail_history_id = ?, last_sync_at = now(), updated_at = now()
      WHERE id = ?
      """,
      latestHistoryId,
      accountId
    );

    LOGGER.info(
      "Gmail sync completed for {} ({}). upserted={}, deleted={}, bootstrapFallback={}",
      account.email(),
      accountId,
      counters.upserted(),
      counters.deleted(),
      usedBootstrapFallback
    );

    return new SyncResult(accountId, account.email(), counters.upserted(), counters.deleted());
  }

  private SyncCounters runBootstrapSync(UUID accountId, int maxMessages) {
    List<String> messageIds = collectBootstrapMessageIds(accountId, maxMessages);
    return processMessageIds(accountId, messageIds, Set.of());
  }

  private SyncCounters runIncrementalSync(UUID accountId, String startHistoryId, int maxMessages) {
    HistoryChanges changes = collectHistoryChanges(accountId, startHistoryId);

    int deleted = deleteMessagesByProviderIds(accountId, changes.deletedMessageIds());

    List<String> toFetch = changes.changedMessageIds()
      .stream()
      .filter((messageId) -> !changes.deletedMessageIds().contains(messageId))
      .limit(maxMessages)
      .toList();

    SyncCounters processed = processMessageIds(accountId, toFetch, changes.deletedMessageIds());
    return new SyncCounters(processed.upserted(), processed.deleted() + deleted);
  }

  private List<String> collectBootstrapMessageIds(UUID accountId, int maxMessages) {
    LinkedHashSet<String> messageIds = new LinkedHashSet<>();
    String pageToken = null;

    while (messageIds.size() < maxMessages) {
      int batchSize = Math.min(GMAIL_LIST_PAGE_SIZE, maxMessages - messageIds.size());
      String currentPageToken = pageToken;
      MessageListResponse response = executeWithTokenRetry(
        accountId,
        (accessToken) -> gmailClient.listMessages(accessToken, batchSize, currentPageToken, null)
      );

      List<MessageRef> refs = response.messages() == null ? List.of() : response.messages();
      if (refs.isEmpty()) {
        break;
      }

      for (MessageRef ref : refs) {
        if (ref == null || !StringUtils.hasText(ref.id())) {
          continue;
        }
        messageIds.add(ref.id());
        if (messageIds.size() >= maxMessages) {
          break;
        }
      }

      pageToken = response.nextPageToken();
      if (!StringUtils.hasText(pageToken)) {
        break;
      }
    }

    return List.copyOf(messageIds);
  }

  private HistoryChanges collectHistoryChanges(UUID accountId, String startHistoryId) {
    LinkedHashSet<String> changed = new LinkedHashSet<>();
    LinkedHashSet<String> deleted = new LinkedHashSet<>();
    String pageToken = null;

    while (true) {
      String currentPageToken = pageToken;
      HistoryListResponse response = executeWithTokenRetry(
        accountId,
        (accessToken) -> gmailClient.historyList(accessToken, startHistoryId, currentPageToken)
      );

      List<HistoryRecord> records = response.history() == null ? List.of() : response.history();
      for (HistoryRecord record : records) {
        addMessageRefs(changed, record.messages());
        addMessageContainers(changed, record.messagesAdded());
        addMessageContainers(changed, record.labelsAdded());
        addMessageContainers(changed, record.labelsRemoved());

        LinkedHashSet<String> deletedFromRecord = new LinkedHashSet<>();
        addMessageContainers(deletedFromRecord, record.messagesDeleted());
        deleted.addAll(deletedFromRecord);
      }

      pageToken = response.nextPageToken();
      if (!StringUtils.hasText(pageToken)) {
        break;
      }
    }

    return new HistoryChanges(List.copyOf(changed), Set.copyOf(deleted));
  }

  private void addMessageRefs(Set<String> target, List<MessageRef> refs) {
    if (refs == null || refs.isEmpty()) {
      return;
    }
    for (MessageRef ref : refs) {
      if (ref != null && StringUtils.hasText(ref.id())) {
        target.add(ref.id());
      }
    }
  }

  private void addMessageContainers(Set<String> target, List<HistoryMessageContainer> containers) {
    if (containers == null || containers.isEmpty()) {
      return;
    }

    for (HistoryMessageContainer container : containers) {
      if (container == null || container.message() == null) {
        continue;
      }
      if (StringUtils.hasText(container.message().id())) {
        target.add(container.message().id());
      }
    }
  }

  private SyncCounters processMessageIds(
    UUID accountId,
    List<String> messageIds,
    Set<String> alreadyDeletedMessageIds
  ) {
    if (messageIds.isEmpty()) {
      return new SyncCounters(0, 0);
    }

    List<CompletableFuture<FetchedMessage>> futures = messageIds
      .stream()
      .map((messageId) -> CompletableFuture.supplyAsync(
        () -> fetchMessage(accountId, messageId),
        messageFetchExecutor
      ))
      .toList();

    int upserted = 0;
    int deleted = 0;
    Map<String, UUID> threadCache = new HashMap<>();

    for (CompletableFuture<FetchedMessage> future : futures) {
      FetchedMessage fetchedMessage;
      try {
        fetchedMessage = future.join();
      } catch (CompletionException exception) {
        Throwable cause = exception.getCause();
        if (cause instanceof RuntimeException runtimeException) {
          throw runtimeException;
        }
        throw exception;
      }

      if (fetchedMessage.notFound()) {
        if (!alreadyDeletedMessageIds.contains(fetchedMessage.providerMessageId())) {
          deleted += deleteMessageByProviderId(accountId, fetchedMessage.providerMessageId());
        }
        continue;
      }

      if (fetchedMessage.message() == null) {
        continue;
      }

      GmailMetadata metadata = mapMessage(fetchedMessage.message());
      upsertMessageMetadata(accountId, metadata, threadCache);
      upserted += 1;
    }

    return new SyncCounters(upserted, deleted);
  }

  private FetchedMessage fetchMessage(UUID accountId, String messageId) {
    try {
      GmailMessageResponse response = executeWithTokenRetry(
        accountId,
        (accessToken) -> gmailClient.getMessage(accessToken, messageId)
      );
      return new FetchedMessage(messageId, false, response);
    } catch (GmailMessageNotFoundException exception) {
      return new FetchedMessage(messageId, true, null);
    }
  }

  private void upsertMessageMetadata(
    UUID accountId,
    GmailMetadata metadata,
    Map<String, UUID> threadCache
  ) {
    UUID threadId = threadCache.computeIfAbsent(
      metadata.providerThreadId(),
      (providerThreadId) -> upsertThread(accountId, providerThreadId, metadata.subject(), metadata.receivedAt())
    );

    UUID messageId = jdbcTemplate.queryForObject(
      """
      INSERT INTO messages (
        account_id,
        thread_id,
        provider_message_id,
        message_rfc822_id,
        sender_name,
        sender_email,
        sender_domain,
        subject,
        snippet,
        received_at,
        is_read,
        has_attachments
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (account_id, provider_message_id)
      DO UPDATE SET
        thread_id = EXCLUDED.thread_id,
        message_rfc822_id = COALESCE(EXCLUDED.message_rfc822_id, messages.message_rfc822_id),
        sender_name = EXCLUDED.sender_name,
        sender_email = EXCLUDED.sender_email,
        sender_domain = EXCLUDED.sender_domain,
        subject = EXCLUDED.subject,
        snippet = EXCLUDED.snippet,
        received_at = EXCLUDED.received_at,
        is_read = EXCLUDED.is_read,
        has_attachments = EXCLUDED.has_attachments
      RETURNING id
      """,
      UUID.class,
      accountId,
      threadId,
      metadata.providerMessageId(),
      metadata.messageRfc822Id(),
      metadata.senderName(),
      metadata.senderEmail(),
      metadata.senderDomain(),
      metadata.subject(),
      metadata.snippet(),
      metadata.receivedAt(),
      metadata.isRead(),
      metadata.hasAttachments()
    );

    if (messageId == null) {
      throw new IllegalStateException("Failed to upsert message metadata");
    }

    upsertAttachmentMetadata(messageId, metadata.attachments());
  }

  private UUID upsertThread(
    UUID accountId,
    String providerThreadId,
    String subject,
    OffsetDateTime receivedAt
  ) {
    UUID threadId = jdbcTemplate.queryForObject(
      """
      INSERT INTO threads (account_id, provider_thread_id, subject, last_message_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (account_id, provider_thread_id)
      DO UPDATE SET
        subject = COALESCE(threads.subject, EXCLUDED.subject),
        last_message_at = GREATEST(COALESCE(threads.last_message_at, EXCLUDED.last_message_at), EXCLUDED.last_message_at)
      RETURNING id
      """,
      UUID.class,
      accountId,
      providerThreadId,
      subject,
      receivedAt
    );

    if (threadId == null) {
      throw new IllegalStateException("Failed to upsert thread");
    }

    return threadId;
  }

  private void upsertAttachmentMetadata(UUID messageId, List<AttachmentMetadata> attachments) {
    if (attachments.isEmpty()) {
      jdbcTemplate.update("DELETE FROM attachments WHERE message_id = ?", messageId);
      return;
    }

    for (AttachmentMetadata attachment : attachments) {
      if (StringUtils.hasText(attachment.providerAttachmentId())) {
        int updatedRows = jdbcTemplate.update(
          """
          UPDATE attachments
          SET filename = ?, mime_type = ?, size_bytes = ?
          WHERE message_id = ? AND provider_attachment_id = ?
          """,
          attachment.filename(),
          attachment.mimeType(),
          attachment.sizeBytes(),
          messageId,
          attachment.providerAttachmentId()
        );

        if (updatedRows == 0) {
          jdbcTemplate.update(
            """
            INSERT INTO attachments (message_id, provider_attachment_id, filename, mime_type, size_bytes)
            VALUES (?, ?, ?, ?, ?)
            """,
            messageId,
            attachment.providerAttachmentId(),
            attachment.filename(),
            attachment.mimeType(),
            attachment.sizeBytes()
          );
        }
        continue;
      }

      UUID existingId = jdbcTemplate.query(
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
        attachment.sizeBytes()
      ).stream().findFirst().orElse(null);

      if (existingId != null) {
        jdbcTemplate.update(
          "UPDATE attachments SET mime_type = ? WHERE id = ?",
          attachment.mimeType(),
          existingId
        );
      } else {
        jdbcTemplate.update(
          """
          INSERT INTO attachments (message_id, provider_attachment_id, filename, mime_type, size_bytes)
          VALUES (?, NULL, ?, ?, ?)
          """,
          messageId,
          attachment.filename(),
          attachment.mimeType(),
          attachment.sizeBytes()
        );
      }
    }
  }

  private int deleteMessagesByProviderIds(UUID accountId, Collection<String> providerMessageIds) {
    int deleted = 0;
    for (String providerMessageId : providerMessageIds) {
      deleted += deleteMessageByProviderId(accountId, providerMessageId);
    }
    return deleted;
  }

  private int deleteMessageByProviderId(UUID accountId, String providerMessageId) {
    if (!StringUtils.hasText(providerMessageId)) {
      return 0;
    }
    return jdbcTemplate.update(
      "DELETE FROM messages WHERE account_id = ? AND provider_message_id = ?",
      accountId,
      providerMessageId
    );
  }

  private GmailMetadata mapMessage(GmailMessageResponse message) {
    String providerMessageId = requireText(message.id(), "Message id is missing from Gmail response");
    String providerThreadId = StringUtils.hasText(message.threadId()) ? message.threadId() : providerMessageId;

    Map<String, String> headers = extractHeaders(message.payload());
    Sender sender = parseSender(headers.get("from"));

    String subject = nullable(headers.get("subject"));
    String messageRfc822Id = nullable(headers.get("message-id"));
    String snippet = StringUtils.hasText(message.snippet()) ? message.snippet().trim() : "";

    OffsetDateTime receivedAt = resolveReceivedAt(message.internalDate(), headers.get("date"));
    boolean isRead = message.labelIds() == null || !message.labelIds().contains("UNREAD");
    List<AttachmentMetadata> attachments = extractAttachments(message.payload());

    return new GmailMetadata(
      providerMessageId,
      providerThreadId,
      sender.name(),
      sender.email(),
      sender.domain(),
      subject,
      snippet,
      messageRfc822Id,
      receivedAt,
      isRead,
      !attachments.isEmpty(),
      attachments
    );
  }

  private Map<String, String> extractHeaders(GmailPayload payload) {
    Map<String, String> headers = new HashMap<>();
    if (payload == null || payload.headers() == null) {
      return headers;
    }

    for (GmailHeader header : payload.headers()) {
      if (header == null || !StringUtils.hasText(header.name()) || !StringUtils.hasText(header.value())) {
        continue;
      }
      headers.put(header.name().trim().toLowerCase(Locale.ROOT), header.value().trim());
    }

    return headers;
  }

  private Sender parseSender(String fromHeader) {
    if (!StringUtils.hasText(fromHeader)) {
      return new Sender("Unknown Sender", "unknown@unknown.invalid", "unknown.invalid");
    }

    String raw = fromHeader.trim();
    String email = null;
    String name = null;

    Matcher angleMatcher = ANGLE_BRACKET_EMAIL.matcher(raw);
    if (angleMatcher.find()) {
      email = angleMatcher.group(1).trim();
      name = raw.substring(0, angleMatcher.start()).replace("\"", "").trim();
    } else {
      Matcher simpleEmail = SIMPLE_EMAIL.matcher(raw);
      if (simpleEmail.find()) {
        email = simpleEmail.group(1).trim();
        name = raw.replace(email, "").replace("\"", "").trim();
      }
    }

    if (!StringUtils.hasText(email) || !email.contains("@")) {
      email = "unknown@unknown.invalid";
    }

    if (!StringUtils.hasText(name)) {
      String localPart = email.split("@")[0];
      name = localPart.isBlank() ? "Unknown Sender" : localPart;
    }

    String[] parts = email.split("@", 2);
    String domain = parts.length == 2 && StringUtils.hasText(parts[1])
      ? parts[1].toLowerCase(Locale.ROOT)
      : "unknown.invalid";

    return new Sender(name, email.toLowerCase(Locale.ROOT), domain);
  }

  private OffsetDateTime resolveReceivedAt(String internalDateMillis, String dateHeader) {
    if (StringUtils.hasText(internalDateMillis)) {
      try {
        long millis = Long.parseLong(internalDateMillis);
        return OffsetDateTime.ofInstant(Instant.ofEpochMilli(millis), ZoneOffset.UTC);
      } catch (NumberFormatException ignored) {}
    }

    if (StringUtils.hasText(dateHeader)) {
      try {
        ZonedDateTime parsed = ZonedDateTime.parse(dateHeader, DateTimeFormatter.RFC_1123_DATE_TIME);
        return parsed.toOffsetDateTime();
      } catch (DateTimeParseException ignored) {}
    }

    return OffsetDateTime.now(ZoneOffset.UTC);
  }

  private List<AttachmentMetadata> extractAttachments(GmailPayload rootPayload) {
    if (rootPayload == null) {
      return List.of();
    }

    List<AttachmentMetadata> attachments = new ArrayList<>();
    collectAttachments(rootPayload, attachments);

    if (attachments.isEmpty()) {
      return List.of();
    }

    LinkedHashSet<AttachmentMetadata> deduped = new LinkedHashSet<>(attachments);
    return List.copyOf(deduped);
  }

  private void collectAttachments(GmailPayload payload, List<AttachmentMetadata> attachments) {
    if (payload == null) {
      return;
    }

    GmailBody body = payload.body();
    boolean hasAttachmentId = body != null && StringUtils.hasText(body.attachmentId());
    boolean hasFilename = StringUtils.hasText(payload.filename());

    if (hasAttachmentId || hasFilename) {
      String filename = hasFilename ? payload.filename().trim() : "(unnamed)";
      long sizeBytes = body != null && body.size() != null ? Math.max(body.size(), 0L) : 0L;
      attachments.add(
        new AttachmentMetadata(
          filename,
          nullable(payload.mimeType()),
          sizeBytes,
          hasAttachmentId ? body.attachmentId().trim() : null
        )
      );
    }

    List<GmailPayload> parts = payload.parts();
    if (parts == null || parts.isEmpty()) {
      return;
    }

    for (GmailPayload part : parts) {
      collectAttachments(part, attachments);
    }
  }

  private AccountRow loadAccount(UUID accountId) {
    return jdbcTemplate.query(
      """
      SELECT id, email, provider, status, gmail_history_id
      FROM accounts
      WHERE id = ?
      """,
      (resultSet, rowNum) ->
        new AccountRow(
          resultSet.getObject("id", UUID.class),
          resultSet.getString("email"),
          resultSet.getString("provider"),
          resultSet.getString("status"),
          resultSet.getString("gmail_history_id")
        ),
      accountId
    ).stream().findFirst().orElseThrow(() -> new ApiBadRequestException("Account not found"));
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

  private String requireText(String value, String message) {
    if (!StringUtils.hasText(value)) {
      throw new IllegalStateException(message);
    }
    return value.trim();
  }

  private String normalize(String value) {
    if (!StringUtils.hasText(value)) {
      return "";
    }
    return value.trim().toLowerCase(Locale.ROOT);
  }

  private String nullable(String value) {
    if (!StringUtils.hasText(value)) {
      return null;
    }
    String trimmed = value.trim();
    return trimmed.isEmpty() ? null : trimmed;
  }

  public record SyncResult(UUID accountId, String email, int upsertedMessages, int deletedMessages) {}

  private record SyncCounters(int upserted, int deleted) {}

  private record AccountRow(
    UUID id,
    String email,
    String provider,
    String status,
    String gmailHistoryId
  ) {}

  private record HistoryChanges(List<String> changedMessageIds, Set<String> deletedMessageIds) {}

  private record GmailMetadata(
    String providerMessageId,
    String providerThreadId,
    String senderName,
    String senderEmail,
    String senderDomain,
    String subject,
    String snippet,
    String messageRfc822Id,
    OffsetDateTime receivedAt,
    boolean isRead,
    boolean hasAttachments,
    List<AttachmentMetadata> attachments
  ) {}

  private record AttachmentMetadata(
    String filename,
    String mimeType,
    long sizeBytes,
    String providerAttachmentId
  ) {}

  private record FetchedMessage(
    String providerMessageId,
    boolean notFound,
    GmailMessageResponse message
  ) {}

  private record Sender(String name, String email, String domain) {}
}
