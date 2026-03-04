package com.mailpilot.service;

import com.mailpilot.api.error.ApiBadRequestException;
import com.mailpilot.api.error.ApiConflictException;
import com.mailpilot.api.error.ApiNotFoundException;
import com.mailpilot.api.model.SenderRuleRequest;
import com.mailpilot.api.model.SenderRuleResponse;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SenderRuleService {

  private static final Pattern EMAIL_PATTERN =
    Pattern.compile("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$");
  private static final Pattern DOMAIN_PATTERN =
    Pattern.compile("^(?=.{1,253}$)(?!-)(?:[a-z0-9-]{1,63}\\.)+[a-z]{2,63}$");
  private static final Set<String> ACCENT_TOKENS = Set.of(
    "gold",
    "purple",
    "blue",
    "green",
    "red",
    "orange",
    "pink",
    "teal",
    "gray"
  );

  private final JdbcTemplate jdbcTemplate;

  public SenderRuleService(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public List<SenderRuleResponse> listRules() {
    return jdbcTemplate.query(
      """
      SELECT id, match_type, match_value, label, accent, created_at
      FROM sender_rules
      ORDER BY CASE match_type WHEN 'EMAIL' THEN 0 ELSE 1 END, match_value ASC
      """,
      (resultSet, rowNum) -> mapRow(resultSet)
    );
  }

  @Transactional
  public SenderRuleResponse createRule(SenderRuleRequest request) {
    NormalizedRuleInput input = normalizeAndValidate(request);
    UUID ruleId = UUID.randomUUID();

    try {
      jdbcTemplate.update(
        """
        INSERT INTO sender_rules (id, match_type, match_value, label, accent, created_at)
        VALUES (?, ?, ?, ?, ?, now())
        """,
        ruleId,
        input.matchType(),
        input.matchValue(),
        input.label(),
        input.accent()
      );
    } catch (DuplicateKeyException exception) {
      throw new ApiConflictException("Sender rule already exists");
    }

    return getRuleById(ruleId);
  }

  @Transactional
  public SenderRuleResponse updateRule(UUID ruleId, SenderRuleRequest request) {
    NormalizedRuleInput input = normalizeAndValidate(request);

    try {
      int updatedRows = jdbcTemplate.update(
        """
        UPDATE sender_rules
        SET match_type = ?, match_value = ?, label = ?, accent = ?
        WHERE id = ?
        """,
        input.matchType(),
        input.matchValue(),
        input.label(),
        input.accent(),
        ruleId
      );
      if (updatedRows == 0) {
        throw new ApiNotFoundException("Sender rule not found");
      }
    } catch (DuplicateKeyException exception) {
      throw new ApiConflictException("Sender rule already exists");
    }

    return getRuleById(ruleId);
  }

  @Transactional
  public void deleteRule(UUID ruleId) {
    int deletedRows = jdbcTemplate.update("DELETE FROM sender_rules WHERE id = ?", ruleId);
    if (deletedRows == 0) {
      throw new ApiNotFoundException("Sender rule not found");
    }
  }

  private SenderRuleResponse getRuleById(UUID ruleId) {
    return jdbcTemplate.query(
      """
      SELECT id, match_type, match_value, label, accent, created_at
      FROM sender_rules
      WHERE id = ?
      """,
      (resultSet, rowNum) -> mapRow(resultSet),
      ruleId
    ).stream().findFirst().orElseThrow(() -> new ApiNotFoundException("Sender rule not found"));
  }

  private NormalizedRuleInput normalizeAndValidate(SenderRuleRequest request) {
    if (request == null) {
      throw new ApiBadRequestException("Request body is required");
    }

    String matchType = safeTrim(request.matchType()).toUpperCase(Locale.ROOT);
    if (!"EMAIL".equals(matchType) && !"DOMAIN".equals(matchType)) {
      throw new ApiBadRequestException("matchType must be EMAIL or DOMAIN");
    }

    String matchValue = safeTrim(request.matchValue()).toLowerCase(Locale.ROOT);
    if (matchValue.isBlank()) {
      throw new ApiBadRequestException("matchValue is required");
    }

    if ("EMAIL".equals(matchType)) {
      if (!EMAIL_PATTERN.matcher(matchValue).matches()) {
        throw new ApiBadRequestException("matchValue must be a valid email");
      }
    } else {
      if (matchValue.contains("@") || !DOMAIN_PATTERN.matcher(matchValue).matches()) {
        throw new ApiBadRequestException("matchValue must be a valid domain");
      }
    }

    String label = safeTrim(request.label());
    if (label.isBlank()) {
      throw new ApiBadRequestException("label is required");
    }
    if (label.length() > 32) {
      throw new ApiBadRequestException("label must be 32 characters or fewer");
    }

    String accent = safeTrim(request.accent()).toLowerCase(Locale.ROOT);
    if (!ACCENT_TOKENS.contains(accent)) {
      throw new ApiBadRequestException(
        "accent must be one of: gold,purple,blue,green,red,orange,pink,teal,gray"
      );
    }

    return new NormalizedRuleInput(matchType, matchValue, label, accent);
  }

  private SenderRuleResponse mapRow(ResultSet resultSet) throws SQLException {
    return new SenderRuleResponse(
      resultSet.getObject("id", UUID.class),
      resultSet.getString("match_type"),
      resultSet.getString("match_value"),
      resultSet.getString("label"),
      resultSet.getString("accent"),
      resultSet.getObject("created_at", OffsetDateTime.class)
    );
  }

  private String safeTrim(String value) {
    return value == null ? "" : value.trim();
  }

  private record NormalizedRuleInput(String matchType, String matchValue, String label, String accent) {}
}
