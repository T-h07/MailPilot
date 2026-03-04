package com.mailpilot.service;

import com.mailpilot.api.model.AccountResponse;
import java.util.List;
import java.util.Locale;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class AccountService {

  private static final String GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

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
        ot.scope,
        ot.refresh_token_enc
      FROM accounts a
      LEFT JOIN oauth_tokens ot ON ot.account_id = a.id
      ORDER BY a.provider, a.email
      """,
      (resultSet, rowNum) -> {
        String provider = resultSet.getString("provider");
        String scope = resultSet.getString("scope");
        String refreshTokenEncrypted = resultSet.getString("refresh_token_enc");
        boolean canSend = isGmailSendEnabled(provider, scope, refreshTokenEncrypted);
        String effectiveStatus = resolveStatus(provider, resultSet.getString("status"), canSend);

        return new AccountResponse(
          resultSet.getObject("id", java.util.UUID.class),
          resultSet.getString("email"),
          provider,
          effectiveStatus,
          canSend,
          resultSet.getObject("last_sync_at", java.time.OffsetDateTime.class)
        );
      }
    );
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
