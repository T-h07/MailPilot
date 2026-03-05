package com.mailpilot.service;

import com.mailpilot.api.error.ApiBadRequestException;
import com.mailpilot.api.model.InsightsSummaryResponse;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
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

    Map<String, Object> summaryAndComparisonRow =
        jdbcTemplate.queryForMap(
            """
      SELECT
        COUNT(*) FILTER (
          WHERE m.is_sent = false AND m.received_at >= ? AND m.received_at < ?
        ) AS received_count,
        COUNT(DISTINCT lower(m.sender_email)) FILTER (
          WHERE m.is_sent = false AND m.received_at >= ? AND m.received_at < ?
        ) AS unique_senders,
        COUNT(*) FILTER (
          WHERE m.is_sent = false AND m.received_at >= ? AND m.received_at < ?
        ) AS received_prev_count,
        COUNT(DISTINCT lower(m.sender_email)) FILTER (
          WHERE m.is_sent = false AND m.received_at >= ? AND m.received_at < ?
        ) AS unique_senders_prev_count,
        COUNT(*) FILTER (WHERE m.is_sent = false AND m.is_read = false) AS unread_now
      FROM messages m
      """,
            window.start(),
            window.end(),
            window.start(),
            window.end(),
            previousStart,
            previousEnd,
            previousStart,
            previousEnd);

    int receivedCount = toInt(summaryAndComparisonRow.get("received_count"));
    int uniqueSenders = toInt(summaryAndComparisonRow.get("unique_senders"));
    int receivedPreviousCount = toInt(summaryAndComparisonRow.get("received_prev_count"));
    int uniqueSendersPreviousCount =
        toInt(summaryAndComparisonRow.get("unique_senders_prev_count"));

    List<InsightsSummaryResponse.DomainCount> topDomains =
        jdbcTemplate.query(
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
                    resultSet.getString("domain"), resultSet.getInt("count")),
            window.start(),
            window.end(),
            TOP_LIMIT);

    List<InsightsSummaryResponse.SenderCount> topSenders =
        jdbcTemplate.query(
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
                    resultSet.getString("email"), resultSet.getInt("count")),
            window.start(),
            window.end(),
            TOP_LIMIT);

    List<InsightsSummaryResponse.AccountCount> volumeByAccount =
        jdbcTemplate.query(
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
            TOP_LIMIT);

    List<InsightsSummaryResponse.DomainCount> unreadByDomain =
        jdbcTemplate.query(
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
            TOP_LIMIT);

    Map<String, Object> followupsNowRow =
        jdbcTemplate.queryForMap(
            """
      SELECT
        COUNT(*) FILTER (WHERE f.status = 'OPEN' AND f.needs_reply = true) AS needs_reply,
        COUNT(*) FILTER (WHERE f.status = 'OPEN' AND f.due_at < now()) AS overdue,
        COUNT(*) FILTER (
          WHERE
            f.status = 'OPEN'
            AND f.due_at >= date_trunc('day', now())
            AND f.due_at < date_trunc('day', now()) + interval '1 day'
        ) AS due_today,
        COUNT(*) FILTER (WHERE f.status = 'OPEN' AND f.snoozed_until > now()) AS snoozed
      FROM followups f
      JOIN messages m ON m.id = f.message_id
      WHERE m.is_sent = false
      """);

    List<SeriesRow> seriesRows =
        jdbcTemplate.query(
            """
      WITH days AS (
        SELECT generate_series(
          (? AT TIME ZONE 'UTC')::date,
          ((? - interval '1 microsecond') AT TIME ZONE 'UTC')::date,
          interval '1 day'
        )::date AS day
      ),
      volume_daily AS (
        SELECT
          (m.received_at AT TIME ZONE 'UTC')::date AS day,
          COUNT(*) AS received_count,
          COUNT(*) FILTER (WHERE m.is_read = false) AS unread_count
        FROM messages m
        WHERE m.is_sent = false AND m.received_at >= ? AND m.received_at < ?
        GROUP BY (m.received_at AT TIME ZONE 'UTC')::date
      ),
      boss_daily AS (
        SELECT
          (m.received_at AT TIME ZONE 'UTC')::date AS day,
          COUNT(*) AS boss_count
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
      ),
      followups_done_daily AS (
        SELECT
          (f.updated_at AT TIME ZONE 'UTC')::date AS day,
          COUNT(*) AS followups_done_count
        FROM followups f
        JOIN messages m ON m.id = f.message_id
        WHERE
          m.is_sent = false
          AND f.status = 'DONE'
          AND f.updated_at >= ?
          AND f.updated_at < ?
        GROUP BY (f.updated_at AT TIME ZONE 'UTC')::date
      )
      SELECT
        d.day,
        COALESCE(vd.received_count, 0) AS received_count,
        COALESCE(vd.unread_count, 0) AS unread_count,
        COALESCE(bd.boss_count, 0) AS boss_count,
        COALESCE(fdd.followups_done_count, 0) AS followups_done_count
      FROM days d
      LEFT JOIN volume_daily vd ON vd.day = d.day
      LEFT JOIN boss_daily bd ON bd.day = d.day
      LEFT JOIN followups_done_daily fdd ON fdd.day = d.day
      ORDER BY d.day ASC
      """,
            (resultSet, rowNum) ->
                new SeriesRow(
                    resultSet.getDate("day").toLocalDate().toString(),
                    resultSet.getInt("received_count"),
                    resultSet.getInt("unread_count"),
                    resultSet.getInt("boss_count"),
                    resultSet.getInt("followups_done_count")),
            window.start(),
            window.end(),
            window.start(),
            window.end(),
            window.start(),
            window.end(),
            window.start(),
            window.end());

    List<InsightsSummaryResponse.VolumePoint> receivedSeries = new ArrayList<>();
    List<InsightsSummaryResponse.VolumePoint> unreadSeries = new ArrayList<>();
    List<InsightsSummaryResponse.VolumePoint> bossSeries = new ArrayList<>();
    List<InsightsSummaryResponse.VolumePoint> followupsDoneSeries = new ArrayList<>();
    for (SeriesRow row : seriesRows) {
      receivedSeries.add(new InsightsSummaryResponse.VolumePoint(row.day(), row.receivedCount()));
      unreadSeries.add(new InsightsSummaryResponse.VolumePoint(row.day(), row.unreadCount()));
      bossSeries.add(new InsightsSummaryResponse.VolumePoint(row.day(), row.bossCount()));
      followupsDoneSeries.add(
          new InsightsSummaryResponse.VolumePoint(row.day(), row.followupsDoneCount()));
    }

    return new InsightsSummaryResponse(
        window.label(),
        receivedCount,
        uniqueSenders,
        new InsightsSummaryResponse.Comparison(
            receivedPreviousCount,
            percentDelta(receivedCount, receivedPreviousCount),
            uniqueSendersPreviousCount,
            percentDelta(uniqueSenders, uniqueSendersPreviousCount)),
        topDomains,
        topSenders,
        volumeByAccount,
        toInt(summaryAndComparisonRow.get("unread_now")),
        unreadByDomain,
        new InsightsSummaryResponse.FollowupCountsNow(
            toInt(followupsNowRow.get("needs_reply")),
            toInt(followupsNowRow.get("overdue")),
            toInt(followupsNowRow.get("due_today")),
            toInt(followupsNowRow.get("snoozed"))),
        new InsightsSummaryResponse.Series(
            receivedSeries, unreadSeries, bossSeries, followupsDoneSeries));
  }

  private RangeWindow resolveRange(String rawRange) {
    String range = rawRange == null ? "7d" : rawRange.trim().toLowerCase();
    OffsetDateTime end = OffsetDateTime.now(ZoneOffset.UTC);
    OffsetDateTime start =
        switch (range) {
          case "2d" -> end.minusDays(2);
          case "7d" -> end.minusDays(7);
          case "14d" -> end.minusDays(14);
          case "30d" -> end.minusDays(30);
          case "6m" -> end.minusMonths(6);
          default -> throw new ApiBadRequestException("range must be one of: 2d, 7d, 14d, 30d, 6m");
        };
    return new RangeWindow(range, start, end);
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
        resultSet.getString("domain"), resultSet.getInt("count"));
  }

  private InsightsSummaryResponse.AccountCount mapAccountCount(ResultSet resultSet, int rowNum)
      throws SQLException {
    return new InsightsSummaryResponse.AccountCount(
        resultSet.getObject("account_id", UUID.class),
        resultSet.getString("account_email"),
        resultSet.getInt("count"));
  }

  private double percentDelta(int current, int previous) {
    if (previous == 0) {
      return current == 0 ? 0.0 : 100.0;
    }
    return ((current - previous) * 100.0) / previous;
  }

  private record SeriesRow(
      String day, int receivedCount, int unreadCount, int bossCount, int followupsDoneCount) {}

  private record RangeWindow(String label, OffsetDateTime start, OffsetDateTime end) {}
}
