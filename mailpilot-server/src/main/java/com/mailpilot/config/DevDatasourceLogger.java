package com.mailpilot.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.annotation.Profile;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

@Profile("dev")
@Component
public class DevDatasourceLogger {

  private static final Logger LOGGER = LoggerFactory.getLogger(DevDatasourceLogger.class);
  private final boolean logDbUrl;
  private final String dbUrl;

  public DevDatasourceLogger(
    @Value("${mailpilot.startup.log-db-url:true}") boolean logDbUrl,
    @Value("${spring.datasource.url:}") String dbUrl
  ) {
    this.logDbUrl = logDbUrl;
    this.dbUrl = dbUrl;
  }

  @EventListener(ApplicationReadyEvent.class)
  public void logDatasourceUrl() {
    if (!logDbUrl || dbUrl.isBlank()) {
      return;
    }
    LOGGER.info("Dev datasource URL: {}", sanitize(dbUrl));
  }

  private String sanitize(String url) {
    return url.replaceAll("(?i)(password=)[^&;]+", "$1***");
  }
}
