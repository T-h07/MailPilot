package com.mailpilot.service;

import com.mailpilot.api.model.ViewResponse;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class BadgeService {

  public static final String INBOX_KEY = "INBOX";

  private final JdbcTemplate jdbcTemplate;
  private final ViewService viewService;

  public BadgeService(JdbcTemplate jdbcTemplate, ViewService viewService) {
    this.jdbcTemplate = jdbcTemplate;
    this.viewService = viewService;
  }

  public void ensureInboxSeenExists() {
    ensureSeenExists(INBOX_KEY, OffsetDateTime.now(ZoneOffset.UTC));
  }

  public void ensureViewSeenExists(UUID viewId) {
    // Validate existence; raises 404 semantics upstream if invalid.
    viewService.getViewDefinition(viewId);
    ensureSeenExists(viewKey(viewId), OffsetDateTime.now(ZoneOffset.UTC));
  }

  public void markInboxOpened() {
    ensureInboxSeenExists();
    markSeenNow(INBOX_KEY);
  }

  public void markViewOpened(UUID viewId) {
    ensureViewSeenExists(viewId);
    markSeenNow(viewKey(viewId));
  }

  public BadgeSummary computeBadgeSummary() {
    List<ViewMatcher> matchers = loadViewMatchers();
    List<String> seenKeys = new ArrayList<>();
    seenKeys.add(INBOX_KEY);
    for (ViewMatcher matcher : matchers) {
      seenKeys.add(viewKey(matcher.id()));
    }

    OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
    Map<String, OffsetDateTime> seenByKey = loadSeenByKeys(seenKeys);

    if (!seenByKey.containsKey(INBOX_KEY)) {
      ensureSeenExists(INBOX_KEY, now);
      seenByKey.put(INBOX_KEY, now);
    }

    int inboxCount = countInboxSince(seenByKey.get(INBOX_KEY));
    int viewsTotal = 0;
    Map<String, Integer> viewCounts = new LinkedHashMap<>();

    for (ViewMatcher matcher : matchers) {
      String key = viewKey(matcher.id());
      OffsetDateTime seenAt = seenByKey.get(key);
      if (seenAt == null) {
        ensureSeenExists(key, now);
        seenAt = now;
      }

      int count = countViewSince(matcher, seenAt);
      viewCounts.put(matcher.id().toString(), count);
      viewsTotal += count;
    }

    return new BadgeSummary(inboxCount, viewsTotal, viewCounts);
  }

  public List<ViewMatcher> loadViewMatchers() {
    List<ViewResponse> views = viewService.listViews();
    List<ViewMatcher> matchers = new ArrayList<>(views.size());

    for (ViewResponse view : views) {
      matchers.add(
        new ViewMatcher(
          view.id(),
          view.name(),
          view.scopeType(),
          Set.copyOf(view.selectedAccountIds()),
          normalizeSet(view.rules().senderDomains()),
          normalizeSet(view.rules().senderEmails()),
          normalizeList(view.rules().keywords()),
          view.rules().unreadOnly()
        )
      );
    }

    return List.copyOf(matchers);
  }

  public List<UUID> findMatchingViewIds(MessageCandidate candidate) {
    return findMatchingViewIds(candidate, loadViewMatchers());
  }

  public List<UUID> findMatchingViewIds(MessageCandidate candidate, List<ViewMatcher> matchers) {
    if (candidate == null || matchers.isEmpty()) {
      return List.of();
    }

    List<UUID> matches = new ArrayList<>();
    String senderEmail = normalize(candidate.senderEmail());
    String senderDomain = normalize(candidate.senderDomain());
    String subject = normalize(candidate.subject());
    String snippet = normalize(candidate.snippet());

    for (ViewMatcher matcher : matchers) {
      if (!"ALL".equals(matcher.scopeType()) && !matcher.selectedAccountIds().contains(candidate.accountId())) {
        continue;
      }
      if (matcher.unreadOnly() && candidate.isRead()) {
        continue;
      }
      if (!matcher.senderDomains().isEmpty() && !matcher.senderDomains().contains(senderDomain)) {
        continue;
      }
      if (!matcher.senderEmails().isEmpty() && !matcher.senderEmails().contains(senderEmail)) {
        continue;
      }
      if (!matcher.keywords().isEmpty()) {
        boolean keywordMatched = false;
        for (String keyword : matcher.keywords()) {
          if (subject.contains(keyword) || snippet.contains(keyword)) {
            keywordMatched = true;
            break;
          }
        }
        if (!keywordMatched) {
          continue;
        }
      }
      matches.add(matcher.id());
    }

    return List.copyOf(matches);
  }

  private Map<String, OffsetDateTime> loadSeenByKeys(List<String> keys) {
    if (keys.isEmpty()) {
      return Map.of();
    }

    String sql =
      "SELECT key, last_opened_at FROM mailbox_seen WHERE key IN (" + placeholders(keys.size()) + ")";

    Map<String, OffsetDateTime> results = new LinkedHashMap<>();
    jdbcTemplate.query(
      sql,
      (resultSet) -> {
        String key = resultSet.getString("key");
        OffsetDateTime lastOpenedAt = resultSet.getObject("last_opened_at", OffsetDateTime.class);
        if (StringUtils.hasText(key) && lastOpenedAt != null) {
          results.put(key, lastOpenedAt);
        }
      },
      keys.toArray()
    );
    return results;
  }

  private int countInboxSince(OffsetDateTime seenAt) {
    Integer count = jdbcTemplate.queryForObject(
      """
      SELECT COUNT(*)
      FROM messages
      WHERE created_at > ?
        AND is_inbox = true
        AND is_sent = false
        AND is_draft = false
        AND NOT ('SPAM' = ANY(gmail_label_ids) OR 'TRASH' = ANY(gmail_label_ids))
      """,
      Integer.class,
      seenAt
    );
    return count == null ? 0 : count;
  }

  private int countViewSince(ViewMatcher matcher, OffsetDateTime seenAt) {
    if (!"ALL".equals(matcher.scopeType()) && matcher.selectedAccountIds().isEmpty()) {
      return 0;
    }

    StringBuilder sql = new StringBuilder("SELECT COUNT(*) FROM messages m WHERE m.created_at > ?");
    List<Object> params = new ArrayList<>();
    params.add(seenAt);

    if (!"ALL".equals(matcher.scopeType())) {
      sql.append(" AND m.account_id IN (").append(placeholders(matcher.selectedAccountIds().size())).append(")");
      params.addAll(matcher.selectedAccountIds());
    }

    if (matcher.unreadOnly()) {
      sql.append(" AND m.is_read = false");
    }

    if (!matcher.senderDomains().isEmpty()) {
      sql.append(" AND lower(m.sender_domain) IN (").append(placeholders(matcher.senderDomains().size())).append(")");
      params.addAll(matcher.senderDomains());
    }

    if (!matcher.senderEmails().isEmpty()) {
      sql.append(" AND lower(m.sender_email) IN (").append(placeholders(matcher.senderEmails().size())).append(")");
      params.addAll(matcher.senderEmails());
    }

    if (!matcher.keywords().isEmpty()) {
      sql.append(" AND (");
      for (int i = 0; i < matcher.keywords().size(); i++) {
        if (i > 0) {
          sql.append(" OR ");
        }
        sql.append("(lower(COALESCE(m.subject, '')) LIKE ? OR lower(COALESCE(m.snippet, '')) LIKE ?)");
        String like = "%" + matcher.keywords().get(i) + "%";
        params.add(like);
        params.add(like);
      }
      sql.append(")");
    }

    Integer count = jdbcTemplate.queryForObject(sql.toString(), Integer.class, params.toArray());
    return count == null ? 0 : count;
  }

  private void ensureSeenExists(String key, OffsetDateTime seenAt) {
    jdbcTemplate.update(
      """
      INSERT INTO mailbox_seen(key, last_opened_at)
      VALUES (?, ?)
      ON CONFLICT (key) DO NOTHING
      """,
      key,
      seenAt
    );
  }

  private void markSeenNow(String key) {
    jdbcTemplate.update(
      "UPDATE mailbox_seen SET last_opened_at = now() WHERE key = ?",
      key
    );
  }

  private Set<String> normalizeSet(List<String> values) {
    if (values == null || values.isEmpty()) {
      return Set.of();
    }

    Set<String> normalized = new LinkedHashSet<>();
    for (String value : values) {
      String item = normalize(value);
      if (!item.isBlank()) {
        normalized.add(item);
      }
    }
    return Set.copyOf(normalized);
  }

  private List<String> normalizeList(List<String> values) {
    if (values == null || values.isEmpty()) {
      return List.of();
    }

    Set<String> normalized = new LinkedHashSet<>();
    for (String value : values) {
      String item = normalize(value);
      if (!item.isBlank()) {
        normalized.add(item);
      }
    }
    return List.copyOf(normalized);
  }

  private String normalize(String value) {
    if (!StringUtils.hasText(value)) {
      return "";
    }
    return value.trim().toLowerCase(Locale.ROOT);
  }

  private String placeholders(int count) {
    return String.join(",", Collections.nCopies(count, "?"));
  }

  private String viewKey(UUID viewId) {
    return "VIEW:" + viewId;
  }

  public record BadgeSummary(int inbox, int viewsTotal, Map<String, Integer> views) {}

  public record ViewMatcher(
    UUID id,
    String name,
    String scopeType,
    Set<UUID> selectedAccountIds,
    Set<String> senderDomains,
    Set<String> senderEmails,
    List<String> keywords,
    boolean unreadOnly
  ) {}

  public record MessageCandidate(
    UUID accountId,
    String senderEmail,
    String senderDomain,
    String subject,
    String snippet,
    boolean isRead
  ) {}
}
