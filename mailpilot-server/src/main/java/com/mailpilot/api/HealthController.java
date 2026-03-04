package com.mailpilot.api;

import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HealthController {

  private final String applicationName;

  public HealthController(@Value("${spring.application.name}") String applicationName) {
    this.applicationName = applicationName;
  }

  @GetMapping("/api/health")
  public Map<String, Object> health() {
    Map<String, Object> response = new LinkedHashMap<>();
    response.put("status", "ok");
    response.put("app", applicationName);
    response.put("time", OffsetDateTime.now());
    return response;
  }
}
