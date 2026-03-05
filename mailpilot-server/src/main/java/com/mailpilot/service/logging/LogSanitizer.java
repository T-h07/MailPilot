package com.mailpilot.service.logging;

import java.nio.file.Path;
import java.util.regex.Pattern;
import org.springframework.util.StringUtils;

public final class LogSanitizer {

  private static final int MAX_LOG_LENGTH = 240;
  private static final Pattern TOKEN_PATTERN = Pattern.compile(
    "(?i)(access_token|refresh_token|client_secret|authorization|token)\\s*[:=]\\s*[^,\\s\"']+"
  );
  private static final Pattern BEARER_PATTERN = Pattern.compile("(?i)bearer\\s+[a-z0-9._\\-+/=]+");

  private LogSanitizer() {}

  public static String sanitize(String value) {
    if (!StringUtils.hasText(value)) {
      return "";
    }

    String compact = value.replaceAll("[\\r\\n\\t]+", " ").trim();
    String redacted = TOKEN_PATTERN.matcher(compact).replaceAll("$1=[REDACTED]");
    redacted = BEARER_PATTERN.matcher(redacted).replaceAll("Bearer [REDACTED]");

    if (redacted.length() <= MAX_LOG_LENGTH) {
      return redacted;
    }
    return redacted.substring(0, MAX_LOG_LENGTH - 3) + "...";
  }

  public static String sanitizePath(Path value) {
    if (value == null) {
      return "";
    }

    Path fileName = value.getFileName();
    Path parent = value.getParent();
    if (fileName == null) {
      return sanitize(value.toString());
    }

    String compactPath = parent != null && parent.getFileName() != null
      ? parent.getFileName() + "/" + fileName
      : fileName.toString();
    return sanitize(compactPath);
  }
}
