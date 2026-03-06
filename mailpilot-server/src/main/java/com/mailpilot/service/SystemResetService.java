package com.mailpilot.service;

import com.mailpilot.api.error.ApiBadRequestException;
import com.mailpilot.service.logging.LogSanitizer;
import java.io.IOException;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.FileSystemUtils;
import org.springframework.util.StringUtils;

@Service
public class SystemResetService {

  private static final Logger LOGGER = LoggerFactory.getLogger(SystemResetService.class);
  private static final String RESET_CONFIRM_TEXT = "RESET";

  private static final List<String> PURGE_TABLES =
      List.of(
          "oauth_tokens",
          "message_view_labels",
          "view_labels",
          "followups",
          "attachments",
          "message_tags",
          "tags",
          "messages",
          "threads",
          "view_rules",
          "view_accounts",
          "views",
          "sender_rules",
          "mailbox_seen",
          "drafts",
          "accounts");

  private final JdbcTemplate jdbcTemplate;
  private final LocalAuthService localAuthService;
  private final Path cacheRoot;
  private final boolean cacheRootConfigured;

  public SystemResetService(
      JdbcTemplate jdbcTemplate,
      LocalAuthService localAuthService,
      @Value("${mailpilot.cacheDir:}") String configuredCacheDir) {
    this.jdbcTemplate = jdbcTemplate;
    this.localAuthService = localAuthService;
    this.cacheRootConfigured = StringUtils.hasText(configuredCacheDir);
    this.cacheRoot = resolveCacheDirectory(configuredCacheDir);
  }

  @Transactional
  public void reset(String password, String confirmText) {
    validateConfirmation(confirmText);
    localAuthService.verifyPassword(password);

    truncateUserData();
    clearLocalAuth();
    resetAppState();
    resetUserProfile();
    clearCacheBestEffort();
  }

  private void validateConfirmation(String confirmText) {
    if (!RESET_CONFIRM_TEXT.equals(confirmText)) {
      throw new ApiBadRequestException("confirmText must equal RESET");
    }
  }

  private void truncateUserData() {
    Set<String> existingTables =
        new LinkedHashSet<>(
            jdbcTemplate.queryForList(
                """
                SELECT tablename
                FROM pg_catalog.pg_tables
                WHERE schemaname = current_schema()
                """,
                String.class));

    List<String> tablesToTruncate =
        PURGE_TABLES.stream().filter(existingTables::contains).collect(Collectors.toList());

    if (tablesToTruncate.isEmpty()) {
      return;
    }

    String truncateSql = "TRUNCATE TABLE " + String.join(", ", tablesToTruncate) + " CASCADE";
    jdbcTemplate.execute(truncateSql);
  }

  private void clearLocalAuth() {
    if (!tableExists("local_auth")) {
      return;
    }
    jdbcTemplate.update("DELETE FROM local_auth");
  }

  private void resetAppState() {
    if (!tableExists("app_state")) {
      return;
    }

    boolean hasOnboardingStep = columnExists("app_state", "onboarding_step");
    boolean hasOnboardingUpdatedAt = columnExists("app_state", "onboarding_updated_at");

    if (hasOnboardingStep && hasOnboardingUpdatedAt) {
      jdbcTemplate.update(
          """
          INSERT INTO app_state (id, onboarding_complete, locked, onboarding_step, onboarding_updated_at, created_at, updated_at)
          VALUES (1, false, false, 1, now(), now(), now())
          ON CONFLICT (id)
          DO UPDATE SET
            onboarding_complete = EXCLUDED.onboarding_complete,
            locked = EXCLUDED.locked,
            onboarding_step = EXCLUDED.onboarding_step,
            onboarding_updated_at = now(),
            updated_at = now()
          """);
      return;
    }

    jdbcTemplate.update(
        """
        INSERT INTO app_state (id, onboarding_complete, locked, created_at, updated_at)
        VALUES (1, false, false, now(), now())
        ON CONFLICT (id)
        DO UPDATE SET
          onboarding_complete = EXCLUDED.onboarding_complete,
          locked = EXCLUDED.locked,
          updated_at = now()
        """);
  }

  private void resetUserProfile() {
    if (!tableExists("user_profile")) {
      return;
    }
    jdbcTemplate.update(
        """
        INSERT INTO user_profile (id, first_name, last_name, field_of_work, created_at, updated_at)
        VALUES (1, NULL, NULL, NULL, now(), now())
        ON CONFLICT (id)
        DO UPDATE SET
          first_name = NULL,
          last_name = NULL,
          field_of_work = NULL,
          updated_at = now()
        """);
  }

  private void clearCacheBestEffort() {
    Path normalizedRoot = cacheRoot.toAbsolutePath().normalize();
    if (!Files.exists(normalizedRoot)) {
      return;
    }

    if (!isSafeCacheRoot(normalizedRoot)) {
      LOGGER.warn(
          "Skipping cache clear because resolved path is outside MailPilot cache root: {}",
          LogSanitizer.sanitizePath(normalizedRoot));
      return;
    }

    try (DirectoryStream<Path> children = Files.newDirectoryStream(normalizedRoot)) {
      for (Path child : children) {
        try {
          FileSystemUtils.deleteRecursively(child);
        } catch (IOException exception) {
          LOGGER.warn(
              "Failed to clear cache entry during reset: {}", LogSanitizer.sanitizePath(child));
        }
      }
    } catch (IOException exception) {
      LOGGER.warn(
          "Failed to enumerate cache directory during reset: {}",
          LogSanitizer.sanitizePath(normalizedRoot));
    }
  }

  private boolean tableExists(String tableName) {
    Integer count =
        jdbcTemplate.queryForObject(
            """
            SELECT COUNT(*)
            FROM information_schema.tables
            WHERE table_schema = current_schema()
              AND table_name = ?
            """,
            Integer.class,
            tableName);
    return count != null && count > 0;
  }

  private boolean columnExists(String tableName, String columnName) {
    Integer count =
        jdbcTemplate.queryForObject(
            """
            SELECT COUNT(*)
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = ?
              AND column_name = ?
            """,
            Integer.class,
            tableName,
            columnName);
    return count != null && count > 0;
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

  private boolean isSafeCacheRoot(Path normalizedRoot) {
    if (cacheRootConfigured) {
      return true;
    }
    String normalized = normalizedRoot.toString().replace('\\', '/').toLowerCase(Locale.ROOT);
    return normalized.endsWith("/mailpilot/cache");
  }
}
