package com.mailpilot.service.oauth;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mailpilot.api.error.ApiBadRequestException;
import com.mailpilot.service.logging.LogSanitizer;
import jakarta.annotation.PostConstruct;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Locale;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class GoogleOAuthClientConfigService {

  private static final Logger LOGGER =
      LoggerFactory.getLogger(GoogleOAuthClientConfigService.class);
  private static final Path WINDOWS_DEFAULT_PATH =
      Paths.get("C:\\Users\\taulanth\\AppData\\Local\\MailPilot\\google-oauth-client.json");

  private final Environment environment;
  private final ObjectMapper objectMapper;

  public GoogleOAuthClientConfigService(Environment environment, ObjectMapper objectMapper) {
    this.environment = environment;
    this.objectMapper = objectMapper;
  }

  @PostConstruct
  public void validateStartupConfiguration() {
    if (!isDevProfile()) {
      return;
    }

    GoogleOAuthConfigCheck check = checkConfiguration();
    if (check.configured()) {
      LOGGER.info(
          "Google OAuth client configuration is available at {}", sanitizePath(check.path()));
      return;
    }

    String message = "Google OAuth client configuration missing or invalid. " + check.message();
    if (isStartupFailFastEnabled()) {
      throw new IllegalStateException(message);
    }
    LOGGER.warn("{} (set MAILPILOT_OAUTH_FAIL_FAST=true to enforce startup failure)", message);
  }

  public GoogleOAuthConfigCheck checkConfiguration() {
    Path resolvedPath;
    try {
      resolvedPath = resolvePath();
    } catch (ApiBadRequestException exception) {
      return new GoogleOAuthConfigCheck(false, null, exception.getMessage());
    }
    if (resolvedPath == null) {
      return new GoogleOAuthConfigCheck(
          false,
          null,
          "Set MAILPILOT_GOOGLE_OAUTH_CLIENT_JSON to a Google OAuth client JSON file path.");
    }

    if (!Files.exists(resolvedPath)) {
      return new GoogleOAuthConfigCheck(
          false, resolvedPath.toString(), "OAuth client JSON file not found at resolved path.");
    }

    try {
      loadConfig(resolvedPath);
      return new GoogleOAuthConfigCheck(
          true, resolvedPath.toString(), "OAuth client JSON loaded successfully.");
    } catch (IOException | IllegalArgumentException exception) {
      return new GoogleOAuthConfigCheck(
          false,
          resolvedPath.toString(),
          "Invalid OAuth client JSON. Expected installed.client_id and installed.client_secret.");
    }
  }

  public GoogleOAuthClientConfig loadRequiredConfig() {
    GoogleOAuthConfigCheck check = checkConfiguration();
    if (!check.configured()) {
      throw new ApiBadRequestException(check.message());
    }

    try {
      return loadConfig(Paths.get(check.path()));
    } catch (IOException | IllegalArgumentException exception) {
      throw new ApiBadRequestException(
          "OAuth client JSON is invalid. Expected installed.client_id and installed.client_secret.");
    }
  }

  private GoogleOAuthClientConfig loadConfig(Path path) throws IOException {
    JsonNode root = objectMapper.readTree(Files.readString(path));
    JsonNode installed = root.path("installed");
    if (!installed.isObject()) {
      throw new IllegalArgumentException("Missing installed object");
    }

    String clientId = installed.path("client_id").asText("");
    String clientSecret = installed.path("client_secret").asText("");
    if (!StringUtils.hasText(clientId) || !StringUtils.hasText(clientSecret)) {
      throw new IllegalArgumentException("Missing client_id/client_secret");
    }

    return new GoogleOAuthClientConfig(clientId.trim(), clientSecret.trim(), path.toString());
  }

  private Path resolvePath() {
    String fromEnv = environment.getProperty("MAILPILOT_GOOGLE_OAUTH_CLIENT_JSON");
    if (StringUtils.hasText(fromEnv)) {
      try {
        return Paths.get(fromEnv.trim()).toAbsolutePath().normalize();
      } catch (InvalidPathException exception) {
        throw new ApiBadRequestException(
            "MAILPILOT_GOOGLE_OAUTH_CLIENT_JSON points to an invalid path.");
      }
    }

    if (isWindows()) {
      return WINDOWS_DEFAULT_PATH;
    }

    return null;
  }

  private boolean isDevProfile() {
    for (String profile : environment.getActiveProfiles()) {
      if ("dev".equalsIgnoreCase(profile)) {
        return true;
      }
    }
    return false;
  }

  private boolean isStartupFailFastEnabled() {
    String value = environment.getProperty("MAILPILOT_OAUTH_FAIL_FAST");
    return value != null && Boolean.parseBoolean(value);
  }

  private String sanitizePath(String rawPath) {
    if (!StringUtils.hasText(rawPath)) {
      return "(unresolved)";
    }
    try {
      return LogSanitizer.sanitizePath(Paths.get(rawPath));
    } catch (InvalidPathException exception) {
      return "(invalid-path)";
    }
  }

  private boolean isWindows() {
    String osName = System.getProperty("os.name", "");
    return osName.toLowerCase(Locale.ROOT).contains("win");
  }

  public record GoogleOAuthConfigCheck(boolean configured, String path, String message) {}
}
