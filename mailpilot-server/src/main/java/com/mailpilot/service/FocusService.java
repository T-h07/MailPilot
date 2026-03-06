package com.mailpilot.service;

import com.mailpilot.api.error.ApiBadRequestException;
import com.mailpilot.api.model.FocusQueueResponse;
import com.mailpilot.api.model.FocusSummaryResponse;
import java.nio.charset.StandardCharsets;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class FocusService {

  private static final int DEFAULT_PAGE_SIZE = 50;
  private static final String OPEN_FOLLOWUP_CONDITION =
      "f.status = 'OPEN' AND (f.needs_reply = true OR f.due_at IS NOT NULL OR f.snoozed_until IS NOT NULL)";

  private final JdbcTemplate jdbcTemplate;
  private final SenderHighlightResolver senderHighlightResolver;

  public FocusService(JdbcTemplate jdbcTemplate, SenderHighlightResolver senderHighlightResolver) {
    this.jdbcTemplate = jdbcTemplate;
    this.senderHighlightResolver = senderHighlightResolver;
  }

  public FocusSummaryResponse getSummary() {
    var row = jdbcTemplate.queryForMap(
      """
      SELECT
        COUNT(*) FILTER (WHERE status = 'OPEN' AND needs_reply = true) AS needs_reply_open,
        COUNT(*) FILTER (WHERE status = 'OPEN' AND due_at < now()) AS overdue,
        COUNT(*) FILTER (
          WHERE
            status = 'OPEN'
            AND due_at >= date_trunc('day', now())
            AND due_at < date_trunc('day', now()) + interval '1 day'
        ) AS due_today,
        COUNT(*) FILTER (WHERE status = 'OPEN' AND snoozed_until > now()) AS snoozed,
        COUNT(*) FILTER (
          WHERE
            status = 'OPEN'
            AND (needs_reply = true OR due_at IS NOT NULL OR snoozed_until IS NOT NULL)
        ) AS open_total,
        COUNT(*) FILTER (
          WHERE
            status = 'OPEN'
            AND snoozed_until IS NOT NULL
            AND snoozed_until > now()
            AND snoozed_until <= now() + interval '24 hours'
        ) AS wakeups_next_24h
      FROM followups
      """
    );

    List<FocusSummaryResponse.ByAccount> byAccount = loadByAccount();
    List<FocusSummaryResponse.TopSender> topSenders = loadTopSenders();

    return new FocusSummaryResponse(
      toInt(row.get("needs_reply_open")),
      toInt(row.get("overdue")),
      toInt(row.get("due_today")),
      toInt(row.get("snoozed")),
      toInt(row.get("open_total")),
      toInt(row.get("wakeups_next_24h")),
      byAccount,
      topSenders,
      OffsetDateTime.now(ZoneOffset.UTC)
    );
  }

  public FocusQueueResponse getQueue(String rawQueueType, Integer rawPageSize, String cursor) {
    QueueType queueType = parseQueueType(rawQueueType);
    int pageSize = resolvePageSize(rawPageSize);
    int offset = decodeOffset(cursor);

    StringBuilder sql = new StringBuilder(
      """
      SELECT
        m.id AS message_id,
        m.account_id,
        a.email AS account_email,
        COALESCE(m.sender_name, split_part(m.sender_email, '@', 1)) AS sender_name,
        m.sender_email,
        m.sender_domain,
        COALESCE(m.subject, '(no subject)') AS subject,
        COALESCE(m.snippet, '') AS snippet,
        m.received_at,
        NOT m.is_read AS is_unread,
        f.needs_reply,
        f.due_at,
        f.snoozed_until
      FROM followups f
      JOIN messages m ON m.id = f.message_id
      JOIN accounts a ON a.id = m.account_id
      WHERE
      """
    );

    sql.append(queueFilter(queueType)).append(' ');
    sql.append(queueOrder(queueType));
    sql.append(" LIMIT ? OFFSET ?");

    List<FocusRow> rows = jdbcTemplate.query(
      sql.toString(),
      (resultSet, rowNum) -> mapRow(resultSet),
      pageSize + 1,
      offset
    );

    boolean hasMore = rows.size() > pageSize;
    if (hasMore) {
      rows = new ArrayList<>(rows.subList(0, pageSize));
    }

    Set<String> senderEmails = new LinkedHashSet<>();
    Set<String> senderDomains = new LinkedHashSet<>();
    for (FocusRow row : rows) {
      if (row.senderEmail() != null && !row.senderEmail().isBlank()) {
        senderEmails.add(row.senderEmail());
      }
      if (row.senderDomain() != null && !row.senderDomain().isBlank()) {
        senderDomains.add(row.senderDomain());
      }
    }
    SenderHighlightResolver.RuleSet highlightRuleSet = senderHighlightResolver.loadRuleSet(
      senderEmails,
      senderDomains
    );

    List<FocusQueueResponse.Item> items = new ArrayList<>(rows.size());
    for (FocusRow row : rows) {
      SenderHighlightResolver.Highlight resolvedHighlight = senderHighlightResolver.resolve(
        row.senderEmail(),
        row.senderDomain(),
        highlightRuleSet
      );
      FocusQueueResponse.Highlight highlight = resolvedHighlight == null
        ? null
        : new FocusQueueResponse.Highlight(resolvedHighlight.label(), resolvedHighlight.accent());

      items.add(
        new FocusQueueResponse.Item(
          row.messageId(),
          row.accountId(),
          row.accountEmail(),
          row.senderName(),
          row.senderEmail(),
          row.subject(),
          row.snippet(),
          row.receivedAt(),
          row.isUnread(),
          queueType.name(),
          row.dueAt(),
          row.snoozedUntil(),
          row.needsReply(),
          highlight
        )
      );
    }

    String nextCursor = hasMore ? encodeOffset(offset + pageSize) : null;
    return new FocusQueueResponse(items, nextCursor);
  }

  private FocusRow mapRow(ResultSet resultSet) throws SQLException {
    return new FocusRow(
      resultSet.getObject("message_id", UUID.class),
      resultSet.getObject("account_id", UUID.class),
      resultSet.getString("account_email"),
      resultSet.getString("sender_name"),
      resultSet.getString("sender_email"),
      resultSet.getString("sender_domain"),
      resultSet.getString("subject"),
      resultSet.getString("snippet"),
      resultSet.getObject("received_at", OffsetDateTime.class),
      resultSet.getBoolean("is_unread"),
      resultSet.getBoolean("needs_reply"),
      resultSet.getObject("due_at", OffsetDateTime.class),
      resultSet.getObject("snoozed_until", OffsetDateTime.class)
    );
  }

  private QueueType parseQueueType(String rawQueueType) {
    if (rawQueueType == null || rawQueueType.isBlank()) {
      throw new ApiBadRequestException("type is required");
    }

    return switch (rawQueueType.trim().toUpperCase()) {
      case "NEEDS_REPLY" -> QueueType.NEEDS_REPLY;
      case "OVERDUE" -> QueueType.OVERDUE;
      case "DUE_TODAY" -> QueueType.DUE_TODAY;
      case "SNOOZED" -> QueueType.SNOOZED;
      case "ALL_OPEN" -> QueueType.ALL_OPEN;
      default -> throw new ApiBadRequestException("Unsupported focus queue type");
    };
  }

  private int resolvePageSize(Integer rawPageSize) {
    if (rawPageSize == null) {
      return DEFAULT_PAGE_SIZE;
    }
    if (rawPageSize < 10 || rawPageSize > 200) {
      throw new ApiBadRequestException("pageSize must be between 10 and 200");
    }
    return rawPageSize;
  }

  private int decodeOffset(String cursor) {
    if (cursor == null || cursor.isBlank()) {
      return 0;
    }

    try {
      String decoded = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8);
      int offset = Integer.parseInt(decoded);
      if (offset < 0) {
        throw new IllegalArgumentException("Negative offset");
      }
      return offset;
    } catch (RuntimeException exception) {
      throw new ApiBadRequestException("Invalid cursor");
    }
  }

  private String encodeOffset(int offset) {
    return Base64.getUrlEncoder().withoutPadding().encodeToString(
      Integer.toString(offset).getBytes(StandardCharsets.UTF_8)
    );
  }

  private String queueFilter(QueueType queueType) {
    return switch (queueType) {
      case NEEDS_REPLY -> "f.status = 'OPEN' AND f.needs_reply = true";
      case OVERDUE -> "f.status = 'OPEN' AND f.due_at < now()";
      case DUE_TODAY ->
        "f.status = 'OPEN'"
          + " AND f.due_at >= date_trunc('day', now())"
          + " AND f.due_at < date_trunc('day', now()) + interval '1 day'";
      case SNOOZED -> "f.status = 'OPEN' AND f.snoozed_until > now()";
      case ALL_OPEN ->
        "f.status = 'OPEN' AND (f.needs_reply = true OR f.due_at IS NOT NULL OR f.snoozed_until IS NOT NULL)";
    };
  }

  private String queueOrder(QueueType queueType) {
    return switch (queueType) {
      case NEEDS_REPLY -> "ORDER BY m.received_at DESC, m.id DESC";
      case OVERDUE -> "ORDER BY f.due_at ASC, m.id ASC";
      case DUE_TODAY -> "ORDER BY f.due_at ASC, m.id ASC";
      case SNOOZED -> "ORDER BY f.snoozed_until ASC, m.id ASC";
      case ALL_OPEN -> "ORDER BY CASE WHEN f.due_at IS NULL THEN 1 ELSE 0 END, f.due_at ASC, m.received_at DESC, m.id DESC";
    };
  }

  private int toInt(Object value) {
    if (value instanceof Number number) {
      return number.intValue();
    }
    return 0;
  }

  private List<FocusSummaryResponse.ByAccount> loadByAccount() {
    return jdbcTemplate.query(
        """
        SELECT
          a.id AS account_id,
          a.email AS account_email,
          COUNT(*) AS item_count
        FROM followups f
        JOIN messages m ON m.id = f.message_id
        JOIN accounts a ON a.id = m.account_id
        WHERE
        """
            + OPEN_FOLLOWUP_CONDITION
            + """
        GROUP BY a.id, a.email
        ORDER BY item_count DESC, a.email ASC
        LIMIT 8
        """,
        (resultSet, rowNum) ->
            new FocusSummaryResponse.ByAccount(
                resultSet.getObject("account_id", UUID.class),
                resultSet.getString("account_email"),
                resultSet.getInt("item_count")));
  }

  private List<FocusSummaryResponse.TopSender> loadTopSenders() {
    return jdbcTemplate.query(
        """
        SELECT
          m.sender_email,
          COALESCE(NULLIF(trim(m.sender_name), ''), split_part(m.sender_email, '@', 1)) AS sender_name,
          COUNT(*) AS item_count
        FROM followups f
        JOIN messages m ON m.id = f.message_id
        WHERE
        """
            + OPEN_FOLLOWUP_CONDITION
            + """
        GROUP BY m.sender_email, sender_name
        ORDER BY item_count DESC, sender_name ASC
        LIMIT 8
        """,
        (resultSet, rowNum) ->
            new FocusSummaryResponse.TopSender(
                resultSet.getString("sender_email"),
                resultSet.getString("sender_name"),
                resultSet.getInt("item_count")));
  }

  private enum QueueType {
    NEEDS_REPLY,
    OVERDUE,
    DUE_TODAY,
    SNOOZED,
    ALL_OPEN
  }

  private record FocusRow(
    UUID messageId,
    UUID accountId,
    String accountEmail,
    String senderName,
    String senderEmail,
    String senderDomain,
    String subject,
    String snippet,
    OffsetDateTime receivedAt,
    boolean isUnread,
    boolean needsReply,
    OffsetDateTime dueAt,
    OffsetDateTime snoozedUntil
  ) {}
}
