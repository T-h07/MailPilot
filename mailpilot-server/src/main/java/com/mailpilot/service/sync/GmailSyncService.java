package com.mailpilot.service.sync;

import com.mailpilot.api.error.ApiBadRequestException;
import com.mailpilot.service.AttachmentMetadataService;
import com.mailpilot.service.BadgeService;
import com.mailpilot.service.events.AppEventBus;
import com.mailpilot.service.gmail.GmailApiExecutor;
import com.mailpilot.service.gmail.GmailClient;
import com.mailpilot.service.gmail.GmailClient.GmailHistoryExpiredException;
import com.mailpilot.service.gmail.GmailClient.GmailMessageNotFoundException;
import com.mailpilot.service.gmail.GmailClient.GmailMessageResponse;
import com.mailpilot.service.gmail.GmailClient.GmailProfileResponse;
import com.mailpilot.service.gmail.GmailClient.HistoryListResponse;
import com.mailpilot.service.gmail.GmailClient.HistoryMessageContainer;
import com.mailpilot.service.gmail.GmailClient.HistoryRecord;
import com.mailpilot.service.gmail.GmailClient.MessageListResponse;
import com.mailpilot.service.gmail.GmailClient.MessageRef;
import com.mailpilot.service.logging.LogSanitizer;
import com.mailpilot.service.oauth.GmailScopeService;
import jakarta.annotation.PreDestroy;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
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
  private static final int MESSAGE_FETCH_CONCURRENCY = 4;
  private static final long MESSAGE_FETCH_TIMEOUT_SECONDS = 45L;

  private static final Logger LOGGER = LoggerFactory.getLogger(GmailSyncService.class);

  private final JdbcTemplate jdbcTemplate;
  private final GmailClient gmailClient;
  private final GmailMessageMapper gmailMessageMapper;
  private final GmailApiExecutor gmailApiExecutor;
  private final GmailScopeService gmailScopeService;
  private final AttachmentMetadataService attachmentMetadataService;
  private final BadgeService badgeService;
  private final AppEventBus appEventBus;
  private final ExecutorService messageFetchExecutor =
      Executors.newFixedThreadPool(MESSAGE_FETCH_CONCURRENCY);

  public GmailSyncService(
      JdbcTemplate jdbcTemplate,
      GmailClient gmailClient,
      GmailMessageMapper gmailMessageMapper,
      GmailApiExecutor gmailApiExecutor,
      GmailScopeService gmailScopeService,
      AttachmentMetadataService attachmentMetadataService,
      BadgeService badgeService,
      AppEventBus appEventBus) {
    this.jdbcTemplate = jdbcTemplate;
    this.gmailClient = gmailClient;
    this.gmailMessageMapper = gmailMessageMapper;
    this.gmailApiExecutor = gmailApiExecutor;
    this.gmailScopeService = gmailScopeService;
    this.attachmentMetadataService = attachmentMetadataService;
    this.badgeService = badgeService;
    this.appEventBus = appEventBus;
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
    if (!gmailScopeService.hasReadScope(account.scope())) {
      throw new ApiBadRequestException(
          "Account is missing Gmail read scope. Reconnect Gmail and grant read access.");
    }

    appEventBus.publishSyncStatus(accountId, account.email(), "RUNNING", 0, null, "Sync started");
    List<BadgeService.ViewMatcher> viewMatchers = badgeService.loadViewMatchers();

    try {
      GmailProfileResponse profile =
          gmailApiExecutor.execute(accountId, (accessToken) -> gmailClient.getProfile(accessToken));

      String profileEmail = normalize(profile.emailAddress());
      if (!StringUtils.hasText(profileEmail)) {
        throw new IllegalStateException("Gmail profile response missing email address");
      }
      if (!profileEmail.equalsIgnoreCase(account.email())) {
        throw new IllegalStateException(
            "Connected Gmail profile email does not match account email");
      }
      if (!StringUtils.hasText(profile.historyId())) {
        throw new IllegalStateException("Gmail profile response missing historyId");
      }

      SyncCounters counters;
      boolean usedBootstrapFallback = false;

      if (!StringUtils.hasText(account.gmailHistoryId())) {
        counters = runBootstrapSync(accountId, account.email(), maxMessages, viewMatchers);
      } else {
        try {
          counters =
              runIncrementalSync(
                  accountId, account.email(), account.gmailHistoryId(), maxMessages, viewMatchers);
        } catch (GmailHistoryExpiredException exception) {
          LOGGER.info(
              "Gmail history cursor expired for account {} ({}). Running bounded bootstrap sync.",
              accountId,
              account.email());
          counters = runBootstrapSync(accountId, account.email(), maxMessages, viewMatchers);
          usedBootstrapFallback = true;
        }
      }

      GmailProfileResponse latestProfile =
          gmailApiExecutor.execute(accountId, (accessToken) -> gmailClient.getProfile(accessToken));
      String latestHistoryId =
          StringUtils.hasText(latestProfile.historyId())
              ? latestProfile.historyId()
              : profile.historyId();

      jdbcTemplate.update(
          """
        UPDATE accounts
        SET gmail_history_id = ?, last_sync_at = now(), updated_at = now()
        WHERE id = ?
        """,
          latestHistoryId,
          accountId);

      appEventBus.publishSyncStatus(
          accountId,
          account.email(),
          "IDLE",
          counters.processed(),
          counters.total(),
          "Sync completed");
      appEventBus.publishBadgeUpdate(badgeService.computeBadgeSummary());

      LOGGER.info(
          "Gmail sync completed for {} ({}). upserted={}, deleted={}, bootstrapFallback={}",
          account.email(),
          accountId,
          counters.upserted(),
          counters.deleted(),
          usedBootstrapFallback);

      return new SyncResult(accountId, account.email(), counters.upserted(), counters.deleted());
    } catch (Exception exception) {
      String errorMessage =
          StringUtils.hasText(exception.getMessage())
              ? exception.getMessage()
              : "Gmail sync failed";
      appEventBus.publishSyncStatus(accountId, account.email(), "ERROR", null, null, errorMessage);
      throw exception;
    }
  }

  private SyncCounters runBootstrapSync(
      UUID accountId,
      String accountEmail,
      int maxMessages,
      List<BadgeService.ViewMatcher> viewMatchers) {
    List<String> messageIds = collectBootstrapMessageIds(accountId, maxMessages);
    int total = messageIds.size();
    appEventBus.publishSyncStatus(accountId, accountEmail, "RUNNING", 0, total, "Bootstrapping");
    return processMessageIds(accountId, accountEmail, messageIds, Set.of(), total, viewMatchers);
  }

  private SyncCounters runIncrementalSync(
      UUID accountId,
      String accountEmail,
      String startHistoryId,
      int maxMessages,
      List<BadgeService.ViewMatcher> viewMatchers) {
    HistoryChanges changes = collectHistoryChanges(accountId, startHistoryId);

    int deleted = deleteMessagesByProviderIds(accountId, changes.deletedMessageIds());

    List<String> toFetch =
        changes.changedMessageIds().stream()
            .filter((messageId) -> !changes.deletedMessageIds().contains(messageId))
            .limit(maxMessages)
            .toList();

    int total = toFetch.size();
    appEventBus.publishSyncStatus(
        accountId, accountEmail, "RUNNING", 0, total, "Running incremental sync");
    SyncCounters processed =
        processMessageIds(
            accountId, accountEmail, toFetch, changes.deletedMessageIds(), total, viewMatchers);
    return new SyncCounters(
        processed.upserted(), processed.deleted() + deleted, processed.processed(), total);
  }

  private List<String> collectBootstrapMessageIds(UUID accountId, int maxMessages) {
    LinkedHashSet<String> messageIds = new LinkedHashSet<>();
    String pageToken = null;

    while (messageIds.size() < maxMessages) {
      int batchSize = Math.min(GMAIL_LIST_PAGE_SIZE, maxMessages - messageIds.size());
      String currentPageToken = pageToken;
      MessageListResponse response =
          gmailApiExecutor.execute(
              accountId,
              (accessToken) ->
                  gmailClient.listMessages(accessToken, batchSize, currentPageToken, null));

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
      HistoryListResponse response =
          gmailApiExecutor.execute(
              accountId,
              (accessToken) ->
                  gmailClient.historyList(accessToken, startHistoryId, currentPageToken));

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
      String accountEmail,
      List<String> messageIds,
      Set<String> alreadyDeletedMessageIds,
      int total,
      List<BadgeService.ViewMatcher> viewMatchers) {
    if (messageIds.isEmpty()) {
      appEventBus.publishSyncStatus(
          accountId, accountEmail, "RUNNING", 0, total, "No messages to process");
      return new SyncCounters(0, 0, 0, total);
    }

    int upserted = 0;
    int deleted = 0;
    int processed = 0;
    Map<String, UUID> threadCache = new HashMap<>();

    for (int start = 0; start < messageIds.size(); start += MESSAGE_FETCH_CONCURRENCY) {
      int end = Math.min(start + MESSAGE_FETCH_CONCURRENCY, messageIds.size());
      List<String> batch = messageIds.subList(start, end);
      List<CompletableFuture<FetchedMessage>> futures =
          batch.stream()
              .map(
                  (messageId) ->
                      CompletableFuture.supplyAsync(
                          () -> fetchMessage(accountId, messageId), messageFetchExecutor))
              .toList();

      for (CompletableFuture<FetchedMessage> future : futures) {
        FetchedMessage fetchedMessage = waitForFetchedMessage(future);

        if (fetchedMessage.notFound()) {
          if (!alreadyDeletedMessageIds.contains(fetchedMessage.providerMessageId())) {
            deleted += deleteMessageByProviderId(accountId, fetchedMessage.providerMessageId());
          }
          processed += 1;
          appEventBus.publishSyncStatus(
              accountId,
              accountEmail,
              "RUNNING",
              processed,
              total,
              "Syncing " + processed + "/" + total);
          continue;
        }

        if (fetchedMessage.message() == null) {
          processed += 1;
          appEventBus.publishSyncStatus(
              accountId,
              accountEmail,
              "RUNNING",
              processed,
              total,
              "Syncing " + processed + "/" + total);
          continue;
        }

        GmailMessageMapper.GmailMetadata metadata =
            gmailMessageMapper.mapCoreFields(fetchedMessage.message());
        UpsertMessageResult upsertResult = upsertMessageMetadata(accountId, metadata, threadCache);
        upserted += 1;
        if (upsertResult.inserted()) {
          List<UUID> matchedViews =
              badgeService.findMatchingViewIds(
                  new BadgeService.MessageCandidate(
                      accountId,
                      metadata.senderEmail(),
                      metadata.senderDomain(),
                      metadata.subject(),
                      metadata.snippet(),
                      metadata.isRead()),
                  viewMatchers);
          appEventBus.publishNewMail(
              accountId,
              accountEmail,
              upsertResult.messageId(),
              metadata.senderEmail(),
              metadata.senderName(),
              StringUtils.hasText(metadata.subject()) ? metadata.subject() : "(no subject)",
              metadata.receivedAt(),
              matchedViews);
        }

        processed += 1;
        appEventBus.publishSyncStatus(
            accountId,
            accountEmail,
            "RUNNING",
            processed,
            total,
            "Syncing " + processed + "/" + total);
      }
    }

    return new SyncCounters(upserted, deleted, processed, total);
  }

  private FetchedMessage waitForFetchedMessage(CompletableFuture<FetchedMessage> future) {
    try {
      return future.get(MESSAGE_FETCH_TIMEOUT_SECONDS, TimeUnit.SECONDS);
    } catch (TimeoutException timeoutException) {
      future.cancel(true);
      throw new IllegalStateException(
          "Timed out while fetching Gmail message metadata during sync.");
    } catch (InterruptedException interruptedException) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException("Interrupted while fetching Gmail message metadata.");
    } catch (ExecutionException executionException) {
      Throwable cause = executionException.getCause();
      if (cause instanceof RuntimeException runtimeException) {
        throw runtimeException;
      }
      throw new IllegalStateException("Gmail message fetch failed during sync.", cause);
    }
  }

  private FetchedMessage fetchMessage(UUID accountId, String messageId) {
    try {
      GmailMessageResponse response =
          gmailApiExecutor.execute(
              accountId, (accessToken) -> gmailClient.getMessageFull(accessToken, messageId));
      return new FetchedMessage(messageId, false, response);
    } catch (GmailMessageNotFoundException exception) {
      return new FetchedMessage(messageId, true, null);
    }
  }

  private UpsertMessageResult upsertMessageMetadata(
      UUID accountId, GmailMessageMapper.GmailMetadata metadata, Map<String, UUID> threadCache) {
    UUID threadId =
        threadCache.computeIfAbsent(
            metadata.providerThreadId(),
            (providerThreadId) ->
                upsertThread(
                    accountId, providerThreadId, metadata.subject(), metadata.receivedAt()));

    UpsertMessageResult upsertMessageResult =
        jdbcTemplate.queryForObject(
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
        gmail_internal_date_ms,
        gmail_label_ids,
        is_read,
        is_inbox,
        is_sent,
        is_draft,
        has_attachments
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::text[], ?, ?, ?, ?, ?)
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
        gmail_internal_date_ms = EXCLUDED.gmail_internal_date_ms,
        gmail_label_ids = EXCLUDED.gmail_label_ids,
        is_read = EXCLUDED.is_read,
        is_inbox = EXCLUDED.is_inbox,
        is_sent = EXCLUDED.is_sent,
        is_draft = EXCLUDED.is_draft,
        has_attachments = EXCLUDED.has_attachments
      RETURNING id, (xmax = 0) AS inserted
      """,
            (resultSet, rowNum) ->
                new UpsertMessageResult(
                    resultSet.getObject("id", UUID.class), resultSet.getBoolean("inserted")),
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
            metadata.gmailInternalDateMs(),
            metadata.gmailLabelIds().toArray(new String[0]),
            metadata.isRead(),
            metadata.isInbox(),
            metadata.isSent(),
            metadata.isDraft(),
            metadata.hasAttachments());

    if (upsertMessageResult == null || upsertMessageResult.messageId() == null) {
      throw new IllegalStateException("Failed to upsert message metadata");
    }

    attachmentMetadataService.syncAttachments(
        upsertMessageResult.messageId(), metadata.attachments());
    return upsertMessageResult;
  }

  private UUID upsertThread(
      UUID accountId, String providerThreadId, String subject, OffsetDateTime receivedAt) {
    UUID threadId =
        jdbcTemplate.queryForObject(
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
            receivedAt);

    if (threadId == null) {
      throw new IllegalStateException("Failed to upsert thread");
    }

    return threadId;
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
        providerMessageId);
  }

  public RepairResult repairMessageMetadata(int days) {
    int normalizedDays = normalizeRepairDays(days);
    List<AccountRow> gmailAccounts = loadAllGmailAccounts();
    int updated = 0;
    int skipped = 0;

    for (AccountRow account : gmailAccounts) {
      if (!"CONNECTED".equalsIgnoreCase(account.status())) {
        continue;
      }

      List<String> providerMessageIds = loadRepairCandidateMessageIds(account.id(), normalizedDays);
      Map<String, UUID> threadCache = new HashMap<>();

      for (String providerMessageId : providerMessageIds) {
        if (!StringUtils.hasText(providerMessageId)) {
          skipped += 1;
          continue;
        }

        try {
          GmailMessageResponse message =
              gmailApiExecutor.execute(
                  account.id(),
                  (accessToken) -> gmailClient.getMessageFull(accessToken, providerMessageId));
          GmailMessageMapper.GmailMetadata metadata = gmailMessageMapper.mapCoreFields(message);
          upsertMessageMetadata(account.id(), metadata, threadCache);
          updated += 1;
        } catch (GmailMessageNotFoundException notFoundException) {
          skipped += 1;
        } catch (Exception exception) {
          skipped += 1;
          LOGGER.warn(
              "Repair skipped message {} for account {}: {}",
              providerMessageId,
              account.email(),
              LogSanitizer.sanitize(exception.getMessage()));
        }
      }
    }

    return new RepairResult("ok", updated, skipped);
  }

  private int normalizeRepairDays(int days) {
    if (days < 1 || days > 365) {
      throw new ApiBadRequestException("days must be between 1 and 365");
    }
    return days;
  }

  private AccountRow loadAccount(UUID accountId) {
    return jdbcTemplate
        .query(
            """
      SELECT a.id, a.email, a.provider, a.status, a.gmail_history_id, ot.scope
      FROM accounts a
      LEFT JOIN oauth_tokens ot ON ot.account_id = a.id
      WHERE a.id = ?
      """,
            (resultSet, rowNum) ->
                new AccountRow(
                    resultSet.getObject("id", UUID.class),
                    resultSet.getString("email"),
                    resultSet.getString("provider"),
                    resultSet.getString("status"),
                    resultSet.getString("gmail_history_id"),
                    resultSet.getString("scope")),
            accountId)
        .stream()
        .findFirst()
        .orElseThrow(() -> new ApiBadRequestException("Account not found"));
  }

  private List<AccountRow> loadAllGmailAccounts() {
    return jdbcTemplate.query(
        """
      SELECT a.id, a.email, a.provider, a.status, a.gmail_history_id, ot.scope
      FROM accounts a
      LEFT JOIN oauth_tokens ot ON ot.account_id = a.id
      WHERE a.provider = 'GMAIL'
      ORDER BY a.email
      """,
        (resultSet, rowNum) ->
            new AccountRow(
                resultSet.getObject("id", UUID.class),
                resultSet.getString("email"),
                resultSet.getString("provider"),
                resultSet.getString("status"),
                resultSet.getString("gmail_history_id"),
                resultSet.getString("scope")));
  }

  private List<String> loadRepairCandidateMessageIds(UUID accountId, int days) {
    return jdbcTemplate.query(
        """
      SELECT provider_message_id
      FROM messages
      WHERE account_id = ?
        AND created_at >= now() - (?::int * interval '1 day')
      ORDER BY created_at DESC, id DESC
      """,
        (resultSet, rowNum) -> resultSet.getString("provider_message_id"),
        accountId,
        days);
  }

  private String normalize(String value) {
    if (!StringUtils.hasText(value)) {
      return "";
    }
    return value.trim().toLowerCase(Locale.ROOT);
  }

  public record SyncResult(
      UUID accountId, String email, int upsertedMessages, int deletedMessages) {}

  private record SyncCounters(int upserted, int deleted, int processed, int total) {}

  private record AccountRow(
      UUID id, String email, String provider, String status, String gmailHistoryId, String scope) {}

  private record HistoryChanges(List<String> changedMessageIds, Set<String> deletedMessageIds) {}

  private record FetchedMessage(
      String providerMessageId, boolean notFound, GmailMessageResponse message) {}

  private record UpsertMessageResult(UUID messageId, boolean inserted) {}

  public record RepairResult(String status, int updated, int skipped) {}
}
