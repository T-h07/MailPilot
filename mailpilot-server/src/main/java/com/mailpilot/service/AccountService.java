package com.mailpilot.service;

import com.mailpilot.api.error.ApiBadRequestException;
import com.mailpilot.api.error.ApiNotFoundException;
import com.mailpilot.api.model.AccountResponse;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class AccountService {

  private static final String GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
  private static final Set<String> ALLOWED_ROLES = Set.of("PRIMARY", "SECONDARY", "CUSTOM");
  private static final int CUSTOM_LABEL_MAX_LENGTH = 30;

  private final JdbcTemplate jdbcTemplate;

  public AccountService(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public List<AccountResponse> listAccounts() {
    return jdbcTemplate.query(
      """
      SELECT
        a.id,
        a.email,
        a.provider,
        a.status,
        a.last_sync_at,
        a.role,
        a.custom_label,
        ot.scope,
        ot.refresh_token_enc
      FROM accounts a
      LEFT JOIN oauth_tokens ot ON ot.account_id = a.id
      ORDER BY
        CASE a.role
          WHEN 'PRIMARY' THEN 0
          WHEN 'CUSTOM' THEN 1
          ELSE 2
        END,
        a.provider,
        a.email
      """,
      (resultSet, rowNum) -> {
        String provider = resultSet.getString("provider");
        String scope = resultSet.getString("scope");
        String refreshTokenEncrypted = resultSet.getString("refresh_token_enc");
        boolean canSend = isGmailSendEnabled(provider, scope, refreshTokenEncrypted);
        String effectiveStatus = resolveStatus(provider, resultSet.getString("status"), canSend);
        String role = normalizeRoleForResponse(resultSet.getString("role"));
        String customLabel = "CUSTOM".equals(role)
          ? normalizeCustomLabelForResponse(resultSet.getString("custom_label"))
          : null;

        return new AccountResponse(
          resultSet.getObject("id", UUID.class),
          resultSet.getString("email"),
          provider,
          effectiveStatus,
          canSend,
          resultSet.getObject("last_sync_at", java.time.OffsetDateTime.class),
          role,
          customLabel
        );
      }
    );
  }

  @Transactional
  public UUID detachAccount(UUID accountId, boolean purge) {
    if (!purge) {
      throw new ApiBadRequestException("purge=true required");
    }

    int deletedRows = jdbcTemplate.update("DELETE FROM accounts WHERE id = ?", accountId);
    if (deletedRows == 0) {
      throw new ApiNotFoundException("Account not found");
    }
    return accountId;
  }

  @Transactional
  public void updateLabel(UUID accountId, String rawRole, String rawCustomLabel) {
    ensureAccountExists(accountId);

    String role = normalizeRoleInput(rawRole);
    String customLabel = normalizeCustomLabelInput(role, rawCustomLabel);

    if ("PRIMARY".equals(role)) {
      jdbcTemplate.update(
        """
        UPDATE accounts
        SET role = 'SECONDARY', custom_label = NULL, updated_at = now()
        WHERE role = 'PRIMARY' AND id <> ?
        """,
        accountId
      );
    }

    jdbcTemplate.update(
      """
      UPDATE accounts
      SET role = ?, custom_label = ?, updated_at = now()
      WHERE id = ?
      """,
      role,
      customLabel,
      accountId
    );
  }

  private void ensureAccountExists(UUID accountId) {
    Integer count = jdbcTemplate.queryForObject(
      "SELECT COUNT(*) FROM accounts WHERE id = ?",
      Integer.class,
      accountId
    );
    if (count == null || count == 0) {
      throw new ApiNotFoundException("Account not found");
    }
  }

  private String normalizeRoleInput(String rawRole) {
    if (!StringUtils.hasText(rawRole)) {
      throw new ApiBadRequestException("role is required");
    }
    String role = rawRole.trim().toUpperCase(Locale.ROOT);
    if (!ALLOWED_ROLES.contains(role)) {
      throw new ApiBadRequestException("role must be PRIMARY, SECONDARY, or CUSTOM");
    }
    return role;
  }

  private String normalizeCustomLabelInput(String role, String rawCustomLabel) {
    if (!"CUSTOM".equals(role)) {
      if (StringUtils.hasText(rawCustomLabel)) {
        throw new ApiBadRequestException("customLabel must be null unless role is CUSTOM");
      }
      return null;
    }

    if (!StringUtils.hasText(rawCustomLabel)) {
      throw new ApiBadRequestException("customLabel is required when role is CUSTOM");
    }

    String normalized = rawCustomLabel.trim();
    if (normalized.isEmpty() || normalized.length() > CUSTOM_LABEL_MAX_LENGTH) {
      throw new ApiBadRequestException("customLabel must be between 1 and 30 characters");
    }

    return normalized;
  }

  private String normalizeRoleForResponse(String rawRole) {
    if (!StringUtils.hasText(rawRole)) {
      return "SECONDARY";
    }

    String normalized = rawRole.trim().toUpperCase(Locale.ROOT);
    return ALLOWED_ROLES.contains(normalized) ? normalized : "SECONDARY";
  }

  private String normalizeCustomLabelForResponse(String rawCustomLabel) {
    if (!StringUtils.hasText(rawCustomLabel)) {
      return null;
    }
    String normalized = rawCustomLabel.trim();
    return normalized.isEmpty() ? null : normalized;
  }

  private boolean isGmailSendEnabled(String provider, String scope, String refreshTokenEncrypted) {
    if (!"GMAIL".equalsIgnoreCase(provider)) {
      return false;
    }
    if (!StringUtils.hasText(refreshTokenEncrypted)) {
      return false;
    }
    return hasScope(scope, GMAIL_SEND_SCOPE);
  }

  private String resolveStatus(String provider, String existingStatus, boolean canSend) {
    if (!"GMAIL".equalsIgnoreCase(provider)) {
      return existingStatus;
    }
    return canSend ? "CONNECTED" : "REAUTH_REQUIRED";
  }

  private boolean hasScope(String scopeValue, String requiredScope) {
    if (!StringUtils.hasText(scopeValue)) {
      return false;
    }
    String[] scopes = scopeValue.trim().split("\\s+");
    String required = requiredScope.toLowerCase(Locale.ROOT);
    for (String scope : scopes) {
      if (required.equals(scope.toLowerCase(Locale.ROOT))) {
        return true;
      }
    }
    return false;
  }
}
