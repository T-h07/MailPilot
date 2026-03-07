package com.mailpilot.config;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

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
}
