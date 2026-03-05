package com.mailpilot.config;

import com.mailpilot.service.oauth.GoogleOAuthClientConfigService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

@Component
public class GoogleOAuthStartupLogger {

  private static final Logger LOGGER = LoggerFactory.getLogger(GoogleOAuthStartupLogger.class);
  private final GoogleOAuthClientConfigService googleOAuthClientConfigService;

  public GoogleOAuthStartupLogger(GoogleOAuthClientConfigService googleOAuthClientConfigService) {
    this.googleOAuthClientConfigService = googleOAuthClientConfigService;
  }

  @EventListener(ApplicationReadyEvent.class)
  public void logConfig() {
    GoogleOAuthClientConfigService.GoogleOAuthConfigCheck check =
      googleOAuthClientConfigService.checkConfiguration();

    LOGGER.info("OAuth configured: {}", check.configured());
    if (check.path() != null) {
      LOGGER.info("Google OAuth JSON path: {}", check.path());
    }
  }
}
