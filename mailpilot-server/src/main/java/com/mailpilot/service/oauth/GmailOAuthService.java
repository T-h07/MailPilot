package com.mailpilot.service.oauth;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mailpilot.api.model.GmailOAuthStartResponse;
import com.mailpilot.service.logging.LogSanitizer;
import com.mailpilot.service.oauth.OAuthAccountService.EncryptedTokenPayload;
import com.mailpilot.service.oauth.OAuthStateStore.OAuthFlowStatus;
import com.mailpilot.service.oauth.OAuthStateStore.PkceState;
import com.mailpilot.service.oauth.OAuthStateStore.PkceVerification;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.util.HtmlUtils;
import org.springframework.web.util.UriComponentsBuilder;

@Service
public class GmailOAuthService {

  private static final Logger LOGGER = LoggerFactory.getLogger(GmailOAuthService.class);

  private static final String AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
  private static final String TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
  private static final String GMAIL_PROFILE_ENDPOINT =
      "https://gmail.googleapis.com/gmail/v1/users/me/profile";
  private static final String REDIRECT_URI = "http://127.0.0.1:8082/api/oauth/gmail/callback";

  private static final String GMAIL_READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
  private static final String GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
  private static final List<String> READONLY_SCOPES =
      List.of("openid", "email", "profile", "https://www.googleapis.com/auth/gmail.readonly");

  private final GoogleOAuthClientConfigService googleOAuthClientConfigService;
  private final OAuthStateStore oauthStateStore;
  private final OAuthAccountService oauthAccountService;
  private final TokenCrypto tokenCrypto;
  private final ObjectMapper objectMapper;
  private final HttpClient httpClient;

  public GmailOAuthService(
      GoogleOAuthClientConfigService googleOAuthClientConfigService,
      OAuthStateStore oauthStateStore,
      OAuthAccountService oauthAccountService,
      TokenCrypto tokenCrypto,
      ObjectMapper objectMapper) {
    this.googleOAuthClientConfigService = googleOAuthClientConfigService;
    this.oauthStateStore = oauthStateStore;
    this.oauthAccountService = oauthAccountService;
    this.tokenCrypto = tokenCrypto;
    this.objectMapper = objectMapper;
    this.httpClient = HttpClient.newHttpClient();
  }

  public GmailOAuthStartResponse start(String requestedMode, String context, String accountHint) {
    OAuthStartMode mode = OAuthStartMode.fromInput(requestedMode);
    GoogleOAuthClientConfig config = googleOAuthClientConfigService.loadRequiredConfig();
    PkceState pkceState = oauthStateStore.create(mode.name(), context, accountHint);

    String authUrl =
        UriComponentsBuilder.fromUriString(AUTH_ENDPOINT)
            .queryParam("response_type", "code")
            .queryParam("client_id", config.clientId())
            .queryParam("redirect_uri", REDIRECT_URI)
            .queryParam("scope", String.join(" ", mode.requestedScopes()))
            .queryParam("code_challenge", pkceState.codeChallenge())
            .queryParam("code_challenge_method", "S256")
            .queryParam("access_type", "offline")
            .queryParam("prompt", "consent")
            .queryParam("state", pkceState.state())
            .build()
            .encode()
            .toUriString();

    return new GmailOAuthStartResponse(authUrl, pkceState.state());
  }

  public OAuthCallbackResult handleCallback(
      String code, String state, String error, String errorDescription) {
    if (!StringUtils.hasText(state)) {
      return failureResult("Missing OAuth state.", HttpStatus.BAD_REQUEST);
    }

    if (StringUtils.hasText(error)) {
      String mappedMessage = mapGoogleError(error, errorDescription);
      oauthStateStore.markError(state, mappedMessage);
      return failureResult(mappedMessage, HttpStatus.BAD_REQUEST);
    }

    if (!StringUtils.hasText(code)) {
      String message = "Missing authorization code from Google callback.";
      oauthStateStore.markError(state, message);
      return failureResult(message, HttpStatus.BAD_REQUEST);
    }

    PkceVerification verification = oauthStateStore.consumeCodeVerifier(state).orElse(null);
    if (verification == null || !StringUtils.hasText(verification.codeVerifier())) {
      OAuthFlowStatus flowStatus = oauthStateStore.status(state);
      if ("SUCCESS".equals(flowStatus.status())) {
        return successResult(
            StringUtils.hasText(flowStatus.message())
                ? flowStatus.message()
                : "Gmail connected. You can close this tab.");
      }
      if ("PENDING".equals(flowStatus.status())) {
        return successResult("OAuth callback is being processed. Return to MailPilot.");
      }
      String message =
          StringUtils.hasText(flowStatus.message())
              ? flowStatus.message()
              : "OAuth flow expired. Please retry Connect Gmail.";
      return failureResult(message, HttpStatus.BAD_REQUEST);
    }

    try {
      OAuthStartMode mode = OAuthStartMode.fromInput(verification.mode());
      GoogleOAuthClientConfig config = googleOAuthClientConfigService.loadRequiredConfig();
      GoogleTokenResponse tokenResponse =
          exchangeCodeForTokens(code, verification.codeVerifier(), config);
      String confirmedEmail = confirmEmailIdentity(tokenResponse);
      String grantedScope =
          StringUtils.hasText(tokenResponse.scope())
              ? tokenResponse.scope()
              : String.join(" ", mode.requestedScopes());
      validateGrantedScopes(mode, grantedScope);
      validateAccountHint(verification.accountHint(), confirmedEmail);

      String encryptedAccessToken = tokenCrypto.encrypt(tokenResponse.accessToken());
      String encryptedRefreshToken =
          StringUtils.hasText(tokenResponse.refreshToken())
              ? tokenCrypto.encrypt(tokenResponse.refreshToken())
              : null;

      OffsetDateTime expiryAt =
          tokenResponse.expiresIn() == null
              ? null
              : OffsetDateTime.now(ZoneOffset.UTC).plusSeconds(tokenResponse.expiresIn());

      UUID accountId =
          oauthAccountService.upsertConnectedGmailAccountAndTokens(
              confirmedEmail,
              null,
              new EncryptedTokenPayload(
                  encryptedAccessToken,
                  encryptedRefreshToken,
                  expiryAt,
                  grantedScope,
                  tokenResponse.tokenType()));

      LOGGER.info("Connected Gmail account: {}", confirmedEmail);
      oauthStateStore.markSuccess(state, "Connected " + confirmedEmail, accountId, confirmedEmail);
      return successResult("Gmail connected. You can close this tab.");
    } catch (OAuthFlowException exception) {
      LOGGER.warn(
          "Gmail OAuth callback rejected: {}", LogSanitizer.sanitize(exception.getMessage()));
      oauthStateStore.markError(state, exception.getMessage());
      return failureResult(exception.getMessage(), HttpStatus.BAD_REQUEST);
    } catch (Exception exception) {
      LOGGER.error(
          "Unexpected Gmail OAuth callback failure: {}",
          LogSanitizer.sanitize(exception.getMessage()));
      oauthStateStore.markError(state, "Unexpected error while connecting Gmail.");
      return failureResult(
          "Unexpected error while connecting Gmail. Please retry.",
          HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  public OAuthFlowStatus status(String state) {
    return oauthStateStore.status(state);
  }

  private GoogleTokenResponse exchangeCodeForTokens(
      String code, String codeVerifier, GoogleOAuthClientConfig config) {
    Map<String, String> form = new LinkedHashMap<>();
    form.put("grant_type", "authorization_code");
    form.put("code", code);
    form.put("client_id", config.clientId());
    form.put("client_secret", config.clientSecret());
    form.put("redirect_uri", REDIRECT_URI);
    form.put("code_verifier", codeVerifier);

    HttpRequest request =
        HttpRequest.newBuilder(URI.create(TOKEN_ENDPOINT))
            .header("Content-Type", "application/x-www-form-urlencoded")
            .POST(HttpRequest.BodyPublishers.ofString(buildFormBody(form)))
            .build();

    try {
      HttpResponse<String> response =
          httpClient.send(request, HttpResponse.BodyHandlers.ofString());
      if (response.statusCode() < 200 || response.statusCode() > 299) {
        throw new OAuthFlowException(mapTokenExchangeError(response.statusCode(), response.body()));
      }

      GoogleTokenResponse tokenResponse =
          objectMapper.readValue(response.body(), GoogleTokenResponse.class);
      if (!StringUtils.hasText(tokenResponse.accessToken())) {
        throw new OAuthFlowException("Token exchange failed: missing access token.");
      }

      return tokenResponse;
    } catch (IOException exception) {
      throw new OAuthFlowException("Token exchange failed. Unable to parse Google response.");
    } catch (InterruptedException exception) {
      Thread.currentThread().interrupt();
      throw new OAuthFlowException("Token exchange interrupted.");
    }
  }

  private String confirmEmailIdentity(GoogleTokenResponse tokenResponse) {
    String profileEmail = fetchEmailFromGmailProfile(tokenResponse.accessToken());
    if (StringUtils.hasText(profileEmail)) {
      return normalizeEmail(profileEmail);
    }

    String idTokenEmail = extractEmailFromIdToken(tokenResponse.idToken());
    if (StringUtils.hasText(idTokenEmail)) {
      return normalizeEmail(idTokenEmail);
    }

    throw new OAuthFlowException(
        "Unable to confirm Gmail email identity from Google OAuth response.");
  }

  private String fetchEmailFromGmailProfile(String accessToken) {
    HttpRequest request =
        HttpRequest.newBuilder(URI.create(GMAIL_PROFILE_ENDPOINT))
            .header("Authorization", "Bearer " + accessToken)
            .GET()
            .build();

    try {
      HttpResponse<String> response =
          httpClient.send(request, HttpResponse.BodyHandlers.ofString());
      if (response.statusCode() < 200 || response.statusCode() > 299) {
        return null;
      }

      JsonNode body = objectMapper.readTree(response.body());
      String email = body.path("emailAddress").asText("");
      return StringUtils.hasText(email) ? email : null;
    } catch (IOException exception) {
      return null;
    } catch (InterruptedException exception) {
      Thread.currentThread().interrupt();
      return null;
    }
  }

  private String extractEmailFromIdToken(String idToken) {
    if (!StringUtils.hasText(idToken)) {
      return null;
    }

    String[] parts = idToken.split("\\.");
    if (parts.length < 2) {
      return null;
    }

    try {
      String payloadPart = parts[1];
      byte[] decoded =
          Base64.getUrlDecoder().decode(padBase64Url(payloadPart).getBytes(StandardCharsets.UTF_8));
      JsonNode payload = objectMapper.readTree(decoded);
      String email = payload.path("email").asText("");
      return StringUtils.hasText(email) ? email : null;
    } catch (IllegalArgumentException | IOException exception) {
      return null;
    }
  }

  private String mapTokenExchangeError(int statusCode, String responseBody) {
    try {
      GoogleTokenErrorResponse errorResponse =
          objectMapper.readValue(responseBody, GoogleTokenErrorResponse.class);
      return LogSanitizer.sanitize(
          mapGoogleError(errorResponse.error(), errorResponse.errorDescription()));
    } catch (IOException ignored) {
      return "Token exchange failed with HTTP " + statusCode + ".";
    }
  }

  private String mapGoogleError(String error, String description) {
    String normalized = (safe(error) + " " + safe(description)).toLowerCase(Locale.ROOT);

    if (normalized.contains("redirect_uri_mismatch")) {
      return "Google OAuth redirect URI mismatch. Configure redirect URI as http://127.0.0.1:8082/api/oauth/gmail/callback.";
    }

    if (normalized.contains("access_denied")
        || normalized.contains("test users")
        || normalized.contains("not authorized")) {
      return "Google consent failed. If OAuth consent is in Testing mode, add this Gmail account as a Test user.";
    }

    if (normalized.contains("invalid_client")) {
      return "Google OAuth client is invalid. Verify installed.client_id and installed.client_secret.";
    }

    if (normalized.contains("invalid_grant")) {
      return "Authorization code expired or already used. Please retry Connect Gmail.";
    }

    if (StringUtils.hasText(description)) {
      return LogSanitizer.sanitize(description.trim());
    }

    if (StringUtils.hasText(error)) {
      return "Google OAuth failed: " + error.trim();
    }

    return "Google OAuth failed. Please retry.";
  }

  private void validateGrantedScopes(OAuthStartMode mode, String grantedScope) {
    if (!hasScope(grantedScope, GMAIL_READ_SCOPE)) {
      throw new OAuthFlowException(
          "Google did not grant Gmail read access. Retry and approve access.");
    }
    if (mode == OAuthStartMode.SEND && !hasScope(grantedScope, GMAIL_SEND_SCOPE)) {
      throw new OAuthFlowException(
          "Google did not grant Gmail send access. Retry and approve sending permission.");
    }
  }

  private void validateAccountHint(String accountHint, String confirmedEmail) {
    String normalizedHint = normalizeEmailOrNull(accountHint);
    if (!StringUtils.hasText(normalizedHint)) {
      return;
    }
    String normalizedConfirmed = normalizeEmail(confirmedEmail);
    if (!normalizedHint.equals(normalizedConfirmed)) {
      throw new OAuthFlowException(
          "Connected Google account does not match the expected account. Please sign in with "
              + normalizedHint
              + ".");
    }
  }

  private String buildFormBody(Map<String, String> form) {
    return form.entrySet().stream()
        .map(
            (entry) ->
                URLEncoder.encode(entry.getKey(), StandardCharsets.UTF_8)
                    + "="
                    + URLEncoder.encode(
                        Objects.toString(entry.getValue(), ""), StandardCharsets.UTF_8))
        .reduce((left, right) -> left + "&" + right)
        .orElse("");
  }

  private String normalizeEmail(String rawEmail) {
    String trimmed = rawEmail == null ? "" : rawEmail.trim();
    if (trimmed.isEmpty()) {
      throw new OAuthFlowException("Google returned an empty email identity.");
    }
    return trimmed.toLowerCase(Locale.ROOT);
  }

  private String normalizeEmailOrNull(String rawEmail) {
    if (!StringUtils.hasText(rawEmail)) {
      return null;
    }
    String trimmed = rawEmail.trim();
    return trimmed.isEmpty() ? null : trimmed.toLowerCase(Locale.ROOT);
  }

  private boolean hasScope(String scopeValue, String requiredScope) {
    if (!StringUtils.hasText(scopeValue)) {
      return false;
    }
    String required = requiredScope.toLowerCase(Locale.ROOT);
    for (String scope : scopeValue.trim().split("[\\s,]+")) {
      if (required.equals(scope.toLowerCase(Locale.ROOT))) {
        return true;
      }
    }
    return false;
  }

  private String padBase64Url(String input) {
    int padding = (4 - (input.length() % 4)) % 4;
    return input + "=".repeat(padding);
  }

  private String safe(String value) {
    return value == null ? "" : value.trim();
  }

  private OAuthCallbackResult successResult(String message) {
    return new OAuthCallbackResult(
        HttpStatus.OK.value(), htmlPage("Gmail connected", message, true));
  }

  private OAuthCallbackResult failureResult(String message, HttpStatus status) {
    return new OAuthCallbackResult(
        status.value(), htmlPage("Gmail connection failed", message, false));
  }

  private String htmlPage(String title, String message, boolean success) {
    String safeTitle = HtmlUtils.htmlEscape(title);
    String safeMessage = HtmlUtils.htmlEscape(message);
    String accent = success ? "#0f766e" : "#b91c1c";

    return """
      <!doctype html>
      <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>%s</title>
      </head>
      <body style="font-family: Segoe UI, Arial, sans-serif; background: #f8fafc; color: #0f172a; padding: 32px;">
        <main style="max-width: 640px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px;">
          <h1 style="margin: 0 0 8px; font-size: 1.25rem; color: %s;">%s</h1>
          <p style="margin: 0; line-height: 1.5;">%s</p>
        </main>
      </body>
      </html>
      """
        .formatted(safeTitle, accent, safeTitle, safeMessage);
  }

  public record OAuthCallbackResult(int httpStatusCode, String html) {}

  private static class OAuthFlowException extends RuntimeException {

    OAuthFlowException(String message) {
      super(message);
    }
  }

  private enum OAuthStartMode {
    READONLY,
    SEND,
    ;

    private List<String> requestedScopes() {
      if (this == SEND) {
        return List.of(
            READONLY_SCOPES.get(0),
            READONLY_SCOPES.get(1),
            READONLY_SCOPES.get(2),
            READONLY_SCOPES.get(3),
            GMAIL_SEND_SCOPE);
      }
      return READONLY_SCOPES;
    }

    private static OAuthStartMode fromInput(String value) {
      if (!StringUtils.hasText(value)) {
        return READONLY;
      }
      String normalized = value.trim().toUpperCase(Locale.ROOT);
      if ("SEND".equals(normalized)) {
        return SEND;
      }
      return READONLY;
    }
  }

  @JsonIgnoreProperties(ignoreUnknown = true)
  private record GoogleTokenResponse(
      @JsonProperty("access_token") String accessToken,
      @JsonProperty("refresh_token") String refreshToken,
      @JsonProperty("expires_in") Long expiresIn,
      @JsonProperty("scope") String scope,
      @JsonProperty("token_type") String tokenType,
      @JsonProperty("id_token") String idToken) {}

  @JsonIgnoreProperties(ignoreUnknown = true)
  private record GoogleTokenErrorResponse(
      @JsonProperty("error") String error,
      @JsonProperty("error_description") String errorDescription) {}
}
