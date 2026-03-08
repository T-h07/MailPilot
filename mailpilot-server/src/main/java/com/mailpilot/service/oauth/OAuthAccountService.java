package com.mailpilot.service.oauth;

import java.time.OffsetDateTime;
import java.util.Locale;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class OAuthAccountService {

  private final JdbcTemplate jdbcTemplate;
  private final GmailScopeService gmailScopeService;

  public OAuthAccountService(JdbcTemplate jdbcTemplate, GmailScopeService gmailScopeService) {
    this.jdbcTemplate = jdbcTemplate;
    this.gmailScopeService = gmailScopeService;
  }

  @Transactional
  public UUID upsertConnectedGmailAccountAndTokens(
    String email,
    String displayName,
    EncryptedTokenPayload tokenPayload
  ) {
    UUID accountId = upsertConnectedGmailAccount(email, displayName, tokenPayload.scope());

    jdbcTemplate.update(
      """
      INSERT INTO oauth_tokens (
        account_id,
        access_token_enc,
        refresh_token_enc,
        expiry_at,
        scope,
        token_type,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, now())
      ON CONFLICT (account_id)
      DO UPDATE SET
        access_token_enc = EXCLUDED.access_token_enc,
        refresh_token_enc = COALESCE(EXCLUDED.refresh_token_enc, oauth_tokens.refresh_token_enc),
        expiry_at = EXCLUDED.expiry_at,
        scope = EXCLUDED.scope,
        token_type = EXCLUDED.token_type,
        updated_at = now()
      """,
      accountId,
      tokenPayload.accessTokenEncrypted(),
      tokenPayload.refreshTokenEncrypted(),
      tokenPayload.expiryAt(),
      tokenPayload.scope(),
      tokenPayload.tokenType()
    );

    return accountId;
  }

  private UUID upsertConnectedGmailAccount(String email, String displayName, String scope) {
    String normalizedEmail = email.trim().toLowerCase(Locale.ROOT);
    String normalizedDisplayName = normalizeDisplayName(displayName);
    String status =
        gmailScopeService.resolveStatus(GmailScopeService.GMAIL_PROVIDER, "CONNECTED", scope);

    UUID accountId = jdbcTemplate.queryForObject(
      """
      INSERT INTO accounts (
        provider,
        email,
        display_name,
        status,
        last_sync_at,
        updated_at
      )
      VALUES ('GMAIL', ?, ?, ?, now(), now())
      ON CONFLICT (provider, email)
      DO UPDATE SET
        display_name = COALESCE(EXCLUDED.display_name, accounts.display_name),
        status = EXCLUDED.status,
        last_sync_at = now(),
        updated_at = now()
      RETURNING id
      """,
      UUID.class,
      normalizedEmail,
      normalizedDisplayName,
      status
    );

    if (accountId == null) {
      throw new IllegalStateException("Failed to upsert Gmail account");
    }

    return accountId;
  }

  private String normalizeDisplayName(String displayName) {
    if (!StringUtils.hasText(displayName)) {
      return null;
    }
    String trimmed = displayName.trim();
    return trimmed.isEmpty() ? null : trimmed;
  }

  public record EncryptedTokenPayload(
    String accessTokenEncrypted,
    String refreshTokenEncrypted,
    OffsetDateTime expiryAt,
    String scope,
    String tokenType
  ) {}
}
