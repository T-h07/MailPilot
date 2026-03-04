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
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class MailboxQueryService {

  private static final int DEFAULT_PAGE_SIZE = 50;
  private static final int MAX_TAGS_PER_MESSAGE = 10;
  private static final Logger LOGGER = LoggerFactory.getLogger(MailboxQueryService.class);
  private static final String CURSOR_MODE_TIME = "t";
  private static final String CURSOR_MODE_SEARCH = "s";

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

    MailboxQueryRequest.Filters filters = request.filters();
    List<String> keywords = normalizeList(filters == null ? null : filters.keywords());
    String searchText = buildSearchText(normalize(request.q()), keywords);

    StringBuilder fromWhere = new StringBuilder(
      """
      FROM messages m
      JOIN accounts a ON a.id = m.account_id
      LEFT JOIN followups f ON f.message_id = m.id
      WHERE 1=1
      """
    );
    List<Object> baseParams = new ArrayList<>();

    List<UUID> accountIds = request.scope() == null ? List.of() : safeList(request.scope().accountIds());
    if (!accountIds.isEmpty()) {
      fromWhere.append(" AND m.account_id IN (").append(placeholders(accountIds.size())).append(")");
      baseParams.addAll(accountIds);
    }

    boolean unreadOnly = filters != null && Boolean.TRUE.equals(filters.unreadOnly());
    boolean needsReply = filters != null && Boolean.TRUE.equals(filters.needsReply());
    boolean overdue = filters != null && Boolean.TRUE.equals(filters.overdue());
    boolean dueToday = filters != null && Boolean.TRUE.equals(filters.dueToday());
    boolean snoozed = filters != null && Boolean.TRUE.equals(filters.snoozed());
    boolean allOpen = filters != null && Boolean.TRUE.equals(filters.allOpen());

    if (unreadOnly) {
      fromWhere.append(" AND m.is_read = false");
    }
    if (needsReply) {
      fromWhere.append(" AND f.status = 'OPEN' AND f.needs_reply = true");
    }
    if (overdue) {
      fromWhere.append(" AND f.status = 'OPEN' AND f.due_at < now()");
    }
    if (dueToday) {
      fromWhere.append(
        " AND f.status = 'OPEN'"
          + " AND f.due_at >= date_trunc('day', now())"
          + " AND f.due_at < date_trunc('day', now()) + interval '1 day'"
      );
    }
    if (snoozed) {
      fromWhere.append(" AND f.status = 'OPEN' AND f.snoozed_until > now()");
    }
    if (allOpen) {
      fromWhere.append(
        " AND f.status = 'OPEN' AND (f.needs_reply = true OR f.due_at IS NOT NULL OR f.snoozed_until IS NOT NULL)"
      );
    }

    List<String> senderDomains = normalizeList(filters == null ? null : filters.senderDomains());
    if (!senderDomains.isEmpty()) {
      fromWhere.append(" AND lower(m.sender_domain) IN (").append(placeholders(senderDomains.size())).append(")");
      baseParams.addAll(senderDomains);
    }

    List<String> senderEmails = normalizeList(filters == null ? null : filters.senderEmails());
    if (!senderEmails.isEmpty()) {
      fromWhere.append(" AND lower(m.sender_email) IN (").append(placeholders(senderEmails.size())).append(")");
      baseParams.addAll(senderEmails);
    }

    QueryExecutionResult queryExecutionResult = searchText.isBlank()
      ? runChronologicalQuery(fromWhere.toString(), baseParams, cursor, pageSize)
      : runRankedQuery(fromWhere.toString(), baseParams, cursor, pageSize, searchText);

    List<MailboxRow> rows = queryExecutionResult.rows();

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
      nextCursor =
        queryExecutionResult.ranked()
          ? encodeSearchCursor(lastRow.searchRank() == null ? 0.0 : lastRow.searchRank(), lastRow.receivedAt(), lastRow.id())
          : encodeTimeCursor(lastRow.receivedAt(), lastRow.id());
    }

    return new MailboxQueryResponse(items, nextCursor);
  }

  public SearchHealth checkSearchHealth(String rawQuery) {
    String normalizedQuery = normalize(rawQuery);
    if (normalizedQuery.isBlank()) {
      normalizedQuery = "test";
    }

    try {
      Integer count = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM messages m WHERE m.search_vector @@ websearch_to_tsquery('simple', ?)",
        Integer.class,
        normalizedQuery
      );
      return new SearchHealth(true, "fts", count == null ? 0 : count);
    } catch (DataAccessException exception) {
      LOGGER.warn("websearch_to_tsquery failed in search health; falling back to plainto_tsquery");
    }

    try {
      Integer count = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM messages m WHERE m.search_vector @@ plainto_tsquery('simple', ?)",
        Integer.class,
        normalizedQuery
      );
      return new SearchHealth(true, "fts", count == null ? 0 : count);
    } catch (DataAccessException exception) {
      LOGGER.warn("plainto_tsquery failed in search health; falling back to ILIKE");
    }

    String like = "%" + normalizedQuery + "%";
    Integer count = jdbcTemplate.queryForObject(
      """
      SELECT COUNT(*)
      FROM messages m
      WHERE lower(m.sender_email) LIKE ?
         OR lower(COALESCE(m.sender_name, '')) LIKE ?
         OR lower(COALESCE(m.subject, '')) LIKE ?
         OR lower(COALESCE(m.snippet, '')) LIKE ?
      """,
      Integer.class,
      like,
      like,
      like,
      like
    );
    return new SearchHealth(false, "ilike", count == null ? 0 : count);
  }

  private QueryExecutionResult runChronologicalQuery(
    String fromWhere,
    List<Object> baseParams,
    Cursor cursor,
    int pageSize
  ) {
    if (cursor != null && CURSOR_MODE_SEARCH.equals(cursor.mode())) {
      throw new ApiBadRequestException("Invalid cursor for non-search query");
    }

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
        f.snoozed_until,
        0.0::double precision AS search_rank
      """
    );
    sql.append(fromWhere);

    List<Object> params = new ArrayList<>(baseParams);
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

    return new QueryExecutionResult(rows, false);
  }

  private QueryExecutionResult runRankedQuery(
    String fromWhere,
    List<Object> baseParams,
    Cursor cursor,
    int pageSize,
    String searchText
  ) {
    if (cursor != null && CURSOR_MODE_TIME.equals(cursor.mode())) {
      throw new ApiBadRequestException("Invalid cursor for ranked search query");
    }

    List<SearchExecutionStrategy> strategies = List.of(
      SearchExecutionStrategy.FTS_WEBSEARCH,
      SearchExecutionStrategy.FTS_PLAINTO,
      SearchExecutionStrategy.ILIKE
    );

    for (SearchExecutionStrategy strategy : strategies) {
      try {
        return executeRankedQuery(fromWhere, baseParams, cursor, pageSize, searchText, strategy);
      } catch (DataAccessException exception) {
        if (strategy == SearchExecutionStrategy.ILIKE) {
          throw exception;
        }
        LOGGER.warn(
          "Search strategy {} failed; falling back for query '{}'",
          strategy,
          searchText
        );
      }
    }

    throw new IllegalStateException("Unable to execute ranked search query");
  }

  private QueryExecutionResult executeRankedQuery(
    String fromWhere,
    List<Object> baseParams,
    Cursor cursor,
    int pageSize,
    String searchText,
    SearchExecutionStrategy strategy
  ) {
    String rankExpression;
    String searchPredicate;
    List<Object> params = new ArrayList<>();

    if (strategy == SearchExecutionStrategy.FTS_WEBSEARCH) {
      rankExpression = "ts_rank(m.search_vector, websearch_to_tsquery('simple', ?))";
      searchPredicate = " AND m.search_vector @@ websearch_to_tsquery('simple', ?)";
      params.add(searchText);
    } else if (strategy == SearchExecutionStrategy.FTS_PLAINTO) {
      rankExpression = "ts_rank(m.search_vector, plainto_tsquery('simple', ?))";
      searchPredicate = " AND m.search_vector @@ plainto_tsquery('simple', ?)";
      params.add(searchText);
    } else {
      rankExpression = "0.0::double precision";
      searchPredicate =
        " AND ("
          + "lower(m.sender_email) LIKE ?"
          + " OR lower(COALESCE(m.sender_name, '')) LIKE ?"
          + " OR lower(COALESCE(m.subject, '')) LIKE ?"
          + " OR lower(COALESCE(m.snippet, '')) LIKE ?"
          + ")";
    }

    StringBuilder sql = new StringBuilder(
      """
      SELECT
        ranked.id,
        ranked.account_id,
        ranked.account_email,
        ranked.sender_name,
        ranked.sender_email,
        ranked.sender_domain,
        ranked.subject,
        ranked.snippet,
        ranked.received_at,
        ranked.is_unread,
        ranked.has_attachments,
        ranked.followup_status,
        ranked.needs_reply,
        ranked.due_at,
        ranked.snoozed_until,
        ranked.search_rank
      FROM (
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
          f.snoozed_until,
      """
    );
    sql.append(rankExpression).append(" AS search_rank ");
    sql.append(fromWhere);
    sql.append(searchPredicate);
    sql.append(" ) ranked WHERE 1=1");

    params.addAll(baseParams);
    if (strategy == SearchExecutionStrategy.FTS_WEBSEARCH || strategy == SearchExecutionStrategy.FTS_PLAINTO) {
      params.add(searchText);
    } else {
      String like = "%" + searchText + "%";
      params.add(like);
      params.add(like);
      params.add(like);
      params.add(like);
    }

    if (cursor != null) {
      sql.append(
        """
         AND (
           ranked.search_rank < ?
           OR (ranked.search_rank = ? AND ranked.received_at < ?)
           OR (ranked.search_rank = ? AND ranked.received_at = ? AND ranked.id < ?)
         )
        """
      );
      params.add(cursor.rank());
      params.add(cursor.rank());
      params.add(cursor.receivedAt());
      params.add(cursor.rank());
      params.add(cursor.receivedAt());
      params.add(cursor.id());
    }

    sql.append(" ORDER BY ranked.search_rank DESC, ranked.received_at DESC, ranked.id DESC LIMIT ?");
    params.add(pageSize + 1);

    List<MailboxRow> rows = jdbcTemplate.query(
      sql.toString(),
      (resultSet, rowNum) -> mapMailboxRow(resultSet),
      params.toArray()
    );
    return new QueryExecutionResult(rows, true);
  }

  private String buildSearchText(String query, List<String> keywords) {
    LinkedHashSet<String> parts = new LinkedHashSet<>();
    if (!query.isBlank()) {
      parts.add(query);
    }
    if (!keywords.isEmpty()) {
      parts.addAll(keywords);
    }
    return String.join(" ", parts).trim();
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
      resultSet.getObject("snoozed_until", OffsetDateTime.class),
      resultSet.getObject("search_rank", Double.class)
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
      String[] parts = decoded.split("\\|");

      // Backward compatibility with legacy cursor format: <receivedAt>|<id>
      if (parts.length == 2) {
        OffsetDateTime receivedAt = OffsetDateTime.parse(parts[0]);
        UUID id = UUID.fromString(parts[1]);
        return new Cursor(CURSOR_MODE_TIME, null, receivedAt, id);
      }

      if (parts.length == 3 && CURSOR_MODE_TIME.equals(parts[0])) {
        OffsetDateTime receivedAt = OffsetDateTime.parse(parts[1]);
        UUID id = UUID.fromString(parts[2]);
        return new Cursor(CURSOR_MODE_TIME, null, receivedAt, id);
      }

      if (parts.length == 4 && CURSOR_MODE_SEARCH.equals(parts[0])) {
        double rank = Double.parseDouble(parts[1]);
        OffsetDateTime receivedAt = OffsetDateTime.parse(parts[2]);
        UUID id = UUID.fromString(parts[3]);
        return new Cursor(CURSOR_MODE_SEARCH, rank, receivedAt, id);
      }

      throw new IllegalArgumentException("Invalid cursor format");
    } catch (RuntimeException exception) {
      throw new ApiBadRequestException("Invalid cursor");
    }
  }

  private String encodeTimeCursor(OffsetDateTime receivedAt, UUID id) {
    return encodeCursorPayload(CURSOR_MODE_TIME, receivedAt.toString(), id.toString());
  }

  private String encodeSearchCursor(double rank, OffsetDateTime receivedAt, UUID id) {
    return encodeCursorPayload(CURSOR_MODE_SEARCH, Double.toString(rank), receivedAt.toString(), id.toString());
  }

  private String encodeCursorPayload(String... parts) {
    String payload = String.join("|", parts);
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

  private enum SearchExecutionStrategy {
    FTS_WEBSEARCH,
    FTS_PLAINTO,
    ILIKE
  }

  private record Cursor(String mode, Double rank, OffsetDateTime receivedAt, UUID id) {}

  private record QueryExecutionResult(List<MailboxRow> rows, boolean ranked) {}

  public record SearchHealth(boolean configured, String method, int matches) {}

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
    OffsetDateTime snoozedUntil,
    Double searchRank
  ) {}
}
