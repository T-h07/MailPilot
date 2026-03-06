package com.mailpilot.service.sync;

import jakarta.annotation.PreDestroy;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class GmailSyncCoordinator {

  private static final Logger LOGGER = LoggerFactory.getLogger(GmailSyncCoordinator.class);

  private final JdbcTemplate jdbcTemplate;
  private final GmailSyncService gmailSyncService;
  private final ExecutorService syncExecutor = Executors.newFixedThreadPool(2);
  private final Map<UUID, RuntimeSyncState> runtimeStates = new ConcurrentHashMap<>();

  public GmailSyncCoordinator(JdbcTemplate jdbcTemplate, GmailSyncService gmailSyncService) {
    this.jdbcTemplate = jdbcTemplate;
    this.gmailSyncService = gmailSyncService;
  }

  @PreDestroy
  public void shutdown() {
    syncExecutor.shutdownNow();
  }

  public int normalizeMaxMessages(Integer rawMaxMessages) {
    return gmailSyncService.normalizeMaxMessages(rawMaxMessages);
  }

  public void triggerAccountSync(UUID accountId, int maxMessages) {
    RuntimeSyncState state =
        runtimeStates.computeIfAbsent(accountId, (ignored) -> new RuntimeSyncState());
    if (!state.tryMarkRunning()) {
      return;
    }

    syncExecutor.submit(() -> runAccountSync(accountId, maxMessages, state));
  }

  public int triggerAllConnectedAccounts(int maxMessages) {
    List<UUID> accountIds =
        jdbcTemplate.query(
            """
      SELECT a.id
      FROM accounts a
      JOIN oauth_tokens ot ON ot.account_id = a.id
      WHERE a.provider = 'GMAIL'
      ORDER BY a.email
      """,
            (resultSet, rowNum) -> resultSet.getObject("id", UUID.class));

    for (UUID accountId : accountIds) {
      triggerAccountSync(accountId, maxMessages);
    }

    return accountIds.size();
  }

  public List<SyncStatusView> listStatus() {
    List<AccountStatusRow> accountRows =
        jdbcTemplate.query(
            """
      SELECT a.id, a.email, a.last_sync_at
      FROM accounts a
      JOIN oauth_tokens ot ON ot.account_id = a.id
      WHERE a.provider = 'GMAIL'
      ORDER BY a.email
      """,
            (resultSet, rowNum) ->
                new AccountStatusRow(
                    resultSet.getObject("id", UUID.class),
                    resultSet.getString("email"),
                    resultSet.getObject("last_sync_at", OffsetDateTime.class)));

    return accountRows.stream()
        .map(
            (row) -> {
              RuntimeSyncState runtimeState = runtimeStates.get(row.accountId());
              if (runtimeState == null) {
                return new SyncStatusView(
                    row.accountId(), row.email(), "IDLE", row.lastSyncAt(), null, null);
              }

              OffsetDateTime effectiveLastSyncAt =
                  runtimeState.lastSyncAt() != null ? runtimeState.lastSyncAt() : row.lastSyncAt();

              return new SyncStatusView(
                  row.accountId(),
                  row.email(),
                  runtimeState.status(),
                  effectiveLastSyncAt,
                  runtimeState.lastError(),
                  runtimeState.lastRunStartedAt());
            })
        .toList();
  }

  private void runAccountSync(UUID accountId, int maxMessages, RuntimeSyncState state) {
    try {
      GmailSyncService.SyncResult result = gmailSyncService.syncAccount(accountId, maxMessages);
      state.markIdle(OffsetDateTime.now(ZoneOffset.UTC));
      LOGGER.info(
          "Gmail sync finished for account {} ({}). upserted={}, deleted={}",
          result.accountId(),
          result.email(),
          result.upsertedMessages(),
          result.deletedMessages());
    } catch (Exception exception) {
      String error =
          StringUtils.hasText(exception.getMessage())
              ? exception.getMessage()
              : "Gmail sync failed";
      state.markError(error);
      LOGGER.error("Gmail sync failed for account {}: {}", accountId, error);
    }
  }

  public record SyncStatusView(
      UUID accountId,
      String email,
      String status,
      OffsetDateTime lastSyncAt,
      String lastError,
      OffsetDateTime lastRunStartedAt) {}

  private record AccountStatusRow(UUID accountId, String email, OffsetDateTime lastSyncAt) {}

  private static final class RuntimeSyncState {

    private volatile String status = "IDLE";
    private volatile OffsetDateTime lastRunStartedAt;
    private volatile OffsetDateTime lastSyncAt;
    private volatile String lastError;

    synchronized boolean tryMarkRunning() {
      if ("RUNNING".equals(status)) {
        return false;
      }
      status = "RUNNING";
      lastRunStartedAt = OffsetDateTime.now(ZoneOffset.UTC);
      lastError = null;
      return true;
    }

    synchronized void markIdle(OffsetDateTime syncedAt) {
      status = "IDLE";
      lastSyncAt = syncedAt;
      lastError = null;
    }

    synchronized void markError(String error) {
      status = "ERROR";
      lastError = error;
    }

    String status() {
      return status;
    }

    OffsetDateTime lastRunStartedAt() {
      return lastRunStartedAt;
    }

    OffsetDateTime lastSyncAt() {
      return lastSyncAt;
    }

    String lastError() {
      return lastError;
    }
  }
}
