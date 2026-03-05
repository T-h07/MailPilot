package com.mailpilot.service;

import com.mailpilot.api.error.ApiBadRequestException;
import com.mailpilot.api.model.InsightsSummaryResponse;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
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

    Map<LocalDate, Integer> volumeByDay = new HashMap<>();
    for (Map<String, Object> row : volumeRows) {
      LocalDate day = toLocalDate(row.get("day"));
      if (day == null) {
        continue;
      }
      volumeByDay.put(day, toInt(row.get("count")));
    }

    List<InsightsSummaryResponse.VolumePoint> volumeSeries = new ArrayList<>();
    LocalDate current = window.start().withOffsetSameInstant(ZoneOffset.UTC).toLocalDate();
    LocalDate lastDay = window.end().minusNanos(1).withOffsetSameInstant(ZoneOffset.UTC).toLocalDate();
    while (!current.isAfter(lastDay)) {
      volumeSeries.add(
        new InsightsSummaryResponse.VolumePoint(
          current.toString(),
          volumeByDay.getOrDefault(current, 0)
        )
      );
      current = current.plusDays(1);
    }

    return new InsightsSummaryResponse(
      window.label(),
      toInt(summaryRow.get("received_count")),
      toInt(summaryRow.get("unique_senders")),
      topDomains,
      topSenders,
      new InsightsSummaryResponse.Series(volumeSeries)
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

  private record RangeWindow(String label, OffsetDateTime start, OffsetDateTime end) {}
}
