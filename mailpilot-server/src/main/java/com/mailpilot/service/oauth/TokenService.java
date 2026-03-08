package com.mailpilot.service.oauth;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.mailpilot.api.errors.UnauthorizedException;
import com.mailpilot.service.logging.LogSanitizer;
import java.net.URI;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReentrantLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.util.StringUtils;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestTemplate;

@Service
public class TokenService {

  private static final Logger LOGGER = LoggerFactory.getLogger(TokenService.class);
  private static final String GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
  private static final Duration EXPIRY_SKEW = Duration.ofSeconds(60);

  private final JdbcTemplate jdbcTemplate;
  private final TokenCrypto tokenCrypto;
  private final GoogleOAuthClientConfigService googleOAuthClientConfigService;
  private final RestTemplate restTemplate;
  private final ConcurrentHashMap<UUID, ReentrantLock> refreshLocks = new ConcurrentHashMap<>();

  public TokenService(
      JdbcTemplate jdbcTemplate,
      TokenCrypto tokenCrypto,
      GoogleOAuthClientConfigService googleOAuthClientConfigService,
      RestTemplateBuilder restTemplateBuilder) {
    this.jdbcTemplate = jdbcTemplate;
    this.tokenCrypto = tokenCrypto;
    this.googleOAuthClientConfigService = googleOAuthClientConfigService;
    this.restTemplate =
        restTemplateBuilder
            .setConnectTimeout(Duration.ofSeconds(10))
            .setReadTimeout(Duration.ofSeconds(20))
            .build();
  }

  public AccessToken getValidAccessToken(UUID accountId) {
    TokenRow row = loadTokenRow(accountId);
    OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
    if (row.expiryAt() == null || row.expiryAt().isAfter(now.plus(EXPIRY_SKEW))) {
      return toAccessToken(row);
    }

    if (!StringUtils.hasText(row.refreshToken())) {
      return toAccessToken(row);
    }

    return refreshAccessToken(accountId);
  }

  public AccessToken refreshAccessToken(UUID accountId) {
    ReentrantLock refreshLock =
        refreshLocks.computeIfAbsent(accountId, ignored -> new ReentrantLock());
    refreshLock.lock();
    try {
      TokenRow existing = loadTokenRow(accountId);
      OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
      if (existing.expiryAt() == null || existing.expiryAt().isAfter(now.plus(EXPIRY_SKEW))) {
        return toAccessToken(existing);
      }
      if (!StringUtils.hasText(existing.refreshToken())) {
        throw new UnauthorizedException("OAuth refresh token is missing. Reconnect Gmail account.");
      }

      GoogleOAuthClientConfig config = googleOAuthClientConfigService.loadRequiredConfig();

      MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
      form.add("grant_type", "refresh_token");
      form.add("refresh_token", existing.refreshToken());
      form.add("client_id", config.clientId());
      form.add("client_secret", config.clientSecret());

      HttpHeaders headers = new HttpHeaders();
      headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);
      HttpEntity<MultiValueMap<String, String>> requestEntity = new HttpEntity<>(form, headers);

      GoogleRefreshTokenResponse responseBody;
      try {
        ResponseEntity<GoogleRefreshTokenResponse> response =
            restTemplate.postForEntity(
                URI.create(GOOGLE_TOKEN_ENDPOINT), requestEntity, GoogleRefreshTokenResponse.class);
        responseBody = response.getBody();
      } catch (HttpStatusCodeException exception) {
        throw new IllegalStateException(
            "Failed to refresh Google OAuth token: " + safeError(exception));
      }

      if (responseBody == null || !StringUtils.hasText(responseBody.accessToken())) {
        throw new IllegalStateException(
            "Google token refresh response did not include an access token.");
      }

      OffsetDateTime nextExpiryAt =
          responseBody.expiresIn() == null
              ? null
              : OffsetDateTime.now(ZoneOffset.UTC).plusSeconds(responseBody.expiresIn());

      String accessTokenEncrypted = tokenCrypto.encrypt(responseBody.accessToken());
      String refreshTokenEncrypted =
          StringUtils.hasText(responseBody.refreshToken())
              ? tokenCrypto.encrypt(responseBody.refreshToken())
              : null;

      jdbcTemplate.update(
          """
      UPDATE oauth_tokens
      SET
        access_token_enc = ?,
        refresh_token_enc = COALESCE(?, refresh_token_enc),
        expiry_at = ?,
        scope = COALESCE(?, scope),
        token_type = COALESCE(?, token_type),
        updated_at = now()
      WHERE account_id = ?
      """,
          accessTokenEncrypted,
          refreshTokenEncrypted,
          nextExpiryAt,
          responseBody.scope(),
          responseBody.tokenType(),
          accountId);

      TokenRow refreshed =
          new TokenRow(
              accountId,
              responseBody.accessToken(),
              StringUtils.hasText(responseBody.refreshToken())
                  ? responseBody.refreshToken()
                  : existing.refreshToken(),
              nextExpiryAt,
              firstNonBlank(responseBody.scope(), existing.scope()),
              firstNonBlank(responseBody.tokenType(), existing.tokenType()));

      return toAccessToken(refreshed);
    } finally {
      refreshLock.unlock();
    }
  }

  private TokenRow loadTokenRow(UUID accountId) {
    try {
      return jdbcTemplate
          .query(
              """
        SELECT account_id, access_token_enc, refresh_token_enc, expiry_at, scope, token_type
        FROM oauth_tokens
        WHERE account_id = ?
        """,
              (resultSet, rowNum) ->
                  new TokenRow(
                      resultSet.getObject("account_id", UUID.class),
                      tokenCrypto.decrypt(resultSet.getString("access_token_enc")),
                      decryptNullable(resultSet.getString("refresh_token_enc")),
                      resultSet.getObject("expiry_at", OffsetDateTime.class),
                      resultSet.getString("scope"),
                      resultSet.getString("token_type")),
              accountId)
          .stream()
          .findFirst()
          .orElseThrow(
              () ->
                  new UnauthorizedException(
                      "OAuth tokens not found for account. Reconnect Gmail account."));
    } catch (UnauthorizedException exception) {
      throw exception;
    } catch (IllegalStateException exception) {
      throw handleCorruptStoredTokens(accountId, exception);
    }
  }

  private String decryptNullable(String value) {
    if (!StringUtils.hasText(value)) {
      return null;
    }
    return tokenCrypto.decrypt(value);
  }

  private UnauthorizedException handleCorruptStoredTokens(
      UUID accountId, IllegalStateException cause) {
    LOGGER.warn(
        "OAuth tokens for account {} are unreadable. Clearing stored tokens and requiring reconnect.",
        accountId,
        cause);
    try {
      jdbcTemplate.update("DELETE FROM oauth_tokens WHERE account_id = ?", accountId);
    } catch (Exception clearFailure) {
      LOGGER.warn(
          "Failed to clear unreadable OAuth tokens for account {}", accountId, clearFailure);
    }
    return new UnauthorizedException(
        "Saved Gmail credentials are no longer valid. Reconnect Gmail account.");
  }

  private AccessToken toAccessToken(TokenRow row) {
    return new AccessToken(
        row.accountId(),
        row.accessToken(),
        row.refreshToken(),
        row.expiryAt(),
        row.scope(),
        row.tokenType());
  }

  private String safeError(HttpStatusCodeException exception) {
    String body = exception.getResponseBodyAsString();
    if (StringUtils.hasText(body)) {
      return LogSanitizer.sanitize(body);
    }
    return "HTTP " + exception.getStatusCode().value();
  }

  private String firstNonBlank(String primary, String fallback) {
    return StringUtils.hasText(primary) ? primary : fallback;
  }

  public record AccessToken(
      UUID accountId,
      String accessToken,
      String refreshToken,
      OffsetDateTime expiryAt,
      String scope,
      String tokenType) {}

  private record TokenRow(
      UUID accountId,
      String accessToken,
      String refreshToken,
      OffsetDateTime expiryAt,
      String scope,
      String tokenType) {}

  @JsonIgnoreProperties(ignoreUnknown = true)
  private record GoogleRefreshTokenResponse(
      @JsonProperty("access_token") String accessToken,
      @JsonProperty("refresh_token") String refreshToken,
      @JsonProperty("expires_in") Long expiresIn,
      @JsonProperty("scope") String scope,
      @JsonProperty("token_type") String tokenType) {}
}
