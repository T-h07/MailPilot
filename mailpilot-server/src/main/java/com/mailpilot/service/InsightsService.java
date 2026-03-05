package com.mailpilot.service;

import com.mailpilot.api.error.ApiBadRequestException;
import com.mailpilot.api.model.InsightsSummaryResponse;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Duration;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class InsightsService {

  private static final int TOP_LIMIT = 10;

  private final JdbcTemplate jdbcTemplate;

  public InsightsService(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public InsightsSummaryResponse getSummary(String rawRange) {
    RangeWindow window = resolveRange(rawRange);
    Duration duration = Duration.between(window.start(), window.end());
    OffsetDateTime previousEnd = window.start();
    OffsetDateTime previousStart = previousEnd.minus(duration);

    Map<String, Object> summaryRow = jdbcTemplate.queryForMap(
      """
      SELECT
        COUNT(*) AS received_count,
        COUNT(DISTINCT lower(m.sender_email)) AS unique_senders
      FROM messages m
      WHERE m.is_sent = false AND m.received_at >= ? AND m.received_at < ?
      """,
      window.start(),
      window.end()
    );

    Map<String, Object> comparisonRow = jdbcTemplate.queryForMap(
      """
      SELECT
        COUNT(*) AS received_prev_count,
        COUNT(DISTINCT lower(m.sender_email)) AS unique_senders_prev_count
      FROM messages m
      WHERE m.is_sent = false AND m.received_at >= ? AND m.received_at < ?
      """,
      previousStart,
      previousEnd
    );

    int receivedCount = toInt(summaryRow.get("received_count"));
    int uniqueSenders = toInt(summaryRow.get("unique_senders"));
    int receivedPreviousCount = toInt(comparisonRow.get("received_prev_count"));
    int uniqueSendersPreviousCount = toInt(comparisonRow.get("unique_senders_prev_count"));

    List<InsightsSummaryResponse.DomainCount> topDomains = jdbcTemplate.query(
      """
      SELECT lower(m.sender_domain) AS domain, COUNT(*) AS count
      FROM messages m
      WHERE
        m.is_sent = false
        AND m.received_at >= ?
        AND m.received_at < ?
        AND m.sender_domain IS NOT NULL
        AND btrim(m.sender_domain) <> ''
      GROUP BY lower(m.sender_domain)
      ORDER BY COUNT(*) DESC, lower(m.sender_domain) ASC
      LIMIT ?
      """,
      (resultSet, rowNum) ->
        new InsightsSummaryResponse.DomainCount(
          resultSet.getString("domain"),
          resultSet.getInt("count")
        ),
      window.start(),
      window.end(),
      TOP_LIMIT
    );

    List<InsightsSummaryResponse.SenderCount> topSenders = jdbcTemplate.query(
      """
      SELECT lower(m.sender_email) AS email, COUNT(*) AS count
      FROM messages m
      WHERE
        m.is_sent = false
        AND m.received_at >= ?
        AND m.received_at < ?
        AND m.sender_email IS NOT NULL
        AND btrim(m.sender_email) <> ''
      GROUP BY lower(m.sender_email)
      ORDER BY COUNT(*) DESC, lower(m.sender_email) ASC
      LIMIT ?
      """,
      (resultSet, rowNum) ->
        new InsightsSummaryResponse.SenderCount(
          resultSet.getString("email"),
          resultSet.getInt("count")
        ),
      window.start(),
      window.end(),
      TOP_LIMIT
    );

    List<InsightsSummaryResponse.AccountCount> volumeByAccount = jdbcTemplate.query(
      """
      SELECT a.id AS account_id, a.email AS account_email, COUNT(*) AS count
      FROM messages m
      JOIN accounts a ON a.id = m.account_id
      WHERE m.is_sent = false AND m.received_at >= ? AND m.received_at < ?
      GROUP BY a.id, a.email
      ORDER BY COUNT(*) DESC, a.email ASC
      LIMIT ?
      """,
      this::mapAccountCount,
      window.start(),
      window.end(),
      TOP_LIMIT
    );

    Integer unreadNow = jdbcTemplate.queryForObject(
      "SELECT COUNT(*) FROM messages m WHERE m.is_sent = false AND m.is_read = false",
      Integer.class
    );

    List<InsightsSummaryResponse.DomainCount> unreadByDomain = jdbcTemplate.query(
      """
      SELECT lower(m.sender_domain) AS domain, COUNT(*) AS count
      FROM messages m
      WHERE
        m.is_sent = false
        AND m.is_read = false
        AND m.sender_domain IS NOT NULL
        AND btrim(m.sender_domain) <> ''
      GROUP BY lower(m.sender_domain)
      ORDER BY COUNT(*) DESC, lower(m.sender_domain) ASC
      LIMIT ?
      """,
      this::mapDomainCount,
      TOP_LIMIT
    );

    Map<String, Object> followupsNowRow = jdbcTemplate.queryForMap(
      """
      SELECT
        (
          SELECT COUNT(*)
          FROM followups f
          JOIN messages m ON m.id = f.message_id
          WHERE m.is_sent = false AND f.status = 'OPEN' AND f.needs_reply = true
        ) AS needs_reply,
        (
          SELECT COUNT(*)
          FROM followups f
          JOIN messages m ON m.id = f.message_id
          WHERE m.is_sent = false AND f.status = 'OPEN' AND f.due_at < now()
        ) AS overdue,
        (
          SELECT COUNT(*)
          FROM followups f
          JOIN messages m ON m.id = f.message_id
          WHERE
            m.is_sent = false
            AND f.status = 'OPEN'
            AND f.due_at >= date_trunc('day', now())
            AND f.due_at < date_trunc('day', now()) + interval '1 day'
        ) AS due_today,
        (
          SELECT COUNT(*)
          FROM followups f
          JOIN messages m ON m.id = f.message_id
          WHERE m.is_sent = false AND f.status = 'OPEN' AND f.snoozed_until > now()
        ) AS snoozed
      """
    );

    List<Map<String, Object>> volumeRows = jdbcTemplate.queryForList(
      """
      SELECT (m.received_at AT TIME ZONE 'UTC')::date AS day, COUNT(*) AS count
      FROM messages m
      WHERE m.is_sent = false AND m.received_at >= ? AND m.received_at < ?
      GROUP BY (m.received_at AT TIME ZONE 'UTC')::date
      ORDER BY day ASC
      """,
      window.start(),
      window.end()
    );

    List<Map<String, Object>> unreadRows = jdbcTemplate.queryForList(
      """
      SELECT (m.received_at AT TIME ZONE 'UTC')::date AS day, COUNT(*) AS count
      FROM messages m
      WHERE
        m.is_sent = false
        AND m.is_read = false
        AND m.received_at >= ?
        AND m.received_at < ?
      GROUP BY (m.received_at AT TIME ZONE 'UTC')::date
      ORDER BY day ASC
      """,
      window.start(),
      window.end()
    );

    List<Map<String, Object>> bossRows = jdbcTemplate.queryForList(
      """
      SELECT (m.received_at AT TIME ZONE 'UTC')::date AS day, COUNT(*) AS count
      FROM messages m
      LEFT JOIN sender_rules sr_email
        ON sr_email.match_type = 'EMAIL' AND lower(sr_email.match_value) = lower(m.sender_email)
      LEFT JOIN sender_rules sr_domain
        ON sr_domain.match_type = 'DOMAIN' AND lower(sr_domain.match_value) = lower(m.sender_domain)
      WHERE
        m.is_sent = false
        AND m.received_at >= ?
        AND m.received_at < ?
        AND upper(COALESCE(sr_email.label, sr_domain.label, '')) = 'BOSS'
      GROUP BY (m.received_at AT TIME ZONE 'UTC')::date
      ORDER BY day ASC
      """,
      window.start(),
      window.end()
    );

    List<Map<String, Object>> followupsDoneRows = jdbcTemplate.queryForList(
      """
      SELECT (f.updated_at AT TIME ZONE 'UTC')::date AS day, COUNT(*) AS count
      FROM followups f
      JOIN messages m ON m.id = f.message_id
      WHERE
        m.is_sent = false
        AND f.status = 'DONE'
        AND f.updated_at >= ?
        AND f.updated_at < ?
      GROUP BY (f.updated_at AT TIME ZONE 'UTC')::date
      ORDER BY day ASC
      """,
      window.start(),
      window.end()
    );

    Map<LocalDate, Integer> volumeByDay = new HashMap<>();
    for (Map<String, Object> row : volumeRows) {
      LocalDate day = toLocalDate(row.get("day"));
      if (day == null) {
        continue;
      }
      volumeByDay.put(day, toInt(row.get("count")));
    }

    Map<LocalDate, Integer> unreadByDay = new HashMap<>();
    for (Map<String, Object> row : unreadRows) {
      LocalDate day = toLocalDate(row.get("day"));
      if (day == null) {
        continue;
      }
      unreadByDay.put(day, toInt(row.get("count")));
    }

    Map<LocalDate, Integer> bossByDay = new HashMap<>();
    for (Map<String, Object> row : bossRows) {
      LocalDate day = toLocalDate(row.get("day"));
      if (day == null) {
        continue;
      }
      bossByDay.put(day, toInt(row.get("count")));
    }

    Map<LocalDate, Integer> followupsDoneByDay = new HashMap<>();
    for (Map<String, Object> row : followupsDoneRows) {
      LocalDate day = toLocalDate(row.get("day"));
      if (day == null) {
        continue;
      }
      followupsDoneByDay.put(day, toInt(row.get("count")));
    }

    List<InsightsSummaryResponse.VolumePoint> receivedSeries = new ArrayList<>();
    List<InsightsSummaryResponse.VolumePoint> unreadSeries = new ArrayList<>();
    List<InsightsSummaryResponse.VolumePoint> bossSeries = new ArrayList<>();
    List<InsightsSummaryResponse.VolumePoint> followupsDoneSeries = new ArrayList<>();
    LocalDate current = window.start().withOffsetSameInstant(ZoneOffset.UTC).toLocalDate();
    LocalDate lastDay = window.end().minusNanos(1).withOffsetSameInstant(ZoneOffset.UTC).toLocalDate();
    while (!current.isAfter(lastDay)) {
      receivedSeries.add(
        new InsightsSummaryResponse.VolumePoint(
          current.toString(),
          volumeByDay.getOrDefault(current, 0)
        )
      );
      unreadSeries.add(
        new InsightsSummaryResponse.VolumePoint(
          current.toString(),
          unreadByDay.getOrDefault(current, 0)
        )
      );
      bossSeries.add(
        new InsightsSummaryResponse.VolumePoint(
          current.toString(),
          bossByDay.getOrDefault(current, 0)
        )
      );
      followupsDoneSeries.add(
        new InsightsSummaryResponse.VolumePoint(
          current.toString(),
          followupsDoneByDay.getOrDefault(current, 0)
        )
      );
      current = current.plusDays(1);
    }

    return new InsightsSummaryResponse(
      window.label(),
      receivedCount,
      uniqueSenders,
      new InsightsSummaryResponse.Comparison(
        receivedPreviousCount,
        percentDelta(receivedCount, receivedPreviousCount),
        uniqueSendersPreviousCount,
        percentDelta(uniqueSenders, uniqueSendersPreviousCount)
      ),
      topDomains,
      topSenders,
      volumeByAccount,
      unreadNow == null ? 0 : unreadNow,
      unreadByDomain,
      new InsightsSummaryResponse.FollowupCountsNow(
        toInt(followupsNowRow.get("needs_reply")),
        toInt(followupsNowRow.get("overdue")),
        toInt(followupsNowRow.get("due_today")),
        toInt(followupsNowRow.get("snoozed"))
      ),
      new InsightsSummaryResponse.Series(receivedSeries, unreadSeries, bossSeries, followupsDoneSeries)
    );
  }

  private RangeWindow resolveRange(String rawRange) {
    String range = rawRange == null ? "7d" : rawRange.trim().toLowerCase();
    OffsetDateTime end = OffsetDateTime.now(ZoneOffset.UTC);
    OffsetDateTime start = switch (range) {
      case "2d" -> end.minusDays(2);
      case "7d" -> end.minusDays(7);
      case "14d" -> end.minusDays(14);
      case "30d" -> end.minusDays(30);
      case "6m" -> end.minusMonths(6);
      default -> throw new ApiBadRequestException("range must be one of: 2d, 7d, 14d, 30d, 6m");
    };
    return new RangeWindow(range, start, end);
  }

  private LocalDate toLocalDate(Object value) {
    if (value instanceof java.sql.Date sqlDate) {
      return sqlDate.toLocalDate();
    }
    if (value instanceof LocalDate localDate) {
      return localDate;
    }
    return null;
  }

  private int toInt(Object value) {
    if (value instanceof Number number) {
      return number.intValue();
    }
    return 0;
  }

  private InsightsSummaryResponse.DomainCount mapDomainCount(ResultSet resultSet, int rowNum)
    throws SQLException {
    return new InsightsSummaryResponse.DomainCount(
      resultSet.getString("domain"),
      resultSet.getInt("count")
    );
  }

  private InsightsSummaryResponse.AccountCount mapAccountCount(ResultSet resultSet, int rowNum)
    throws SQLException {
    return new InsightsSummaryResponse.AccountCount(
      resultSet.getObject("account_id", UUID.class),
      resultSet.getString("account_email"),
      resultSet.getInt("count")
    );
  }

  private double percentDelta(int current, int previous) {
    if (previous == 0) {
      return current == 0 ? 0.0 : 100.0;
    }
    return ((current - previous) * 100.0) / previous;
  }

  private record RangeWindow(String label, OffsetDateTime start, OffsetDateTime end) {}
}
