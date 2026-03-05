package com.mailpilot.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mailpilot.api.error.ApiBadRequestException;
import com.mailpilot.api.error.ApiInternalException;
import com.mailpilot.api.error.ApiNotFoundException;
import com.mailpilot.api.model.DraftDetailResponse;
import com.mailpilot.api.model.DraftListItemResponse;
import com.mailpilot.api.model.DraftUpsertRequest;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class DraftService {

  private static final int MAX_SEARCH_LENGTH = 200;

  private static final TypeReference<List<DraftDetailResponse.DraftAttachment>> ATTACHMENTS_TYPE = new TypeReference<>() {};

  private final JdbcTemplate jdbcTemplate;
  private final ObjectMapper objectMapper;

  public DraftService(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
    this.jdbcTemplate = jdbcTemplate;
    this.objectMapper = objectMapper;
  }

  public List<DraftListItemResponse> listDrafts(UUID accountId, String q, String sort) {
    SortOrder sortOrder = SortOrder.fromInput(sort);
    String normalizedQuery = normalizeSearchQuery(q);

    List<Object> params = new ArrayList<>();
    StringBuilder sql = new StringBuilder(
      """
      SELECT
        d.id,
        d.account_id,
        a.email AS account_email,
        d.to_text,
        d.subject,
        d.body_text,
        d.updated_at,
        (jsonb_array_length(d.attachments_json) > 0) AS has_attachments
      FROM drafts d
      JOIN accounts a ON a.id = d.account_id
      WHERE 1 = 1
      """
    );

    if (accountId != null) {
      sql.append(" AND d.account_id = ?");
      params.add(accountId);
    }

    if (StringUtils.hasText(normalizedQuery)) {
      sql.append(" AND (d.subject ILIKE ? OR d.to_text ILIKE ? OR d.body_text ILIKE ?)");
      String likePattern = "%" + normalizedQuery + "%";
      params.add(likePattern);
      params.add(likePattern);
      params.add(likePattern);
    }

    sql.append(sortOrder == SortOrder.UPDATED_ASC ? " ORDER BY d.updated_at ASC, d.id ASC" : " ORDER BY d.updated_at DESC, d.id DESC");

    return jdbcTemplate.query(
      sql.toString(),
      (resultSet, rowNum) ->
        new DraftListItemResponse(
          resultSet.getObject("id", UUID.class),
          resultSet.getObject("account_id", UUID.class),
          resultSet.getString("account_email"),
          safeText(resultSet.getString("to_text")),
          safeText(resultSet.getString("subject")),
          buildSnippet(resultSet.getString("body_text")),
          resultSet.getObject("updated_at", OffsetDateTime.class),
          resultSet.getBoolean("has_attachments")
        ),
      params.toArray()
    );
  }

  public DraftDetailResponse getDraft(UUID draftId) {
    DraftRow row = loadDraftRow(draftId);
    return toDetailResponse(row);
  }

  @Transactional
  public DraftDetailResponse createDraft(DraftUpsertRequest request) {
    if (request == null) {
      throw new ApiBadRequestException("Request body is required");
    }
    if (request.accountId() == null) {
      throw new ApiBadRequestException("accountId is required");
    }
    ensureAccountExists(request.accountId());

    UUID draftId = UUID.randomUUID();
    String attachmentsJson = toAttachmentsJson(normalizeAttachments(request.attachments()));
    String bodyHtml = normalizeNullable(request.bodyHtml());

    jdbcTemplate.update(
      """
      INSERT INTO drafts (
        id,
        account_id,
        to_text,
        cc_text,
        bcc_text,
        subject,
        body_text,
        body_html,
        attachments_json,
        status,
        updated_at,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, 'DRAFT', now(), now())
      """,
      draftId,
      request.accountId(),
      normalizeText(request.to()),
      normalizeText(request.cc()),
      normalizeText(request.bcc()),
      normalizeText(request.subject()),
      normalizeText(request.bodyText()),
      bodyHtml,
      attachmentsJson
    );

    return getDraft(draftId);
  }

  @Transactional
  public void updateDraft(UUID draftId, DraftUpsertRequest request) {
    if (request == null) {
      throw new ApiBadRequestException("Request body is required");
    }

    DraftRow existing = loadDraftRow(draftId);
    UUID accountId = request.accountId() != null ? request.accountId() : existing.accountId();
    ensureAccountExists(accountId);

    String to = request.to() != null ? normalizeText(request.to()) : existing.to();
    String cc = request.cc() != null ? normalizeText(request.cc()) : existing.cc();
    String bcc = request.bcc() != null ? normalizeText(request.bcc()) : existing.bcc();
    String subject = request.subject() != null ? normalizeText(request.subject()) : existing.subject();
    String bodyText = request.bodyText() != null ? normalizeText(request.bodyText()) : existing.bodyText();
    String bodyHtml = request.bodyHtml() != null ? normalizeNullable(request.bodyHtml()) : existing.bodyHtml();
    String attachmentsJson = request.attachments() != null
      ? toAttachmentsJson(normalizeAttachments(request.attachments()))
      : existing.attachmentsJson();

    jdbcTemplate.update(
      """
      UPDATE drafts
      SET
        account_id = ?,
        to_text = ?,
        cc_text = ?,
        bcc_text = ?,
        subject = ?,
        body_text = ?,
        body_html = ?,
        attachments_json = ?::jsonb,
        updated_at = now()
      WHERE id = ?
      """,
      accountId,
      to,
      cc,
      bcc,
      subject,
      bodyText,
      bodyHtml,
      attachmentsJson,
      draftId
    );
  }

  @Transactional
  public void deleteDraft(UUID draftId) {
    int deleted = jdbcTemplate.update("DELETE FROM drafts WHERE id = ?", draftId);
    if (deleted == 0) {
      throw new ApiNotFoundException("Draft not found");
    }
  }

  private DraftRow loadDraftRow(UUID draftId) {
    return jdbcTemplate.query(
      """
      SELECT
        d.id,
        d.account_id,
        d.to_text,
        d.cc_text,
        d.bcc_text,
        d.subject,
        d.body_text,
        d.body_html,
        d.attachments_json::text AS attachments_json,
        d.updated_at
      FROM drafts d
      WHERE d.id = ?
      """,
      (resultSet, rowNum) -> mapDraftRow(resultSet),
      draftId
    ).stream().findFirst().orElseThrow(() -> new ApiNotFoundException("Draft not found"));
  }

  private DraftRow mapDraftRow(ResultSet resultSet) throws SQLException {
    return new DraftRow(
      resultSet.getObject("id", UUID.class),
      resultSet.getObject("account_id", UUID.class),
      safeText(resultSet.getString("to_text")),
      safeText(resultSet.getString("cc_text")),
      safeText(resultSet.getString("bcc_text")),
      safeText(resultSet.getString("subject")),
      safeText(resultSet.getString("body_text")),
      resultSet.getString("body_html"),
      resultSet.getString("attachments_json"),
      resultSet.getObject("updated_at", OffsetDateTime.class)
    );
  }

  private DraftDetailResponse toDetailResponse(DraftRow row) {
    return new DraftDetailResponse(
      row.id(),
      row.accountId(),
      row.to(),
      row.cc(),
      row.bcc(),
      row.subject(),
      row.bodyText(),
      row.bodyHtml(),
      parseAttachments(row.attachmentsJson()),
      row.updatedAt()
    );
  }

  private List<DraftDetailResponse.DraftAttachment> normalizeAttachments(List<DraftUpsertRequest.DraftAttachment> attachments) {
    if (attachments == null || attachments.isEmpty()) {
      return List.of();
    }

    List<DraftDetailResponse.DraftAttachment> normalized = new ArrayList<>();
    for (DraftUpsertRequest.DraftAttachment attachment : attachments) {
      if (attachment == null) {
        continue;
      }
      String name = safeText(attachment.name());
      String path = safeText(attachment.path());
      if (name.isBlank() || path.isBlank()) {
        continue;
      }
      Long sizeBytes = attachment.sizeBytes() == null || attachment.sizeBytes() < 0
        ? null
        : attachment.sizeBytes();
      String mime = normalizeNullable(attachment.mime());
      normalized.add(new DraftDetailResponse.DraftAttachment(name, path, sizeBytes, mime));
    }
    return List.copyOf(normalized);
  }

  private String toAttachmentsJson(List<DraftDetailResponse.DraftAttachment> attachments) {
    try {
      return objectMapper.writeValueAsString(attachments == null ? List.of() : attachments);
    } catch (JsonProcessingException exception) {
      throw new ApiInternalException("Unable to serialize draft attachments");
    }
  }

  private List<DraftDetailResponse.DraftAttachment> parseAttachments(String attachmentsJson) {
    if (!StringUtils.hasText(attachmentsJson)) {
      return List.of();
    }
    try {
      List<DraftDetailResponse.DraftAttachment> parsed = objectMapper.readValue(attachmentsJson, ATTACHMENTS_TYPE);
      return parsed == null ? List.of() : List.copyOf(parsed);
    } catch (JsonProcessingException exception) {
      throw new ApiInternalException("Unable to read draft attachments");
    }
  }

  private void ensureAccountExists(UUID accountId) {
    Integer count = jdbcTemplate.queryForObject(
      "SELECT COUNT(*) FROM accounts WHERE id = ?",
      Integer.class,
      accountId
    );
    if (count == null || count == 0) {
      throw new ApiBadRequestException("Account not found");
    }
  }

  private String normalizeSearchQuery(String value) {
    if (!StringUtils.hasText(value)) {
      return null;
    }
    String normalized = value.trim();
    if (normalized.isEmpty()) {
      return null;
    }
    if (normalized.length() > MAX_SEARCH_LENGTH) {
      throw new ApiBadRequestException("q must be 200 characters or fewer");
    }
    return normalized;
  }

  private String normalizeText(String value) {
    return value == null ? "" : value.trim();
  }

  private String normalizeNullable(String value) {
    if (!StringUtils.hasText(value)) {
      return null;
    }
    String normalized = value.trim();
    return normalized.isEmpty() ? null : normalized;
  }

  private String safeText(String value) {
    return value == null ? "" : value;
  }

  private String buildSnippet(String bodyText) {
    String normalized = safeText(bodyText).replace('\r', ' ').replace('\n', ' ').trim().replaceAll("\\s+", " ");
    if (normalized.length() <= 120) {
      return normalized;
    }
    return normalized.substring(0, 120);
  }

  private enum SortOrder {
    UPDATED_DESC,
    UPDATED_ASC,
    ;

    private static SortOrder fromInput(String value) {
      if (!StringUtils.hasText(value)) {
        return UPDATED_DESC;
      }
      String normalized = value.trim().toUpperCase(Locale.ROOT);
      return switch (normalized) {
        case "UPDATED_DESC" -> UPDATED_DESC;
        case "UPDATED_ASC" -> UPDATED_ASC;
        default -> throw new ApiBadRequestException("sort must be UPDATED_DESC or UPDATED_ASC");
      };
    }
  }

  private record DraftRow(
    UUID id,
    UUID accountId,
    String to,
    String cc,
    String bcc,
    String subject,
    String bodyText,
    String bodyHtml,
    String attachmentsJson,
    OffsetDateTime updatedAt
  ) {}
}
