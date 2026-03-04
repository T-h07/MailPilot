package com.mailpilot.service;

import com.mailpilot.api.error.ApiNotFoundException;
import com.mailpilot.api.model.MessageDetailResponse;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class MessageService {

  private final JdbcTemplate jdbcTemplate;

  public MessageService(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public MessageDetailResponse getMessageDetail(UUID messageId) {
    String messageSql =
      """
      SELECT
        m.id,
        m.account_id,
        a.email AS account_email,
        m.thread_id,
        COALESCE(m.sender_name, split_part(m.sender_email, '@', 1)) AS sender_name,
        m.sender_email,
        COALESCE(m.subject, '(no subject)') AS subject,
        COALESCE(m.snippet, '') AS snippet,
        m.received_at,
        NOT m.is_read AS is_unread,
        m.body_cache,
        m.body_cache_mime,
        f.status AS followup_status,
        f.needs_reply,
        f.due_at,
        f.snoozed_until,
        COALESCE(sr_email.label, sr_domain.label) AS highlight_label,
        COALESCE(sr_email.accent, sr_domain.accent) AS highlight_accent
      FROM messages m
      JOIN accounts a ON a.id = m.account_id
      LEFT JOIN followups f ON f.message_id = m.id
      LEFT JOIN sender_rules sr_email
        ON sr_email.match_type = 'EMAIL' AND sr_email.match_value = m.sender_email
      LEFT JOIN sender_rules sr_domain
        ON sr_domain.match_type = 'DOMAIN' AND sr_domain.match_value = m.sender_domain
      WHERE m.id = ?
      """;

    List<MessageRow> messageRows = jdbcTemplate.query(
      messageSql,
      (resultSet, rowNum) -> mapMessageRow(resultSet),
      messageId
    );

    if (messageRows.isEmpty()) {
      throw new ApiNotFoundException("Message not found");
    }

    MessageRow messageRow = messageRows.getFirst();

    List<MessageDetailResponse.Attachment> attachments = jdbcTemplate.query(
      "SELECT id, filename, mime_type, size_bytes FROM attachments WHERE message_id = ? ORDER BY filename",
      (resultSet, rowNum) ->
        new MessageDetailResponse.Attachment(
          resultSet.getObject("id", UUID.class),
          resultSet.getString("filename"),
          resultSet.getString("mime_type"),
          resultSet.getLong("size_bytes")
        ),
      messageId
    );

    List<MessageDetailResponse.ThreadMessage> threadMessages;
    if (messageRow.threadId() != null) {
      threadMessages = jdbcTemplate.query(
        """
        SELECT id, sender_email, COALESCE(subject, '(no subject)') AS subject, received_at, NOT is_read AS is_unread
        FROM messages
        WHERE thread_id = ?
        ORDER BY received_at DESC, id DESC
        LIMIT 200
        """,
        (resultSet, rowNum) -> mapThreadMessage(resultSet),
        messageRow.threadId()
      );
    } else {
      threadMessages = List.of(
        new MessageDetailResponse.ThreadMessage(
          messageRow.id(),
          messageRow.senderEmail(),
          messageRow.subject(),
          messageRow.receivedAt(),
          messageRow.isUnread()
        )
      );
    }

    List<String> tags = jdbcTemplate.query(
      """
      SELECT t.name
      FROM message_tags mt
      JOIN tags t ON t.id = mt.tag_id
      WHERE mt.message_id = ?
      ORDER BY t.name
      """,
      (resultSet, rowNum) -> resultSet.getString("name"),
      messageId
    );

    MessageDetailResponse.Body body = new MessageDetailResponse.Body(
      messageRow.bodyCacheMime() == null ? "text/plain" : messageRow.bodyCacheMime(),
      messageRow.bodyCache(),
      messageRow.bodyCache() != null
    );

    MessageDetailResponse.Followup followup = new MessageDetailResponse.Followup(
      messageRow.followupStatus() == null ? "OPEN" : messageRow.followupStatus(),
      Boolean.TRUE.equals(messageRow.needsReply()),
      messageRow.dueAt(),
      messageRow.snoozedUntil()
    );

    MessageDetailResponse.Highlight highlight = messageRow.highlightLabel() == null
      ? null
      : new MessageDetailResponse.Highlight(messageRow.highlightLabel(), messageRow.highlightAccent());

    return new MessageDetailResponse(
      messageRow.id(),
      messageRow.accountId(),
      messageRow.accountEmail(),
      messageRow.threadId(),
      messageRow.senderName(),
      messageRow.senderEmail(),
      messageRow.subject(),
      messageRow.receivedAt().toString(),
      messageRow.isUnread(),
      body,
      attachments,
      new MessageDetailResponse.Thread(threadMessages),
      tags,
      followup,
      highlight
    );
  }

  public void setUnread(UUID messageId, boolean isUnread) {
    int updatedRows = jdbcTemplate.update("UPDATE messages SET is_read = ? WHERE id = ?", !isUnread, messageId);
    if (updatedRows == 0) {
      throw new ApiNotFoundException("Message not found");
    }
  }

  private MessageRow mapMessageRow(ResultSet resultSet) throws SQLException {
    return new MessageRow(
      resultSet.getObject("id", UUID.class),
      resultSet.getObject("account_id", UUID.class),
      resultSet.getString("account_email"),
      resultSet.getObject("thread_id", UUID.class),
      resultSet.getString("sender_name"),
      resultSet.getString("sender_email"),
      resultSet.getString("subject"),
      resultSet.getString("snippet"),
      resultSet.getObject("received_at", OffsetDateTime.class),
      resultSet.getBoolean("is_unread"),
      resultSet.getString("body_cache"),
      resultSet.getString("body_cache_mime"),
      resultSet.getString("followup_status"),
      (Boolean) resultSet.getObject("needs_reply"),
      resultSet.getObject("due_at", OffsetDateTime.class),
      resultSet.getObject("snoozed_until", OffsetDateTime.class),
      resultSet.getString("highlight_label"),
      resultSet.getString("highlight_accent")
    );
  }

  private MessageDetailResponse.ThreadMessage mapThreadMessage(ResultSet resultSet) throws SQLException {
    return new MessageDetailResponse.ThreadMessage(
      resultSet.getObject("id", UUID.class),
      resultSet.getString("sender_email"),
      resultSet.getString("subject"),
      resultSet.getObject("received_at", OffsetDateTime.class),
      resultSet.getBoolean("is_unread")
    );
  }

  private record MessageRow(
    UUID id,
    UUID accountId,
    String accountEmail,
    UUID threadId,
    String senderName,
    String senderEmail,
    String subject,
    String snippet,
    OffsetDateTime receivedAt,
    boolean isUnread,
    String bodyCache,
    String bodyCacheMime,
    String followupStatus,
    Boolean needsReply,
    OffsetDateTime dueAt,
    OffsetDateTime snoozedUntil,
    String highlightLabel,
    String highlightAccent
  ) {}
}
