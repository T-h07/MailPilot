package com.mailpilot.service;

import com.mailpilot.api.error.ApiBadRequestException;
import com.mailpilot.api.error.ApiNotFoundException;
import com.mailpilot.api.model.FollowupActionRequest;
import com.mailpilot.api.model.FollowupStateResponse;
import com.mailpilot.api.model.FollowupUpdateRequest;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Locale;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class FollowupService {

  private final JdbcTemplate jdbcTemplate;

  public FollowupService(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public FollowupStateResponse getFollowup(UUID messageId) {
    ensureMessageExists(messageId);
    return jdbcTemplate.query(
      """
      SELECT status, needs_reply, due_at, snoozed_until
      FROM followups
      WHERE message_id = ?
      """,
      (resultSet, rowNum) ->
        new FollowupStateResponse(
          messageId,
          resultSet.getString("status"),
          resultSet.getBoolean("needs_reply"),
          resultSet.getObject("due_at", OffsetDateTime.class),
          resultSet.getObject("snoozed_until", OffsetDateTime.class)
        ),
      messageId
    ).stream().findFirst().orElse(defaultFollowup(messageId));
  }

  @Transactional
  public FollowupStateResponse upsertFollowup(UUID messageId, FollowupUpdateRequest request) {
    ensureMessageExists(messageId);
    if (request == null) {
      throw new ApiBadRequestException("Request body is required");
    }

    String status = normalizeStatus(request.status());
    if (request.needsReply() == null) {
      throw new ApiBadRequestException("needsReply is required");
    }
    boolean needsReply = request.needsReply();

    OffsetDateTime dueAt = request.dueAt();
    OffsetDateTime snoozedUntil = normalizeSnoozedUntil(request.snoozedUntil());

    upsertRow(messageId, status, needsReply, dueAt, snoozedUntil);
    return getFollowup(messageId);
  }

  @Transactional
  public FollowupStateResponse applyAction(UUID messageId, FollowupActionRequest request) {
    if (request == null || request.action() == null || request.action().trim().isEmpty()) {
      throw new ApiBadRequestException("action is required");
    }

    FollowupStateResponse current = getFollowup(messageId);
    String action = request.action().trim().toUpperCase(Locale.ROOT);

    return switch (action) {
      case "MARK_DONE" -> {
        upsertRow(
          messageId,
          "DONE",
          current.needsReply(),
          current.dueAt(),
          normalizeSnoozedUntil(current.snoozedUntil())
        );
        yield getFollowup(messageId);
      }
      case "MARK_OPEN" -> {
        upsertRow(
          messageId,
          "OPEN",
          current.needsReply(),
          current.dueAt(),
          normalizeSnoozedUntil(current.snoozedUntil())
        );
        yield getFollowup(messageId);
      }
      case "SNOOZE" -> {
        int days = request.days() == null ? 0 : request.days();
        if (days != 1 && days != 3 && days != 7) {
          throw new ApiBadRequestException("days must be 1, 3, or 7 for SNOOZE");
        }
        OffsetDateTime snoozedUntil = OffsetDateTime.now(ZoneOffset.UTC).plusDays(days);
        upsertRow(messageId, "OPEN", current.needsReply(), current.dueAt(), snoozedUntil);
        yield getFollowup(messageId);
      }
      default -> throw new ApiBadRequestException("Unsupported action");
    };
  }

  private void upsertRow(
    UUID messageId,
    String status,
    boolean needsReply,
    OffsetDateTime dueAt,
    OffsetDateTime snoozedUntil
  ) {
    jdbcTemplate.update(
      """
      INSERT INTO followups (
        message_id,
        status,
        needs_reply,
        due_at,
        snoozed_until,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, now(), now())
      ON CONFLICT (message_id)
      DO UPDATE SET
        status = EXCLUDED.status,
        needs_reply = EXCLUDED.needs_reply,
        due_at = EXCLUDED.due_at,
        snoozed_until = EXCLUDED.snoozed_until,
        updated_at = now()
      """,
      messageId,
      status,
      needsReply,
      dueAt,
      snoozedUntil
    );
  }

  private String normalizeStatus(String rawStatus) {
    String status = rawStatus == null ? "" : rawStatus.trim().toUpperCase(Locale.ROOT);
    if (!"OPEN".equals(status) && !"DONE".equals(status)) {
      throw new ApiBadRequestException("status must be OPEN or DONE");
    }
    return status;
  }

  private OffsetDateTime normalizeSnoozedUntil(OffsetDateTime rawSnoozedUntil) {
    if (rawSnoozedUntil == null) {
      return null;
    }
    return rawSnoozedUntil.isBefore(OffsetDateTime.now(ZoneOffset.UTC)) ? null : rawSnoozedUntil;
  }

  private FollowupStateResponse defaultFollowup(UUID messageId) {
    return new FollowupStateResponse(messageId, "OPEN", false, null, null);
  }

  private void ensureMessageExists(UUID messageId) {
    Integer count = jdbcTemplate.queryForObject(
      "SELECT COUNT(*) FROM messages WHERE id = ?",
      Integer.class,
      messageId
    );
    if (count == null || count == 0) {
      throw new ApiNotFoundException("Message not found");
    }
  }
}
