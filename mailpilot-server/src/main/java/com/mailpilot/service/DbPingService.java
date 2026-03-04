package com.mailpilot.service;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class DbPingService {

  private final JdbcTemplate jdbcTemplate;

  public DbPingService(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public void ping() {
    Integer result = jdbcTemplate.queryForObject("SELECT 1", Integer.class);
    if (result == null || result != 1) {
      throw new IllegalStateException("Unexpected database response");
    }
  }
}
