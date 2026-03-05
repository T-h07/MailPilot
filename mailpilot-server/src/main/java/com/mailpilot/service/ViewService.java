package com.mailpilot.service;

import com.mailpilot.api.error.ApiBadRequestException;
import com.mailpilot.api.error.ApiConflictException;
import com.mailpilot.api.error.ApiNotFoundException;
import com.mailpilot.api.model.ViewResponse;
import com.mailpilot.api.model.ViewUpsertRequest;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ViewService {

  private static final int MAX_RULE_ITEMS = 50;
  private static final int MAX_RULE_ITEM_LENGTH = 120;

  private final JdbcTemplate jdbcTemplate;

  public ViewService(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public List<ViewResponse> listViews() {
    List<ViewRow> viewRows = jdbcTemplate.query(
      """
      SELECT id, name, priority, sort_order, icon, accounts_scope, unread_only, updated_at
      FROM views
      ORDER BY sort_order ASC, name ASC
      """,
      (resultSet, rowNum) -> mapViewRow(resultSet)
    );

    return assembleResponses(viewRows);
  }

  public ViewResponse getView(UUID viewId) {
    ViewRow row = jdbcTemplate.query(
      """
      SELECT id, name, priority, sort_order, icon, accounts_scope, unread_only, updated_at
      FROM views
      WHERE id = ?
      """,
      (resultSet, rowNum) -> mapViewRow(resultSet),
      viewId
    ).stream().findFirst().orElseThrow(() -> new ApiNotFoundException("View not found"));

    return assembleResponses(List.of(row)).getFirst();
  }

  @Transactional
  public ViewResponse createView(ViewUpsertRequest request) {
    NormalizedViewInput input = normalizeAndValidate(request);
    UUID viewId = UUID.randomUUID();

    try {
      jdbcTemplate.update(
        """
        INSERT INTO views (
          id,
          name,
          priority,
          sort_order,
          icon,
          accounts_scope,
          unread_only,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, now(), now())
        """,
        viewId,
        input.name(),
        input.priority(),
        input.sortOrder(),
        input.icon(),
        input.scopeType(),
        input.unreadOnly()
      );
    } catch (DuplicateKeyException exception) {
      throw new ApiConflictException("View name already exists");
    }

    replaceViewAccounts(viewId, input.selectedAccountIds());
    replaceViewRules(viewId, input.senderDomains(), input.senderEmails(), input.keywords());

    return getView(viewId);
  }

  @Transactional
  public ViewResponse updateView(UUID viewId, ViewUpsertRequest request) {
    NormalizedViewInput input = normalizeAndValidate(request);

    try {
      int updatedRows = jdbcTemplate.update(
        """
        UPDATE views
        SET
          name = ?,
          priority = ?,
          sort_order = ?,
          icon = ?,
          accounts_scope = ?,
          unread_only = ?,
          updated_at = now()
        WHERE id = ?
        """,
        input.name(),
        input.priority(),
        input.sortOrder(),
        input.icon(),
        input.scopeType(),
        input.unreadOnly(),
        viewId
      );
      if (updatedRows == 0) {
        throw new ApiNotFoundException("View not found");
      }
    } catch (DuplicateKeyException exception) {
      throw new ApiConflictException("View name already exists");
    }

    jdbcTemplate.update("DELETE FROM view_accounts WHERE view_id = ?", viewId);
    jdbcTemplate.update("DELETE FROM view_rules WHERE view_id = ?", viewId);
    replaceViewAccounts(viewId, input.selectedAccountIds());
    replaceViewRules(viewId, input.senderDomains(), input.senderEmails(), input.keywords());

    return getView(viewId);
  }

  @Transactional
  public void deleteView(UUID viewId) {
    int deletedRows = jdbcTemplate.update("DELETE FROM views WHERE id = ?", viewId);
    if (deletedRows == 0) {
      throw new ApiNotFoundException("View not found");
    }
  }

  public ViewDefinition getViewDefinition(UUID viewId) {
    ViewResponse view = getView(viewId);
    return new ViewDefinition(
      view.id(),
      view.name(),
      view.scopeType(),
      view.selectedAccountIds(),
      view.rules().senderDomains(),
      view.rules().senderEmails(),
      view.rules().keywords(),
      view.rules().unreadOnly()
    );
  }

  public record ViewDefinition(
    UUID id,
    String name,
    String scopeType,
    List<UUID> selectedAccountIds,
    List<String> senderDomains,
    List<String> senderEmails,
    List<String> keywords,
    boolean unreadOnly
  ) {}

  private List<ViewResponse> assembleResponses(List<ViewRow> viewRows) {
    if (viewRows.isEmpty()) {
      return List.of();
    }

    List<UUID> viewIds = viewRows.stream().map(ViewRow::id).toList();
    Map<UUID, List<UUID>> selectedAccountsByViewId = loadViewAccounts(viewIds);
    Map<UUID, RuleAccumulator> rulesByViewId = loadViewRules(viewIds);

    List<ViewResponse> responses = new ArrayList<>(viewRows.size());
    for (ViewRow row : viewRows) {
      RuleAccumulator rules = rulesByViewId.getOrDefault(row.id(), new RuleAccumulator());
      responses.add(
        new ViewResponse(
          row.id(),
          row.name(),
          row.priority(),
          row.sortOrder(),
          row.icon(),
          row.scopeType(),
          selectedAccountsByViewId.getOrDefault(row.id(), List.of()),
          new ViewResponse.Rules(
            List.copyOf(rules.senderDomains()),
            List.copyOf(rules.senderEmails()),
            List.copyOf(rules.keywords()),
            row.unreadOnly()
          ),
          row.updatedAt()
        )
      );
    }

    return responses;
  }

  private Map<UUID, List<UUID>> loadViewAccounts(List<UUID> viewIds) {
    if (viewIds.isEmpty()) {
      return Map.of();
    }

    String sql =
      "SELECT view_id, account_id FROM view_accounts WHERE view_id IN ("
        + placeholders(viewIds.size())
        + ") ORDER BY view_id";

    Map<UUID, List<UUID>> selectedByView = new java.util.HashMap<>();
    List<Map<String, Object>> rows = jdbcTemplate.queryForList(sql, viewIds.toArray());
    for (Map<String, Object> row : rows) {
      UUID viewId = (UUID) row.get("view_id");
      UUID accountId = (UUID) row.get("account_id");
      if (viewId == null || accountId == null) {
        continue;
      }
      selectedByView.computeIfAbsent(viewId, ignored -> new ArrayList<>()).add(accountId);
    }

    return selectedByView;
  }

  private Map<UUID, RuleAccumulator> loadViewRules(List<UUID> viewIds) {
    if (viewIds.isEmpty()) {
      return Map.of();
    }

    String sql =
      "SELECT view_id, rule_type, rule_value FROM view_rules WHERE view_id IN ("
        + placeholders(viewIds.size())
        + ") ORDER BY view_id";

    Map<UUID, RuleAccumulator> rulesByView = new java.util.HashMap<>();
    List<Map<String, Object>> rows = jdbcTemplate.queryForList(sql, viewIds.toArray());
    for (Map<String, Object> row : rows) {
      UUID viewId = (UUID) row.get("view_id");
      String ruleType = Objects.toString(row.get("rule_type"), "");
      String ruleValue = Objects.toString(row.get("rule_value"), "");
      if (viewId == null || ruleType.isBlank() || ruleValue.isBlank()) {
        continue;
      }

      RuleAccumulator accumulator = rulesByView.computeIfAbsent(viewId, ignored -> new RuleAccumulator());
      switch (ruleType) {
        case "DOMAIN" -> accumulator.senderDomains().add(ruleValue);
        case "SENDER_EMAIL" -> accumulator.senderEmails().add(ruleValue);
        case "KEYWORD" -> accumulator.keywords().add(ruleValue);
        default -> {
          // Ignore unknown types for forward compatibility.
        }
      }
    }

    return rulesByView;
  }

  private void replaceViewAccounts(UUID viewId, List<UUID> accountIds) {
    if (accountIds.isEmpty()) {
      return;
    }

    jdbcTemplate.batchUpdate(
      """
      INSERT INTO view_accounts (view_id, account_id)
      VALUES (?, ?)
      ON CONFLICT (view_id, account_id) DO NOTHING
      """,
      accountIds,
      100,
      (preparedStatement, accountId) -> {
        preparedStatement.setObject(1, viewId);
        preparedStatement.setObject(2, accountId);
      }
    );
  }

  private void replaceViewRules(
    UUID viewId,
    List<String> senderDomains,
    List<String> senderEmails,
    List<String> keywords
  ) {
    List<RuleRow> rows = new ArrayList<>();
    senderDomains.forEach(domain -> rows.add(new RuleRow("DOMAIN", domain)));
    senderEmails.forEach(email -> rows.add(new RuleRow("SENDER_EMAIL", email)));
    keywords.forEach(keyword -> rows.add(new RuleRow("KEYWORD", keyword)));

    if (rows.isEmpty()) {
      return;
    }

    jdbcTemplate.batchUpdate(
      """
      INSERT INTO view_rules (id, view_id, rule_type, rule_value)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (view_id, rule_type, rule_value) DO NOTHING
      """,
      rows,
      200,
      (preparedStatement, row) -> {
        preparedStatement.setObject(1, UUID.randomUUID());
        preparedStatement.setObject(2, viewId);
        preparedStatement.setString(3, row.ruleType());
        preparedStatement.setString(4, row.ruleValue());
      }
    );
  }

  private NormalizedViewInput normalizeAndValidate(ViewUpsertRequest request) {
    if (request == null) {
      throw new ApiBadRequestException("Request body is required");
    }

    String name = safeTrim(request.name());
    if (name.length() < 2 || name.length() > 50) {
      throw new ApiBadRequestException("name must be between 2 and 50 characters");
    }

    Integer priority = request.priority();
    if (priority == null || priority < 1 || priority > 5) {
      throw new ApiBadRequestException("priority must be between 1 and 5");
    }

    Integer sortOrder = request.sortOrder();
    if (sortOrder == null || sortOrder < 0 || sortOrder > 9999) {
      throw new ApiBadRequestException("sortOrder must be between 0 and 9999");
    }

    String scopeType = safeTrim(request.scopeType()).toUpperCase(Locale.ROOT);
    if (!"ALL".equals(scopeType) && !"SELECTED".equals(scopeType)) {
      throw new ApiBadRequestException("scopeType must be ALL or SELECTED");
    }

    String icon = safeTrim(request.icon());
    if (icon.isBlank()) {
      icon = null;
    }

    List<UUID> selectedAccountIds = normalizeUuidList(request.selectedAccountIds());
    if ("SELECTED".equals(scopeType) && selectedAccountIds.isEmpty()) {
      throw new ApiBadRequestException("selectedAccountIds must be provided when scopeType=SELECTED");
    }
    if ("ALL".equals(scopeType)) {
      selectedAccountIds = List.of();
    }

    validateAccountIdsExist(selectedAccountIds);

    ViewUpsertRequest.Rules rules = request.rules();
    List<String> senderDomains = normalizeRuleItems(rules == null ? null : rules.senderDomains(), true);
    List<String> senderEmails = normalizeRuleItems(rules == null ? null : rules.senderEmails(), true);
    List<String> keywords = normalizeRuleItems(rules == null ? null : rules.keywords(), false);
    boolean unreadOnly = rules != null && Boolean.TRUE.equals(rules.unreadOnly());

    return new NormalizedViewInput(
      name,
      priority,
      sortOrder,
      icon,
      scopeType,
      selectedAccountIds,
      senderDomains,
      senderEmails,
      keywords,
      unreadOnly
    );
  }

  private void validateAccountIdsExist(List<UUID> accountIds) {
    if (accountIds.isEmpty()) {
      return;
    }

    Integer count = jdbcTemplate.queryForObject(
      "SELECT COUNT(*) FROM accounts WHERE id IN (" + placeholders(accountIds.size()) + ")",
      Integer.class,
      accountIds.toArray()
    );

    if (count == null || count != accountIds.size()) {
      throw new ApiBadRequestException("selectedAccountIds contains unknown account ids");
    }
  }

  private List<UUID> normalizeUuidList(List<UUID> values) {
    if (values == null || values.isEmpty()) {
      return List.of();
    }

    Set<UUID> deduped = new LinkedHashSet<>();
    for (UUID value : values) {
      if (value != null) {
        deduped.add(value);
      }
    }
    return List.copyOf(deduped);
  }

  private List<String> normalizeRuleItems(List<String> values, boolean forceLowercase) {
    if (values == null || values.isEmpty()) {
      return List.of();
    }

    if (values.size() > MAX_RULE_ITEMS) {
      throw new ApiBadRequestException("Rule list size cannot exceed 50");
    }

    Set<String> deduped = new LinkedHashSet<>();
    for (String value : values) {
      String normalized = safeTrim(value);
      if (normalized.isBlank()) {
        continue;
      }
      if (normalized.length() > MAX_RULE_ITEM_LENGTH) {
        throw new ApiBadRequestException("Rule item length cannot exceed 120 characters");
      }
      if (forceLowercase) {
        normalized = normalized.toLowerCase(Locale.ROOT);
      }
      deduped.add(normalized);
    }

    if (deduped.size() > MAX_RULE_ITEMS) {
      throw new ApiBadRequestException("Rule list size cannot exceed 50");
    }

    return List.copyOf(deduped);
  }

  private ViewRow mapViewRow(ResultSet resultSet) throws SQLException {
    return new ViewRow(
      resultSet.getObject("id", UUID.class),
      resultSet.getString("name"),
      resultSet.getInt("priority"),
      resultSet.getInt("sort_order"),
      resultSet.getString("icon"),
      resultSet.getString("accounts_scope"),
      resultSet.getBoolean("unread_only"),
      resultSet.getObject("updated_at", OffsetDateTime.class)
    );
  }

  private String placeholders(int count) {
    return String.join(",", Collections.nCopies(count, "?"));
  }

  private String safeTrim(String value) {
    return value == null ? "" : value.trim();
  }

  private record RuleRow(String ruleType, String ruleValue) {}

  private record ViewRow(
    UUID id,
    String name,
    int priority,
    int sortOrder,
    String icon,
    String scopeType,
    boolean unreadOnly,
    OffsetDateTime updatedAt
  ) {}

  private record RuleAccumulator(
    List<String> senderDomains,
    List<String> senderEmails,
    List<String> keywords
  ) {
    private RuleAccumulator() {
      this(new ArrayList<>(), new ArrayList<>(), new ArrayList<>());
    }
  }

  private record NormalizedViewInput(
    String name,
    int priority,
    int sortOrder,
    String icon,
    String scopeType,
    List<UUID> selectedAccountIds,
    List<String> senderDomains,
    List<String> senderEmails,
    List<String> keywords,
    boolean unreadOnly
  ) {}
}
