package com.mailpilot.service.oauth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class OAuthStateStore {

  private static final Logger LOGGER = LoggerFactory.getLogger(OAuthStateStore.class);
  private static final Duration PENDING_TTL = Duration.ofMinutes(10);
  private static final Duration RETENTION_AFTER_EXPIRY = Duration.ofHours(24);
  private static final String EXPIRED_MESSAGE = "OAuth flow expired. Please try again.";

  private final SecureRandom secureRandom = new SecureRandom();
  private final JdbcTemplate jdbcTemplate;

  public OAuthStateStore(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public PkceState create() {
    return create("READONLY", null, null);
  }

  public PkceState create(String mode) {
    return create(mode, null, null);
  }

  public PkceState create(String mode, String context, String accountHint) {
    cleanup();

    String state = randomBase64Url(32);
    String codeVerifier = randomBase64Url(64);
    String codeChallenge = sha256Base64Url(codeVerifier);
    String resolvedMode = StringUtils.hasText(mode) ? mode.trim().toUpperCase() : "READONLY";
    String resolvedContext = StringUtils.hasText(context) ? context.trim().toUpperCase() : null;
    String resolvedHint = StringUtils.hasText(accountHint) ? accountHint.trim().toLowerCase() : null;

    jdbcTemplate.update(
        """
        INSERT INTO oauth_pending_flows (
          state,
          provider,
          mode,
          code_verifier,
          context,
          account_hint,
          expires_at,
          status
        )
        VALUES (?, 'GMAIL', ?, ?, ?, ?, ?, 'PENDING')
        """,
        state,
        resolvedMode,
        codeVerifier,
        resolvedContext,
        resolvedHint,
        Instant.now().plus(PENDING_TTL));

    LOGGER.info(
        "Created OAuth pending flow state={} provider=GMAIL mode={} context={}",
        state,
        resolvedMode,
        resolvedContext == null ? "N/A" : resolvedContext);

    return new PkceState(state, codeVerifier, codeChallenge);
  }

  public Optional<PkceVerification> consumeCodeVerifier(String state) {
    cleanup();
    if (!StringUtils.hasText(state)) {
      return Optional.empty();
    }

    Optional<PkceVerification> verification =
        jdbcTemplate
        .query(
            """
            UPDATE oauth_pending_flows
            SET consumed_at = now()
            WHERE state = ?
              AND status = 'PENDING'
              AND consumed_at IS NULL
              AND expires_at > now()
            RETURNING code_verifier, mode
            """,
            (resultSet, rowNum) ->
                new PkceVerification(resultSet.getString("code_verifier"), resultSet.getString("mode")),
            state.trim())
        .stream()
        .findFirst();

    if (verification.isPresent()) {
      LOGGER.info("Consumed OAuth pending flow state={}", state.trim());
    } else {
      LOGGER.warn("OAuth pending flow consume failed state={}", state.trim());
    }

    return verification;
  }

  public void markSuccess(String state, String message) {
    markSuccess(state, message, null, null);
  }

  public void markSuccess(String state, String message, UUID accountId, String email) {
    if (!StringUtils.hasText(state)) {
      return;
    }

    jdbcTemplate.update(
        """
        UPDATE oauth_pending_flows
        SET status = 'SUCCESS',
            message = ?,
            result_account_id = ?,
            result_email = ?,
            error = NULL,
            consumed_at = COALESCE(consumed_at, now())
        WHERE state = ?
        """,
        sanitizeMessage(message),
        accountId,
        normalizeEmail(email),
        state.trim());

    LOGGER.info("OAuth flow completed state={} accountId={} email={}", state.trim(), accountId, normalizeEmail(email));
  }

  public void markError(String state, String message) {
    if (!StringUtils.hasText(state)) {
      return;
    }

    String safeMessage = sanitizeMessage(message);
    jdbcTemplate.update(
        """
        UPDATE oauth_pending_flows
        SET status = 'ERROR',
            message = ?,
            error = ?,
            consumed_at = COALESCE(consumed_at, now())
        WHERE state = ?
        """,
        safeMessage,
        safeMessage,
        state.trim());

    LOGGER.warn("OAuth flow failed state={} message={}", state.trim(), safeMessage);
  }

  public OAuthFlowStatus status(String state) {
    cleanup();
    if (!StringUtils.hasText(state)) {
      return new OAuthFlowStatus("EXPIRED", EXPIRED_MESSAGE, null, null);
    }

    FlowRow row =
        jdbcTemplate
            .query(
                """
                SELECT
                  state,
                  status,
                  message,
                  result_account_id,
                  result_email,
                  consumed_at,
                  expires_at
                FROM oauth_pending_flows
                WHERE state = ?
                """,
                (resultSet, rowNum) ->
                    new FlowRow(
                        resultSet.getString("state"),
                        resultSet.getString("status"),
                        resultSet.getString("message"),
                        resultSet.getObject("result_account_id", UUID.class),
                        resultSet.getString("result_email"),
                        resultSet.getTimestamp("consumed_at") == null
                            ? null
                            : resultSet.getTimestamp("consumed_at").toInstant(),
                        resultSet.getTimestamp("expires_at").toInstant()),
                state.trim())
            .stream()
            .findFirst()
            .orElse(null);

    if (row == null) {
      LOGGER.warn("OAuth status requested for unknown state={}", state.trim());
      return new OAuthFlowStatus("EXPIRED", EXPIRED_MESSAGE, null, null);
    }

    if (row.expiresAt().isBefore(Instant.now()) && "PENDING".equalsIgnoreCase(row.status())) {
      jdbcTemplate.update(
          """
          UPDATE oauth_pending_flows
          SET status = 'EXPIRED',
              message = ?,
              error = ?,
              consumed_at = COALESCE(consumed_at, now())
          WHERE state = ?
            AND status = 'PENDING'
          """,
          EXPIRED_MESSAGE,
          EXPIRED_MESSAGE,
          row.state());
      LOGGER.warn("OAuth flow expired state={}", row.state());
      return new OAuthFlowStatus("EXPIRED", EXPIRED_MESSAGE, null, null);
    }

    String normalizedStatus =
        StringUtils.hasText(row.status()) ? row.status().trim().toUpperCase() : "PENDING";
    if (!"PENDING".equals(normalizedStatus)
        && !"SUCCESS".equals(normalizedStatus)
        && !"ERROR".equals(normalizedStatus)
        && !"EXPIRED".equals(normalizedStatus)) {
      normalizedStatus = "ERROR";
    }

    String message = sanitizeMessage(row.message());
    if (!StringUtils.hasText(message)) {
      if ("SUCCESS".equals(normalizedStatus)) {
        message = "Google account connected.";
      } else if ("PENDING".equals(normalizedStatus) && row.consumedAt() != null) {
        message = "Finishing OAuth callback...";
      } else if ("PENDING".equals(normalizedStatus)) {
        message = "Awaiting OAuth callback";
      } else if ("EXPIRED".equals(normalizedStatus)) {
        message = EXPIRED_MESSAGE;
      } else {
        message = "OAuth flow failed.";
      }
    }

    return new OAuthFlowStatus(normalizedStatus, message, row.resultAccountId(), row.resultEmail());
  }

  private void cleanup() {
    int expiredMarked =
        jdbcTemplate.update(
        """
        UPDATE oauth_pending_flows
        SET status = 'EXPIRED',
            message = ?,
            error = ?,
            consumed_at = COALESCE(consumed_at, now())
        WHERE status = 'PENDING'
          AND expires_at < now()
        """,
        EXPIRED_MESSAGE,
        EXPIRED_MESSAGE);

    Instant purgeBefore = Instant.now().minus(RETENTION_AFTER_EXPIRY);
    int deletedRows =
        jdbcTemplate.update(
        "DELETE FROM oauth_pending_flows WHERE expires_at < ?",
        purgeBefore);

    if (expiredMarked > 0 || deletedRows > 0) {
      LOGGER.info(
          "OAuth flow cleanup markedExpired={} deleted={} cutoff={}",
          expiredMarked,
          deletedRows,
          purgeBefore);
    }
  }

  private String sanitizeMessage(String value) {
    if (!StringUtils.hasText(value)) {
      return null;
    }
    String trimmed = value.trim();
    return trimmed.length() > 400 ? trimmed.substring(0, 400) : trimmed;
  }

  private String normalizeEmail(String email) {
    if (!StringUtils.hasText(email)) {
      return null;
    }
    return email.trim().toLowerCase();
  }

  private String randomBase64Url(int byteLength) {
    byte[] bytes = new byte[byteLength];
    secureRandom.nextBytes(bytes);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
  }

  private String sha256Base64Url(String value) {
    try {
      MessageDigest messageDigest = MessageDigest.getInstance("SHA-256");
      byte[] hash = messageDigest.digest(value.getBytes(StandardCharsets.UTF_8));
      return Base64.getUrlEncoder().withoutPadding().encodeToString(hash);
    } catch (NoSuchAlgorithmException exception) {
      throw new IllegalStateException("SHA-256 is not available", exception);
    }
  }

  private record FlowRow(
      String state,
      String status,
      String message,
      UUID resultAccountId,
      String resultEmail,
      Instant consumedAt,
      Instant expiresAt) {}

  public record PkceState(String state, String codeVerifier, String codeChallenge) {}

  public record PkceVerification(String codeVerifier, String mode) {}

  public record OAuthFlowStatus(String status, String message, UUID accountId, String email) {}
}
