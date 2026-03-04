package com.mailpilot.api;

import com.mailpilot.service.DbPingService;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
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
  public ResponseEntity<Map<String, String>> ping() {
    try {
      dbPingService.ping();
      return ResponseEntity.ok(Map.of("status", "ok"));
    } catch (RuntimeException ex) {
      Map<String, String> response = new LinkedHashMap<>();
      response.put("status", "error");
      response.put("message", "Database ping failed");
      return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(response);
    }
  }
}
