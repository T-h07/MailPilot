package com.mailpilot.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

@Component
public class StartupProfileLogger {

  private static final Logger LOGGER = LoggerFactory.getLogger(StartupProfileLogger.class);
  private final Environment environment;

  public StartupProfileLogger(Environment environment) {
    this.environment = environment;
  }

  @EventListener(ApplicationReadyEvent.class)
  public void logActiveProfiles() {
    String[] activeProfiles = environment.getActiveProfiles();
    String profileSummary =
      activeProfiles.length == 0 ? "default" : String.join(", ", activeProfiles);
    LOGGER.info("Active Spring profile(s): {}", profileSummary);
  }
}
