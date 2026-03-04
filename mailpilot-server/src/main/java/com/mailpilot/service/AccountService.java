package com.mailpilot.service;

import com.mailpilot.api.model.AccountResponse;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class AccountService {

  private final JdbcTemplate jdbcTemplate;

  public AccountService(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public List<AccountResponse> listAccounts() {
    return jdbcTemplate.query(
      "SELECT id, email, provider, status, last_sync_at FROM accounts ORDER BY provider, email",
      (resultSet, rowNum) ->
        new AccountResponse(
          resultSet.getObject("id", java.util.UUID.class),
          resultSet.getString("email"),
          resultSet.getString("provider"),
          resultSet.getString("status"),
          resultSet.getObject("last_sync_at", java.time.OffsetDateTime.class)
        )
    );
  }
}
