package com.mailpilot.repository;

import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class LocalAuthRepository {

  private final JdbcTemplate jdbcTemplate;

  public LocalAuthRepository(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public boolean hasPassword() {
    Integer count =
        jdbcTemplate.queryForObject("SELECT COUNT(*) FROM local_auth WHERE id = 1", Integer.class);
    return count != null && count > 0;
  }

  public Optional<LocalAuthRow> getLocalAuth() {
    List<LocalAuthRow> rows =
        jdbcTemplate.query(
            """
      SELECT password_hash, algo
      FROM local_auth
      WHERE id = 1
      """,
            (resultSet, rowNum) ->
                new LocalAuthRow(
                    resultSet.getString("password_hash"), resultSet.getString("algo")));
    return rows.stream().findFirst();
  }

  public void insertPasswordHash(String passwordHash, String algo) {
    jdbcTemplate.update(
        """
      INSERT INTO local_auth (id, password_hash, algo, created_at, updated_at)
      VALUES (1, ?, ?, now(), now())
      """,
        passwordHash,
        algo);
  }

  public record LocalAuthRow(String passwordHash, String algo) {}
}
