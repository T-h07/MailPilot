package com.mailpilot.service;

import com.mailpilot.api.error.ApiBadRequestException;
import com.mailpilot.api.error.ApiConflictException;
import com.mailpilot.api.error.ApiNotFoundException;
import com.mailpilot.api.model.MailboxQueryResponse;
import com.mailpilot.api.model.ViewLabelRequest;
import com.mailpilot.api.model.ViewLabelResponse;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ViewLabelService {

  private static final int MAX_LABEL_NAME_LENGTH = 30;
  private static final int MAX_SORT_ORDER = 9999;
  private static final Set<String> ALLOWED_COLOR_TOKENS = Set.of(
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

  public ViewLabelService(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public List<ViewLabelResponse> listLabels(UUID viewId) {
    ensureViewExists(viewId);
    return jdbcTemplate.query(
      """
      SELECT id, view_id, name, color_token, sort_order
      FROM view_labels
      WHERE view_id = ?
      ORDER BY sort_order ASC, name ASC
      """,
      (resultSet, rowNum) -> mapLabel(resultSet),
      viewId
    );
  }

  @Transactional
  public ViewLabelResponse createLabel(UUID viewId, ViewLabelRequest request) {
    ensureViewExists(viewId);
    NormalizedLabelInput input = normalizeAndValidate(request);
    UUID labelId = UUID.randomUUID();

    try {
      jdbcTemplate.update(
        """
        INSERT INTO view_labels (id, view_id, name, color_token, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, now(), now())
        """,
        labelId,
        viewId,
        input.name(),
        input.colorToken(),
        input.sortOrder()
      );
    } catch (DuplicateKeyException exception) {
      throw new ApiConflictException("Label name already exists for this view");
    }

    return getLabel(viewId, labelId);
  }

  @Transactional
  public ViewLabelResponse updateLabel(UUID viewId, UUID labelId, ViewLabelRequest request) {
    ensureViewExists(viewId);
    NormalizedLabelInput input = normalizeAndValidate(request);

    try {
      int updatedRows = jdbcTemplate.update(
        """
        UPDATE view_labels
        SET name = ?, color_token = ?, sort_order = ?, updated_at = now()
        WHERE id = ? AND view_id = ?
        """,
        input.name(),
        input.colorToken(),
        input.sortOrder(),
        labelId,
        viewId
      );
      if (updatedRows == 0) {
        throw new ApiNotFoundException("View label not found");
      }
    } catch (DuplicateKeyException exception) {
      throw new ApiConflictException("Label name already exists for this view");
    }

    return getLabel(viewId, labelId);
  }

  @Transactional
  public void deleteLabel(UUID viewId, UUID labelId) {
    ensureViewExists(viewId);
    int deletedRows = jdbcTemplate.update("DELETE FROM view_labels WHERE id = ? AND view_id = ?", labelId, viewId);
    if (deletedRows == 0) {
      throw new ApiNotFoundException("View label not found");
    }
  }

  public List<ViewLabelResponse> listMessageLabels(UUID viewId, UUID messageId) {
    ensureViewExists(viewId);
    ensureMessageExists(messageId);
    return jdbcTemplate.query(
      """
      SELECT vl.id, vl.view_id, vl.name, vl.color_token, vl.sort_order
      FROM message_view_labels mvl
      JOIN view_labels vl ON vl.id = mvl.label_id
      WHERE mvl.view_id = ? AND mvl.message_id = ?
      ORDER BY vl.sort_order ASC, vl.name ASC
      """,
      (resultSet, rowNum) -> mapLabel(resultSet),
      viewId,
      messageId
    );
  }

  @Transactional
  public void replaceMessageLabels(UUID viewId, UUID messageId, List<UUID> labelIds) {
    ensureViewExists(viewId);
    ensureMessageExists(messageId);
    List<UUID> normalizedLabelIds = normalizeLabelIds(labelIds);
    validateLabelsBelongToView(viewId, normalizedLabelIds);

    jdbcTemplate.update(
      "DELETE FROM message_view_labels WHERE view_id = ? AND message_id = ?",
      viewId,
      messageId
    );

    if (normalizedLabelIds.isEmpty()) {
      return;
    }

    jdbcTemplate.batchUpdate(
      """
      INSERT INTO message_view_labels (view_id, message_id, label_id, created_at)
      VALUES (?, ?, ?, now())
      ON CONFLICT (view_id, message_id, label_id) DO NOTHING
      """,
      normalizedLabelIds,
      100,
      (preparedStatement, labelId) -> {
        preparedStatement.setObject(1, viewId);
        preparedStatement.setObject(2, messageId);
        preparedStatement.setObject(3, labelId);
      }
    );
  }

  public Map<UUID, List<MailboxQueryResponse.ViewLabel>> loadViewLabelsByMessageIds(UUID viewId, List<UUID> messageIds) {
    if (messageIds == null || messageIds.isEmpty()) {
      return Map.of();
    }

    String sql =
      """
      SELECT mvl.message_id, vl.id, vl.name, vl.color_token
      FROM message_view_labels mvl
      JOIN view_labels vl ON vl.id = mvl.label_id
      WHERE mvl.view_id = ? AND mvl.message_id IN (
      """
        + placeholders(messageIds.size())
        + ") ORDER BY mvl.message_id, vl.sort_order ASC, vl.name ASC";

    List<Object> params = new ArrayList<>();
    params.add(viewId);
    params.addAll(messageIds);

    List<Map<String, Object>> rows = jdbcTemplate.queryForList(sql, params.toArray());
    Map<UUID, List<MailboxQueryResponse.ViewLabel>> labelsByMessageId = new java.util.HashMap<>();
    for (Map<String, Object> row : rows) {
      UUID messageId = (UUID) row.get("message_id");
      UUID labelId = (UUID) row.get("id");
      String name = row.get("name") == null ? "" : row.get("name").toString();
      String colorToken = row.get("color_token") == null ? "gray" : row.get("color_token").toString();
      if (messageId == null || labelId == null || name.isBlank()) {
        continue;
      }
      labelsByMessageId.computeIfAbsent(messageId, ignored -> new ArrayList<>()).add(
        new MailboxQueryResponse.ViewLabel(labelId, name, colorToken)
      );
    }
    return labelsByMessageId;
  }

  private void ensureViewExists(UUID viewId) {
    Integer count = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM views WHERE id = ?", Integer.class, viewId);
    if (count == null || count == 0) {
      throw new ApiNotFoundException("View not found");
    }
  }

  private void ensureMessageExists(UUID messageId) {
    Integer count = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM messages WHERE id = ?", Integer.class, messageId);
    if (count == null || count == 0) {
      throw new ApiNotFoundException("Message not found");
    }
  }

  private void validateLabelsBelongToView(UUID viewId, List<UUID> labelIds) {
    if (labelIds.isEmpty()) {
      return;
    }
    List<Object> params = new ArrayList<>();
    params.add(viewId);
    params.addAll(labelIds);

    Integer count = jdbcTemplate.queryForObject(
      "SELECT COUNT(*) FROM view_labels WHERE view_id = ? AND id IN (" + placeholders(labelIds.size()) + ")",
      Integer.class,
      params.toArray()
    );
    if (count == null || count != labelIds.size()) {
      throw new ApiBadRequestException("All labelIds must belong to the specified view");
    }
  }

  private ViewLabelResponse getLabel(UUID viewId, UUID labelId) {
    return jdbcTemplate.query(
      """
      SELECT id, view_id, name, color_token, sort_order
      FROM view_labels
      WHERE id = ? AND view_id = ?
      """,
      (resultSet, rowNum) -> mapLabel(resultSet),
      labelId,
      viewId
    ).stream().findFirst().orElseThrow(() -> new ApiNotFoundException("View label not found"));
  }

  private NormalizedLabelInput normalizeAndValidate(ViewLabelRequest request) {
    if (request == null) {
      throw new ApiBadRequestException("Request body is required");
    }

    String name = safeTrim(request.name());
    if (name.isBlank() || name.length() > MAX_LABEL_NAME_LENGTH) {
      throw new ApiBadRequestException("name must be between 1 and 30 characters");
    }

    String colorToken = safeTrim(request.colorToken()).toLowerCase();
    if (!ALLOWED_COLOR_TOKENS.contains(colorToken)) {
      throw new ApiBadRequestException("colorToken must be one of: gold,purple,blue,green,red,orange,pink,teal,gray");
    }

    int sortOrder = request.sortOrder() == null ? 0 : request.sortOrder();
    if (sortOrder < 0 || sortOrder > MAX_SORT_ORDER) {
      throw new ApiBadRequestException("sortOrder must be between 0 and 9999");
    }

    return new NormalizedLabelInput(name, colorToken, sortOrder);
  }

  private List<UUID> normalizeLabelIds(List<UUID> labelIds) {
    if (labelIds == null || labelIds.isEmpty()) {
      return List.of();
    }

    Set<UUID> deduped = new LinkedHashSet<>();
    for (UUID labelId : labelIds) {
      if (labelId != null) {
        deduped.add(labelId);
      }
    }
    return List.copyOf(deduped);
  }

  private ViewLabelResponse mapLabel(ResultSet resultSet) throws SQLException {
    return new ViewLabelResponse(
      resultSet.getObject("id", UUID.class),
      resultSet.getObject("view_id", UUID.class),
      resultSet.getString("name"),
      resultSet.getString("color_token"),
      resultSet.getInt("sort_order")
    );
  }

  private String placeholders(int count) {
    return String.join(",", Collections.nCopies(count, "?"));
  }

  private String safeTrim(String value) {
    return value == null ? "" : value.trim();
  }

  private record NormalizedLabelInput(String name, String colorToken, int sortOrder) {}
}
