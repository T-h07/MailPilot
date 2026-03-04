package com.mailpilot.service;

import com.mailpilot.api.error.ApiBadRequestException;
import com.mailpilot.api.model.MailboxQueryRequest;
import com.mailpilot.api.model.MailboxQueryResponse;
import java.nio.charset.StandardCharsets;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class MailboxQueryService {

  private static final int DEFAULT_PAGE_SIZE = 50;
  private static final int MAX_TAGS_PER_MESSAGE = 10;

  private final JdbcTemplate jdbcTemplate;
  private final SenderHighlightResolver senderHighlightResolver;

  public MailboxQueryService(JdbcTemplate jdbcTemplate, SenderHighlightResolver senderHighlightResolver) {
    this.jdbcTemplate = jdbcTemplate;
    this.senderHighlightResolver = senderHighlightResolver;
  }

  public MailboxQueryResponse query(MailboxQueryRequest request) {
    int pageSize = resolvePageSize(request.pageSize());
    validateSort(request.sort());
    Cursor cursor = decodeCursor(request.cursor());

    StringBuilder sql = new StringBuilder(
      """
      SELECT
        m.id,
        m.account_id,
        a.email AS account_email,
        COALESCE(m.sender_name, split_part(m.sender_email, '@', 1)) AS sender_name,
        m.sender_email,
        m.sender_domain,
        COALESCE(m.subject, '(no subject)') AS subject,
        COALESCE(m.snippet, '') AS snippet,
        m.received_at,
        NOT m.is_read AS is_unread,
        m.has_attachments,
        f.status AS followup_status,
        f.needs_reply,
        f.due_at,
        f.snoozed_until
      FROM messages m
      JOIN accounts a ON a.id = m.account_id
      LEFT JOIN followups f ON f.message_id = m.id
      WHERE 1=1
      """
    );

    List<Object> params = new ArrayList<>();

    List<UUID> accountIds = request.scope() == null ? List.of() : safeList(request.scope().accountIds());
    if (!accountIds.isEmpty()) {
      sql.append(" AND m.account_id IN (").append(placeholders(accountIds.size())).append(")");
      params.addAll(accountIds);
    }

    String query = normalize(request.q());
    if (!query.isBlank()) {
      String like = "%" + query + "%";
      sql.append(
        " AND ("
          + "lower(m.sender_email) LIKE ?"
          + " OR lower(COALESCE(m.sender_name, '')) LIKE ?"
          + " OR lower(COALESCE(m.subject, '')) LIKE ?"
          + " OR lower(COALESCE(m.snippet, '')) LIKE ?"
          + ")"
      );
      params.add(like);
      params.add(like);
      params.add(like);
      params.add(like);
    }

    MailboxQueryRequest.Filters filters = request.filters();
    boolean unreadOnly = filters != null && Boolean.TRUE.equals(filters.unreadOnly());
    boolean needsReply = filters != null && Boolean.TRUE.equals(filters.needsReply());
    boolean overdue = filters != null && Boolean.TRUE.equals(filters.overdue());
    boolean dueToday = filters != null && Boolean.TRUE.equals(filters.dueToday());
    boolean snoozed = filters != null && Boolean.TRUE.equals(filters.snoozed());

    if (unreadOnly) {
      sql.append(" AND m.is_read = false");
    }
    if (needsReply) {
      sql.append(" AND f.status = 'OPEN' AND f.needs_reply = true");
    }
    if (overdue) {
      sql.append(" AND f.status = 'OPEN' AND f.due_at < now()");
    }
    if (dueToday) {
      sql.append(
        " AND f.status = 'OPEN'"
          + " AND f.due_at >= date_trunc('day', now())"
          + " AND f.due_at < date_trunc('day', now()) + interval '1 day'"
      );
    }
    if (snoozed) {
      sql.append(" AND f.status = 'OPEN' AND f.snoozed_until > now()");
    }

    List<String> senderDomains = normalizeList(filters == null ? null : filters.senderDomains());
    if (!senderDomains.isEmpty()) {
      sql.append(" AND lower(m.sender_domain) IN (").append(placeholders(senderDomains.size())).append(")");
      params.addAll(senderDomains);
    }

    List<String> senderEmails = normalizeList(filters == null ? null : filters.senderEmails());
    if (!senderEmails.isEmpty()) {
      sql.append(" AND lower(m.sender_email) IN (").append(placeholders(senderEmails.size())).append(")");
      params.addAll(senderEmails);
    }

    List<String> keywords = normalizeList(filters == null ? null : filters.keywords());
    if (!keywords.isEmpty()) {
      sql.append(" AND (");
      for (int i = 0; i < keywords.size(); i++) {
        if (i > 0) {
          sql.append(" OR ");
        }
        sql.append("(lower(COALESCE(m.subject, '')) LIKE ? OR lower(COALESCE(m.snippet, '')) LIKE ?)");
        String keywordLike = "%" + keywords.get(i) + "%";
        params.add(keywordLike);
        params.add(keywordLike);
      }
      sql.append(")");
    }

    if (cursor != null) {
      sql.append(" AND (m.received_at < ? OR (m.received_at = ? AND m.id < ?))");
      params.add(cursor.receivedAt());
      params.add(cursor.receivedAt());
      params.add(cursor.id());
    }

    sql.append(" ORDER BY m.received_at DESC, m.id DESC LIMIT ?");
    params.add(pageSize + 1);

    List<MailboxRow> rows = jdbcTemplate.query(
      sql.toString(),
      (resultSet, rowNum) -> mapMailboxRow(resultSet),
      params.toArray()
    );

    boolean hasMore = rows.size() > pageSize;
    if (hasMore) {
      rows = new ArrayList<>(rows.subList(0, pageSize));
    }

    List<UUID> messageIds = rows.stream().map(MailboxRow::id).toList();
    Map<UUID, List<String>> tagsByMessage = loadTagsByMessage(messageIds);
    Set<String> senderEmailsForLookup = new LinkedHashSet<>();
    Set<String> senderDomainsForLookup = new LinkedHashSet<>();
    for (MailboxRow row : rows) {
      String senderEmail = normalize(row.senderEmail());
      if (!senderEmail.isBlank()) {
        senderEmailsForLookup.add(senderEmail);
      }
      String senderDomain = normalize(row.senderDomain());
      if (!senderDomain.isBlank()) {
        senderDomainsForLookup.add(senderDomain);
      }
    }
    SenderHighlightResolver.RuleSet highlightRuleSet = senderHighlightResolver.loadRuleSet(
      senderEmailsForLookup,
      senderDomainsForLookup
    );

    OffsetDateTime nowUtc = OffsetDateTime.now(ZoneOffset.UTC);
    LocalDate todayUtc = nowUtc.toLocalDate();
    List<MailboxQueryResponse.Item> items = new ArrayList<>(rows.size());
    for (MailboxRow row : rows) {
      List<String> chips = buildChips(row, nowUtc, todayUtc);
      List<String> tags = tagsByMessage.getOrDefault(row.id(), List.of());
      SenderHighlightResolver.Highlight resolvedHighlight = senderHighlightResolver.resolve(
        row.senderEmail(),
        row.senderDomain(),
        highlightRuleSet
      );
      MailboxQueryResponse.Highlight highlight = resolvedHighlight == null
        ? null
        : new MailboxQueryResponse.Highlight(resolvedHighlight.label(), resolvedHighlight.accent());
      items.add(
        new MailboxQueryResponse.Item(
          row.id(),
          row.accountId(),
          row.accountEmail(),
          row.senderName(),
          row.senderEmail(),
          row.senderDomain(),
          row.subject(),
          row.snippet(),
          row.receivedAt(),
          row.isUnread(),
          row.hasAttachments(),
          chips,
          tags,
          highlight
        )
      );
    }

    String nextCursor = null;
    if (hasMore && !rows.isEmpty()) {
      MailboxRow lastRow = rows.get(rows.size() - 1);
      nextCursor = encodeCursor(lastRow.receivedAt(), lastRow.id());
    }

    return new MailboxQueryResponse(items, nextCursor);
  }

  private Map<UUID, List<String>> loadTagsByMessage(List<UUID> messageIds) {
    if (messageIds.isEmpty()) {
      return Map.of();
    }

    String sql =
      "SELECT mt.message_id, t.name "
        + "FROM message_tags mt "
        + "JOIN tags t ON t.id = mt.tag_id "
        + "WHERE mt.message_id IN ("
        + placeholders(messageIds.size())
        + ") "
        + "ORDER BY mt.message_id, t.name";

    List<Map<String, Object>> rows = jdbcTemplate.queryForList(sql, messageIds.toArray());
    Map<UUID, List<String>> tagsByMessage = new HashMap<>();
    for (Map<String, Object> row : rows) {
      UUID messageId = (UUID) row.get("message_id");
      String tagName = Objects.toString(row.get("name"), "");
      if (messageId == null || tagName.isBlank()) {
        continue;
      }
      List<String> tags = tagsByMessage.computeIfAbsent(messageId, ignored -> new ArrayList<>());
      if (tags.size() < MAX_TAGS_PER_MESSAGE) {
        tags.add(tagName);
      }
    }
    return tagsByMessage;
  }

  private List<String> buildChips(MailboxRow row, OffsetDateTime nowUtc, LocalDate todayUtc) {
    if (!"OPEN".equalsIgnoreCase(row.followupStatus())) {
      return List.of();
    }

    List<String> chips = new ArrayList<>(4);
    if (Boolean.TRUE.equals(row.needsReply())) {
      chips.add("NeedsReply");
    }

    if (row.dueAt() != null) {
      OffsetDateTime dueUtc = row.dueAt().withOffsetSameInstant(ZoneOffset.UTC);
      if (dueUtc.isBefore(nowUtc)) {
        chips.add("Overdue");
      }
      if (dueUtc.toLocalDate().isEqual(todayUtc)) {
        chips.add("DueToday");
      }
    }

    if (row.snoozedUntil() != null && row.snoozedUntil().withOffsetSameInstant(ZoneOffset.UTC).isAfter(nowUtc)) {
      chips.add("Snoozed");
    }

    return chips;
  }

  private MailboxRow mapMailboxRow(ResultSet resultSet) throws SQLException {
    return new MailboxRow(
      resultSet.getObject("id", UUID.class),
      resultSet.getObject("account_id", UUID.class),
      resultSet.getString("account_email"),
      resultSet.getString("sender_name"),
      resultSet.getString("sender_email"),
      resultSet.getString("sender_domain"),
      resultSet.getString("subject"),
      resultSet.getString("snippet"),
      resultSet.getObject("received_at", OffsetDateTime.class),
      resultSet.getBoolean("is_unread"),
      resultSet.getBoolean("has_attachments"),
      resultSet.getString("followup_status"),
      (Boolean) resultSet.getObject("needs_reply"),
      resultSet.getObject("due_at", OffsetDateTime.class),
      resultSet.getObject("snoozed_until", OffsetDateTime.class)
    );
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

  private void validateSort(String sort) {
    String normalized = sort == null ? "RECEIVED_DESC" : sort.trim().toUpperCase(Locale.ROOT);
    if (!"RECEIVED_DESC".equals(normalized)) {
      throw new ApiBadRequestException("Only RECEIVED_DESC sort is supported");
    }
  }

  private Cursor decodeCursor(String cursor) {
    if (cursor == null || cursor.isBlank()) {
      return null;
    }

    try {
      byte[] decodedBytes = Base64.getUrlDecoder().decode(cursor);
      String decoded = new String(decodedBytes, StandardCharsets.UTF_8);
      String[] parts = decoded.split("\\|", 2);
      if (parts.length != 2) {
        throw new IllegalArgumentException("Invalid cursor format");
      }
      OffsetDateTime receivedAt = OffsetDateTime.parse(parts[0]);
      UUID id = UUID.fromString(parts[1]);
      return new Cursor(receivedAt, id);
    } catch (RuntimeException exception) {
      throw new ApiBadRequestException("Invalid cursor");
    }
  }

  private String encodeCursor(OffsetDateTime receivedAt, UUID id) {
    String payload = receivedAt.toString() + "|" + id;
    return Base64.getUrlEncoder().withoutPadding().encodeToString(payload.getBytes(StandardCharsets.UTF_8));
  }

  private String normalize(String value) {
    return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
  }

  private List<String> normalizeList(List<String> values) {
    if (values == null || values.isEmpty()) {
      return List.of();
    }

    Set<String> normalized = new LinkedHashSet<>();
    for (String value : values) {
      String normalizedValue = normalize(value);
      if (!normalizedValue.isBlank()) {
        normalized.add(normalizedValue);
      }
    }
    return List.copyOf(normalized);
  }

  private <T> List<T> safeList(List<T> values) {
    if (values == null || values.isEmpty()) {
      return Collections.emptyList();
    }
    return values;
  }

  private String placeholders(int count) {
    return String.join(",", Collections.nCopies(count, "?"));
  }

  private record Cursor(OffsetDateTime receivedAt, UUID id) {}

  private record MailboxRow(
    UUID id,
    UUID accountId,
    String accountEmail,
    String senderName,
    String senderEmail,
    String senderDomain,
    String subject,
    String snippet,
    OffsetDateTime receivedAt,
    boolean isUnread,
    boolean hasAttachments,
    String followupStatus,
    Boolean needsReply,
    OffsetDateTime dueAt,
    OffsetDateTime snoozedUntil
  ) {}
}
