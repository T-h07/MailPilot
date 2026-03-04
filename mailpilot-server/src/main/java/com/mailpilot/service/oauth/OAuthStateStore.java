package com.mailpilot.service.oauth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class OAuthStateStore {

  private static final Duration PENDING_TTL = Duration.ofMinutes(10);
  private static final Duration RESULT_TTL = Duration.ofMinutes(10);

  private final SecureRandom secureRandom = new SecureRandom();
  private final Map<String, PendingState> pendingStates = new ConcurrentHashMap<>();
  private final Map<String, OAuthFlowStatus> finalStatuses = new ConcurrentHashMap<>();

  public PkceState create() {
    cleanup();

    String state = randomBase64Url(32);
    String codeVerifier = randomBase64Url(64);
    String codeChallenge = sha256Base64Url(codeVerifier);

    pendingStates.put(state, new PendingState(codeVerifier, Instant.now().plus(PENDING_TTL)));
    return new PkceState(state, codeVerifier, codeChallenge);
  }

  public Optional<String> consumeCodeVerifier(String state) {
    cleanup();
    if (!StringUtils.hasText(state)) {
      return Optional.empty();
    }

    PendingState pendingState = pendingStates.remove(state);
    if (pendingState == null) {
      return Optional.empty();
    }

    if (pendingState.expiresAt().isBefore(Instant.now())) {
      return Optional.empty();
    }

    return Optional.of(pendingState.codeVerifier());
  }

  public void markSuccess(String state, String message) {
    markFinalState(state, "SUCCESS", message);
  }

  public void markError(String state, String message) {
    markFinalState(state, "ERROR", message);
  }

  public OAuthFlowStatus status(String state) {
    cleanup();
    if (!StringUtils.hasText(state)) {
      return new OAuthFlowStatus("UNKNOWN", "Missing state");
    }

    OAuthFlowStatus finalState = finalStatuses.get(state);
    if (finalState != null) {
      return finalState;
    }

    PendingState pendingState = pendingStates.get(state);
    if (pendingState != null && pendingState.expiresAt().isAfter(Instant.now())) {
      return new OAuthFlowStatus("PENDING", "Awaiting OAuth callback", pendingState.expiresAt());
    }

    return new OAuthFlowStatus("UNKNOWN", "No OAuth flow found for this state");
  }

  private void markFinalState(String state, String status, String message) {
    if (!StringUtils.hasText(state)) {
      return;
    }
    cleanup();
    pendingStates.remove(state);
    finalStatuses.put(state, new OAuthFlowStatus(status, message, Instant.now().plus(RESULT_TTL)));
  }

  private void cleanup() {
    Instant now = Instant.now();
    pendingStates.entrySet().removeIf((entry) -> entry.getValue().expiresAt().isBefore(now));
    finalStatuses.entrySet().removeIf((entry) -> entry.getValue().expiresAt().isBefore(now));
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

  private record PendingState(String codeVerifier, Instant expiresAt) {}

  public record PkceState(String state, String codeVerifier, String codeChallenge) {}

  public record OAuthFlowStatus(String status, String message, Instant expiresAt) {
    public OAuthFlowStatus(String status, String message) {
      this(status, message, Instant.now().plus(RESULT_TTL));
    }
  }
}
