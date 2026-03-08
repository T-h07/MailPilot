package com.mailpilot.config;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class DesktopRuntimeBootstrapTest {

  @Test
  void desktopProfileDetectionAcceptsCommandLineProfile() {
    assertTrue(
        DesktopRuntimeBootstrap.isDesktopProfileActive(
            new String[] {"--spring.profiles.active=desktop"}));
  }

  @Test
  void desktopProfileDetectionAcceptsMixedProfiles() {
    assertTrue(
        DesktopRuntimeBootstrap.isDesktopProfileActive(
            new String[] {"--spring.profiles.active=dev,desktop"}));
  }

  @Test
  void desktopProfileDetectionRejectsMissingDesktopProfile() {
    assertFalse(
        DesktopRuntimeBootstrap.isDesktopProfileActive(
            new String[] {"--spring.profiles.active=dev"}));
  }

  @Test
  void removeStalePostmasterPidDeletesOrphanedMetadata(@TempDir Path tempDir) throws IOException {
    Files.writeString(tempDir.resolve("postmaster.pid"), "999999\n");
    Files.writeString(tempDir.resolve("postmaster.opts"), "postgres opts");

    DesktopRuntimeBootstrap.removeStalePostmasterPid(tempDir);

    assertFalse(Files.exists(tempDir.resolve("postmaster.pid")));
    assertFalse(Files.exists(tempDir.resolve("postmaster.opts")));
  }

  @Test
  void removeStalePostmasterPidKeepsLiveProcessMetadata(@TempDir Path tempDir) throws IOException {
    Files.writeString(
        tempDir.resolve("postmaster.pid"), ProcessHandle.current().pid() + System.lineSeparator());
    Files.writeString(tempDir.resolve("postmaster.opts"), "postgres opts");

    DesktopRuntimeBootstrap.removeStalePostmasterPid(tempDir);

    assertTrue(Files.exists(tempDir.resolve("postmaster.pid")));
    assertTrue(Files.exists(tempDir.resolve("postmaster.opts")));
  }
}
