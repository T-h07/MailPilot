package com.mailpilot.service.oauth;

import com.mailpilot.service.logging.LogSanitizer;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;
import java.security.SecureRandom;
import java.util.Base64;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class TokenKeyProvider {

  private static final Logger LOGGER = LoggerFactory.getLogger(TokenKeyProvider.class);
  private static final String MAILPILOT_DIRECTORY = "MailPilot";
  private static final String TOKEN_KEY_FILE_NAME = "token_key.b64";
  private static final int REQUIRED_KEY_BYTES = 32;

  private final Environment environment;
  private final byte[] tokenKey;

  public TokenKeyProvider(Environment environment) {
    this.environment = environment;
    this.tokenKey = resolveTokenKey();
  }

  public byte[] key() {
    return tokenKey.clone();
  }

  private byte[] resolveTokenKey() {
    String keyFromEnv = environment.getProperty("MAILPILOT_TOKEN_KEY_B64");
    if (StringUtils.hasText(keyFromEnv)) {
      return decodeAndValidate(keyFromEnv.trim(), "MAILPILOT_TOKEN_KEY_B64");
    }

    if (environment.acceptsProfiles(Profiles.of("dev"))) {
      return resolveOrCreateDevKey();
    }

    byte[] ephemeralKey = randomKey();
    LOGGER.warn(
        "MAILPILOT_TOKEN_KEY_B64 is not set outside dev profile. Using an ephemeral in-memory key.");
    return ephemeralKey;
  }

  private byte[] resolveOrCreateDevKey() {
    Path keyPath = defaultDevKeyPath();

    if (Files.exists(keyPath)) {
      try {
        String storedValue = Files.readString(keyPath).trim();
        if (StringUtils.hasText(storedValue)) {
          return decodeAndValidate(storedValue, keyPath.toString());
        }
      } catch (IOException | IllegalArgumentException exception) {
        LOGGER.warn(
            "Existing token key file is invalid at {}. Regenerating.",
            LogSanitizer.sanitizePath(keyPath));
      }
    }

    byte[] generated = randomKey();
    String encoded = Base64.getEncoder().encodeToString(generated);

    try {
      Path parent = keyPath.getParent();
      if (parent != null) {
        Files.createDirectories(parent);
      }
      Files.writeString(
          keyPath,
          encoded,
          StandardOpenOption.CREATE,
          StandardOpenOption.TRUNCATE_EXISTING,
          StandardOpenOption.WRITE);
    } catch (IOException exception) {
      throw new IllegalStateException(
          "Failed to write dev token key file to " + LogSanitizer.sanitizePath(keyPath), exception);
    }

    LOGGER.warn(
        "MAILPILOT_TOKEN_KEY_B64 is not set. Generated a dev token key at {}. "
            + "Set MAILPILOT_TOKEN_KEY_B64 to that file's value for stable encryption.",
        LogSanitizer.sanitizePath(keyPath));

    return generated;
  }

  private Path defaultDevKeyPath() {
    String localAppData = environment.getProperty("LOCALAPPDATA");
    if (StringUtils.hasText(localAppData)) {
      return Paths.get(localAppData.trim(), MAILPILOT_DIRECTORY, TOKEN_KEY_FILE_NAME);
    }

    String userHome = System.getProperty("user.home", ".");
    return Paths.get(userHome, "AppData", "Local", MAILPILOT_DIRECTORY, TOKEN_KEY_FILE_NAME);
  }

  private byte[] randomKey() {
    byte[] bytes = new byte[REQUIRED_KEY_BYTES];
    new SecureRandom().nextBytes(bytes);
    return bytes;
  }

  private byte[] decodeAndValidate(String rawValue, String sourceLabel) {
    byte[] decoded;
    try {
      decoded = Base64.getDecoder().decode(rawValue);
    } catch (IllegalArgumentException exception) {
      throw new IllegalStateException(sourceLabel + " is not valid base64.");
    }

    if (decoded.length != REQUIRED_KEY_BYTES) {
      throw new IllegalStateException(sourceLabel + " must decode to exactly 32 bytes.");
    }

    return decoded;
  }
}
