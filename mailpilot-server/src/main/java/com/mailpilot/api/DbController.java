package com.mailpilot.api;

import com.mailpilot.api.error.ApiInternalException;
import com.mailpilot.service.DbPingService;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/db")
public class DbController {

  private final DbPingService dbPingService;

  public DbController(DbPingService dbPingService) {
    this.dbPingService = dbPingService;
  }

  @GetMapping("/ping")
  public Map<String, String> ping() {
    try {
      dbPingService.ping();
      return Map.of("status", "ok");
    } catch (RuntimeException ex) {
      throw new ApiInternalException("Database ping failed");
    }
  }
}
