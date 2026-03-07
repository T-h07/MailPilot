package com.mailpilot.config;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Duration;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class DesktopRuntimeBootstrap {

  static final String DESKTOP_PROFILE = "desktop";
  static final String DATABASE_NAME = "mailpilot";
  static final String DESKTOP_BASE_DIR_PROPERTY = "mailpilot.desktop.base-dir";

  private static final Logger LOGGER = LoggerFactory.getLogger(DesktopRuntimeBootstrap.class);
  private static volatile EmbeddedPostgres embeddedPostgres;
  private static final String POSTMASTER_PID_FILE = "postmaster.pid";
  private static final String POSTMASTER_OPTIONS_FILE = "postmaster.opts";
  private static final Duration POSTMASTER_SHUTDOWN_TIMEOUT = Duration.ofSeconds(5);

  private DesktopRuntimeBootstrap() {}

  public static void configureIfNeeded(String[] args) {
    if (!isDesktopProfileActive(args)) {
      return;
    }

    Path baseDir = resolveBaseDir();
    Path logsDir = baseDir.resolve("logs");
    Path cacheDir = baseDir.resolve("cache");
    Path postgresRuntimeDir = baseDir.resolve("embedded-postgres-runtime");
    Path postgresDataDir = baseDir.resolve("embedded-postgres-data");

    try {
      Files.createDirectories(logsDir);
      Files.createDirectories(cacheDir);
      Files.createDirectories(postgresRuntimeDir);
      Files.createDirectories(postgresDataDir);
    } catch (IOException exception) {
      throw new IllegalStateException(
          "Failed to prepare MailPilot desktop directories.", exception);
    }

    System.setProperty("logging.file.name", logsDir.resolve("backend.log").toString());
    System.setProperty("mailpilot.cacheDir", cacheDir.toString());

    EmbeddedPostgres postgres = startEmbeddedPostgres(postgresRuntimeDir, postgresDataDir);
    ensureDatabaseExists(postgres, DATABASE_NAME);

    System.setProperty("spring.datasource.url", postgres.getJdbcUrl("postgres", DATABASE_NAME));
    System.setProperty("spring.datasource.username", "postgres");
    System.setProperty("spring.datasource.password", "");

    LOGGER.info("Desktop runtime configured at {}", baseDir);
  }

  static boolean isDesktopProfileActive(String[] args) {
    String profilesArgument =
        Arrays.stream(args)
            .filter(argument -> argument.startsWith("--spring.profiles.active="))
            .map(argument -> argument.substring("--spring.profiles.active=".length()))
            .findFirst()
            .orElseGet(() -> firstNonBlank(System.getProperty("spring.profiles.active")));

    if (profilesArgument == null) {
      profilesArgument = firstNonBlank(System.getenv("SPRING_PROFILES_ACTIVE"));
    }

    if (profilesArgument == null) {
      return false;
    }

    return Arrays.stream(profilesArgument.split(","))
        .map(String::trim)
        .anyMatch(DESKTOP_PROFILE::equalsIgnoreCase);
  }

  static Path resolveBaseDir() {
    String configured = firstNonBlank(System.getProperty(DESKTOP_BASE_DIR_PROPERTY));
    if (configured != null) {
      return Path.of(configured);
    }

    String localAppData = firstNonBlank(System.getenv("LOCALAPPDATA"));
    if (localAppData != null) {
      return Path.of(localAppData, "MailPilot");
    }

    return Path.of(System.getProperty("user.home"), "AppData", "Local", "MailPilot");
  }

  private static EmbeddedPostgres startEmbeddedPostgres(
      Path postgresRuntimeDir, Path postgresDataDir) {
    if (embeddedPostgres != null) {
      return embeddedPostgres;
    }

    synchronized (DesktopRuntimeBootstrap.class) {
      if (embeddedPostgres != null) {
        return embeddedPostgres;
      }

      try {
        removeStalePostmasterPid(postgresDataDir);
        embeddedPostgres =
            EmbeddedPostgres.builder()
                .setOverrideWorkingDirectory(postgresRuntimeDir.toFile())
                .setDataDirectory(postgresDataDir.toFile())
                .setCleanDataDirectory(false)
                .setPGStartupWait(Duration.ofSeconds(60))
                .start();
        return embeddedPostgres;
      } catch (IOException exception) {
        throw new IllegalStateException(
            "Failed to start embedded Postgres for desktop mode.", exception);
      }
    }
  }

  static void removeStalePostmasterPid(Path postgresDataDir) {
    Path postmasterPidPath = postgresDataDir.resolve(POSTMASTER_PID_FILE);
    if (!Files.exists(postmasterPidPath)) {
      return;
    }

    List<String> lines;
    try {
      lines = Files.readAllLines(postmasterPidPath);
    } catch (IOException exception) {
      throw new IllegalStateException(
          "Failed to inspect embedded Postgres pid file at " + postmasterPidPath, exception);
    }

    String pidText = lines.isEmpty() ? "" : lines.getFirst().trim();
    java.util.OptionalLong pid = parsePid(pidText);
    if (!pidText.isEmpty() && pid.isPresent()) {
      long postmasterPid = pid.getAsLong();
      if (postmasterPid == ProcessHandle.current().pid()) {
        LOGGER.warn(
            "Embedded Postgres metadata points at the current process (pid={}); leaving files in place.",
            postmasterPid);
        return;
      }

      Optional<ProcessHandle> processHandle = ProcessHandle.of(postmasterPid);
      if (processHandle.isPresent() && processHandle.get().isAlive()) {
        LOGGER.warn(
            "Detected running embedded Postgres process (pid={}) before startup. Attempting cleanup.",
            postmasterPid);
        stopProcess(processHandle.get(), postmasterPid);
      }
    }

    try {
      Files.deleteIfExists(postmasterPidPath);
      Files.deleteIfExists(postgresDataDir.resolve(POSTMASTER_OPTIONS_FILE));
      LOGGER.warn("Removed stale embedded Postgres pid metadata from {}", postgresDataDir);
    } catch (IOException exception) {
      throw new IllegalStateException(
          "Failed to remove stale embedded Postgres pid metadata.", exception);
    }
  }

  private static void stopProcess(ProcessHandle processHandle, long pid) {
    processHandle.destroy();
    if (waitForExit(processHandle, POSTMASTER_SHUTDOWN_TIMEOUT)) {
      return;
    }

    processHandle.destroyForcibly();
    if (waitForExit(processHandle, POSTMASTER_SHUTDOWN_TIMEOUT)) {
      return;
    }

    throw new IllegalStateException(
        "Unable to stop stale embedded Postgres process with pid " + pid + ".");
  }

  private static boolean waitForExit(ProcessHandle processHandle, Duration timeout) {
    long deadlineNanos = System.nanoTime() + timeout.toNanos();
    while (processHandle.isAlive() && System.nanoTime() < deadlineNanos) {
      try {
        Thread.sleep(100);
      } catch (InterruptedException exception) {
        Thread.currentThread().interrupt();
        break;
      }
    }
    return !processHandle.isAlive();
  }

  private static void ensureDatabaseExists(EmbeddedPostgres postgres, String databaseName) {
    try (Connection connection = postgres.getPostgresDatabase().getConnection();
        Statement statement = connection.createStatement()) {
      if (databaseExists(statement, databaseName)) {
        return;
      }

      statement.execute("CREATE DATABASE " + databaseName);
      LOGGER.info("Created embedded Postgres database '{}'.", databaseName);
    } catch (SQLException exception) {
      throw new IllegalStateException("Failed to initialize desktop database.", exception);
    }
  }

  private static boolean databaseExists(Statement statement, String databaseName)
      throws SQLException {
    String query =
        "SELECT 1 FROM pg_database WHERE datname = '" + databaseName.replace("'", "''") + "'";

    try (ResultSet resultSet = statement.executeQuery(query)) {
      return resultSet.next();
    }
  }

  private static String firstNonBlank(String value) {
    if (value == null) {
      return null;
    }

    String trimmed = value.trim();
    return trimmed.isEmpty() ? null : trimmed;
  }

  private static java.util.OptionalLong parsePid(String pidText) {
    try {
      return java.util.OptionalLong.of(Long.parseLong(pidText));
    } catch (NumberFormatException exception) {
      return java.util.OptionalLong.empty();
    }
  }
}
