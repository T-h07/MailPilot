package com.mailpilot.service;

import com.mailpilot.api.error.ApiBadRequestException;
import com.mailpilot.api.error.ApiConflictException;
import com.mailpilot.api.errors.RateLimitException;
import com.mailpilot.api.errors.UnauthorizedException;
import com.mailpilot.repository.AppStateRepository;
import com.mailpilot.service.MailSendService.MailSendCommand;
import java.security.SecureRandom;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class LocalPasswordRecoveryService {

  private static final String GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
  private static final String CONTEXT = "LOCAL_APP_PASSWORD";
  private static final int CODE_LENGTH = 6;
  private static final int CODE_TTL_MINUTES = 10;
  private static final int MAX_ATTEMPTS = 5;
  private static final int RESEND_COOLDOWN_SECONDS = 60;
  private static final int MAX_REQUESTS_PER_WINDOW = 3;
  private static final int REQUEST_WINDOW_MINUTES = 30;
  private static final String STATUS_ACTIVE = "ACTIVE";
  private static final String STATUS_EXPIRED = "EXPIRED";
  private static final String STATUS_CONSUMED = "CONSUMED";
  private static final String STATUS_CANCELLED = "CANCELLED";

  private final JdbcTemplate jdbcTemplate;
  private final MailSendService mailSendService;
  private final LocalAuthService localAuthService;
  private final AppStateRepository appStateRepository;
  private final PasswordEncoder codeHashEncoder = new BCryptPasswordEncoder();
  private final SecureRandom secureRandom = new SecureRandom();

  public LocalPasswordRecoveryService(
      JdbcTemplate jdbcTemplate,
      MailSendService mailSendService,
      LocalAuthService localAuthService,
      AppStateRepository appStateRepository) {
    this.jdbcTemplate = jdbcTemplate;
    this.mailSendService = mailSendService;
    this.localAuthService = localAuthService;
    this.appStateRepository = appStateRepository;
  }

  public RecoveryAvailability getRecoveryAvailability() {
    PrimaryAccount account = loadPrimaryAccount();
    if (account == null) {
      return new RecoveryAvailability(false, null, null, "NO_PRIMARY");
    }

    if (!canSend(account.scope())) {
      return new RecoveryAvailability(
          false,
          maskEmail(account.email()),
          normalizeNullable(account.email()),
          "PRIMARY_REAUTH_REQUIRED");
    }

    return new RecoveryAvailability(
        true, maskEmail(account.email()), normalizeNullable(account.email()), null);
  }

  public int requestRecoveryCode(String requestIp) {
    PrimaryAccount account = requireRecoverablePrimaryAccount();
    OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);

    enforceRequestLimits(account.email(), now);
    cancelActiveCodes(account.email());

    String rawCode = generateCode();
    String codeHash = codeHashEncoder.encode(rawCode);
    UUID recoveryId = UUID.randomUUID();
    jdbcTemplate.update(
        """
        INSERT INTO local_auth_recovery_codes (
          id,
          target_email,
          code_hash,
          created_at,
          expires_at,
          consumed_at,
          attempt_count,
          last_attempt_at,
          request_ip,
          context,
          status
        )
        VALUES (?, ?, ?, ?, ?, NULL, 0, NULL, ?, ?, ?)
        """,
        recoveryId,
        account.email(),
        codeHash,
        now,
        now.plusMinutes(CODE_TTL_MINUTES),
        normalizeNullable(requestIp),
        CONTEXT,
        STATUS_ACTIVE);

    try {
      sendRecoveryCodeEmail(account, rawCode);
    } catch (RuntimeException exception) {
      jdbcTemplate.update(
          """
          UPDATE local_auth_recovery_codes
          SET status = ?, consumed_at = now()
          WHERE id = ?
          """,
          STATUS_CANCELLED,
          recoveryId);
      throw new ApiConflictException("MailPilot can't send a recovery code right now.");
    }

    return RESEND_COOLDOWN_SECONDS;
  }

  public void verifyAndResetPassword(String code, String newPassword, String confirmNewPassword) {
    String normalizedCode = normalizeCode(code);
    validatePasswordResetInput(newPassword, confirmNewPassword);

    PrimaryAccount account = loadPrimaryAccount();
    if (account == null || !StringUtils.hasText(account.email())) {
      throw new ApiConflictException("Recovery requires a primary account.");
    }

    RecoveryCodeRow activeCode = loadLatestActiveCode(account.email());
    if (activeCode == null) {
      throw new ApiBadRequestException("No active recovery code. Request a new code.");
    }

    OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
    if (activeCode.expiresAt().isBefore(now)) {
      expireCode(activeCode.id());
      throw new ApiBadRequestException("Recovery code expired. Request a new code.");
    }

    int nextAttempt = activeCode.attemptCount() + 1;
    if (!codeHashEncoder.matches(normalizedCode, activeCode.codeHash())) {
      recordFailedAttempt(activeCode.id(), nextAttempt);
      if (nextAttempt >= MAX_ATTEMPTS) {
        throw new UnauthorizedException("Recovery code invalid. Request a new code.");
      }
      throw new UnauthorizedException("Invalid recovery code.");
    }

    localAuthService.setPassword(newPassword, true);
    consumeCode(activeCode.id());
    cancelOtherActiveCodes(account.email(), activeCode.id());
    appStateRepository.setLocked(true);
  }

  private PrimaryAccount requireRecoverablePrimaryAccount() {
    PrimaryAccount account = loadPrimaryAccount();
    if (account == null) {
      throw new ApiConflictException("No primary account is available for recovery.");
    }
    if (!canSend(account.scope())) {
      throw new ApiConflictException(
          "Your primary Gmail account needs to be reconnected to enable sending.");
    }
    return account;
  }

  private PrimaryAccount loadPrimaryAccount() {
    return jdbcTemplate
        .query(
            """
            SELECT
              a.id,
              a.email,
              ot.scope
            FROM accounts a
            LEFT JOIN oauth_tokens ot ON ot.account_id = a.id
            WHERE a.role = 'PRIMARY'
            ORDER BY a.updated_at DESC NULLS LAST, a.created_at DESC
            LIMIT 1
            """,
            (resultSet, rowNum) ->
                new PrimaryAccount(
                    resultSet.getObject("id", UUID.class),
                    resultSet.getString("email"),
                    resultSet.getString("scope")))
        .stream()
        .findFirst()
        .orElse(null);
  }

  private RecoveryCodeRow loadLatestActiveCode(String targetEmail) {
    return jdbcTemplate
        .query(
            """
            SELECT id, target_email, code_hash, expires_at, attempt_count
            FROM local_auth_recovery_codes
            WHERE target_email = ?
              AND context = ?
              AND status = ?
              AND consumed_at IS NULL
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (resultSet, rowNum) ->
                new RecoveryCodeRow(
                    resultSet.getObject("id", UUID.class),
                    resultSet.getString("target_email"),
                    resultSet.getString("code_hash"),
                    resultSet.getObject("expires_at", OffsetDateTime.class),
                    resultSet.getInt("attempt_count")),
            targetEmail,
            CONTEXT,
            STATUS_ACTIVE)
        .stream()
        .findFirst()
        .orElse(null);
  }

  private void enforceRequestLimits(String targetEmail, OffsetDateTime now) {
    OffsetDateTime latestRequestAt =
        jdbcTemplate
            .query(
                """
                SELECT created_at
                FROM local_auth_recovery_codes
                WHERE target_email = ? AND context = ?
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (resultSet, rowNum) -> resultSet.getObject("created_at", OffsetDateTime.class),
                targetEmail,
                CONTEXT)
            .stream()
            .findFirst()
            .orElse(null);

    if (latestRequestAt != null
        && latestRequestAt.plusSeconds(RESEND_COOLDOWN_SECONDS).isAfter(now)) {
      long remaining =
          latestRequestAt.plusSeconds(RESEND_COOLDOWN_SECONDS).toEpochSecond()
              - now.toEpochSecond();
      throw new RateLimitException(
          "Please wait " + Math.max(1, remaining) + " seconds before requesting another code.");
    }

    Integer recentCount =
        jdbcTemplate.queryForObject(
            """
            SELECT COUNT(*)
            FROM local_auth_recovery_codes
            WHERE target_email = ?
              AND context = ?
              AND created_at >= ?
            """,
            Integer.class,
            targetEmail,
            CONTEXT,
            now.minusMinutes(REQUEST_WINDOW_MINUTES));

    if (recentCount != null && recentCount >= MAX_REQUESTS_PER_WINDOW) {
      throw new RateLimitException("Too many recovery requests. Try again later.");
    }
  }

  private void cancelActiveCodes(String targetEmail) {
    jdbcTemplate.update(
        """
        UPDATE local_auth_recovery_codes
        SET status = ?, consumed_at = COALESCE(consumed_at, now())
        WHERE target_email = ?
          AND context = ?
          AND status = ?
        """,
        STATUS_CANCELLED,
        targetEmail,
        CONTEXT,
        STATUS_ACTIVE);
  }

  private void cancelOtherActiveCodes(String targetEmail, UUID exceptCodeId) {
    jdbcTemplate.update(
        """
        UPDATE local_auth_recovery_codes
        SET status = ?, consumed_at = COALESCE(consumed_at, now())
        WHERE target_email = ?
          AND context = ?
          AND status = ?
          AND id <> ?
        """,
        STATUS_CANCELLED,
        targetEmail,
        CONTEXT,
        STATUS_ACTIVE,
        exceptCodeId);
  }

  private void consumeCode(UUID codeId) {
    jdbcTemplate.update(
        """
        UPDATE local_auth_recovery_codes
        SET status = ?, consumed_at = now()
        WHERE id = ?
        """,
        STATUS_CONSUMED,
        codeId);
  }

  private void expireCode(UUID codeId) {
    jdbcTemplate.update(
        """
        UPDATE local_auth_recovery_codes
        SET status = ?, consumed_at = now()
        WHERE id = ?
        """,
        STATUS_EXPIRED,
        codeId);
  }

  private void recordFailedAttempt(UUID codeId, int nextAttemptCount) {
    if (nextAttemptCount >= MAX_ATTEMPTS) {
      jdbcTemplate.update(
          """
          UPDATE local_auth_recovery_codes
          SET attempt_count = ?, last_attempt_at = now(), status = ?, consumed_at = now()
          WHERE id = ?
          """,
          nextAttemptCount,
          STATUS_CANCELLED,
          codeId);
      return;
    }

    jdbcTemplate.update(
        """
        UPDATE local_auth_recovery_codes
        SET attempt_count = ?, last_attempt_at = now()
        WHERE id = ?
        """,
        nextAttemptCount,
        codeId);
  }

  private void sendRecoveryCodeEmail(PrimaryAccount account, String code) {
    String body =
        "Your MailPilot password reset code is: "
            + code
            + "\n\n"
            + "This code expires in 10 minutes.\n"
            + "If you did not request this, you can ignore this email.";

    mailSendService.send(
        new MailSendCommand(
            account.id(),
            account.email(),
            null,
            null,
            "MailPilot password reset code",
            body,
            null,
            null,
            "NEW",
            List.of()));
  }

  private boolean canSend(String scope) {
    if (!StringUtils.hasText(scope)) {
      return false;
    }
    String required = GMAIL_SEND_SCOPE.toLowerCase(Locale.ROOT);
    for (String token : scope.trim().split("[\\s,]+")) {
      if (required.equals(token.toLowerCase(Locale.ROOT))) {
        return true;
      }
    }
    return false;
  }

  private String generateCode() {
    int value = secureRandom.nextInt(1_000_000);
    return String.format("%0" + CODE_LENGTH + "d", value);
  }

  private String normalizeCode(String code) {
    if (!StringUtils.hasText(code)) {
      throw new ApiBadRequestException("Recovery code is required.");
    }
    String normalized = code.trim();
    if (!normalized.matches("\\d{" + CODE_LENGTH + "}")) {
      throw new ApiBadRequestException("Recovery code must be a 6-digit number.");
    }
    return normalized;
  }

  private void validatePasswordResetInput(String newPassword, String confirmNewPassword) {
    if (!StringUtils.hasText(newPassword) || !StringUtils.hasText(confirmNewPassword)) {
      throw new ApiBadRequestException("New password and confirmation are required.");
    }
    if (!newPassword.equals(confirmNewPassword)) {
      throw new ApiBadRequestException("Password confirmation does not match.");
    }
  }

  private String maskEmail(String email) {
    if (!StringUtils.hasText(email) || !email.contains("@")) {
      return null;
    }
    String normalized = email.trim().toLowerCase(Locale.ROOT);
    String[] parts = normalized.split("@", 2);
    String local = parts[0];
    String domain = parts[1];
    if (local.isBlank()) {
      return null;
    }
    int maskedLength = Math.max(3, Math.min(11, local.length() - 1));
    return local.substring(0, 1) + "*".repeat(maskedLength) + "@" + domain;
  }

  private String normalizeNullable(String value) {
    if (!StringUtils.hasText(value)) {
      return null;
    }
    String normalized = value.trim();
    return normalized.isBlank() ? null : normalized;
  }

  public record RecoveryAvailability(
      boolean canRecover, String maskedEmail, String primaryEmail, String reason) {}

  private record PrimaryAccount(UUID id, String email, String scope) {}

  private record RecoveryCodeRow(
      UUID id, String targetEmail, String codeHash, OffsetDateTime expiresAt, int attemptCount) {}
}
