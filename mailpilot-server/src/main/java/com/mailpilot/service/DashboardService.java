package com.mailpilot.service;

import com.mailpilot.api.model.DashboardSummaryResponse;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class DashboardService {

  private static final int TOP_LIMIT = 8;

  private final JdbcTemplate jdbcTemplate;

  public DashboardService(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public DashboardSummaryResponse getSummary() {
    Map<String, Object> messageSummaryRow =
        jdbcTemplate.queryForMap(
            """
      SELECT
        COUNT(*) FILTER (WHERE m.is_read = false) AS unread_total,
        COUNT(*) FILTER (
          WHERE m.received_at >= now() - interval '24 hours' AND m.received_at < now()
        ) AS received_last_24h,
        COUNT(*) FILTER (
          WHERE m.received_at >= now() - interval '48 hours' AND m.received_at < now() - interval '24 hours'
        ) AS received_prev_24h,
        COUNT(*) FILTER (
          WHERE m.is_read = false AND m.received_at < now() - interval '24 hours'
        ) AS unread_prev_24h_approx
      FROM messages m
      WHERE m.is_sent = false
      """);

    Map<String, Object> followupSummaryRow =
        jdbcTemplate.queryForMap(
            """
      SELECT
        COUNT(*) FILTER (WHERE f.status = 'OPEN' AND f.needs_reply = true) AS needs_reply_open,
        COUNT(*) FILTER (WHERE f.status = 'OPEN' AND f.due_at < now()) AS overdue,
        COUNT(*) FILTER (
          WHERE
            f.status = 'OPEN'
            AND f.due_at >= date_trunc('day', now())
            AND f.due_at < date_trunc('day', now()) + interval '1 day'
        ) AS due_today,
        COUNT(*) FILTER (WHERE f.status = 'OPEN' AND f.snoozed_until > now()) AS snoozed,
        COUNT(*) FILTER (WHERE f.status = 'OPEN') AS open_followups_total,
        COUNT(*) FILTER (
          WHERE
            f.status = 'OPEN'
            AND f.snoozed_until > now()
            AND f.snoozed_until <= now() + interval '24 hours'
        ) AS snoozed_waking_next_24h,
        COUNT(*) FILTER (
          WHERE
            f.status = 'OPEN'
            AND f.needs_reply = true
            AND f.created_at < now() - interval '24 hours'
        ) AS needs_reply_prev_24h_approx,
        COUNT(*) FILTER (
          WHERE
            f.status = 'OPEN'
            AND f.due_at < now() - interval '24 hours'
            AND f.created_at < now() - interval '24 hours'
        ) AS overdue_prev_24h_approx
      FROM followups f
      JOIN messages m ON m.id = f.message_id
      WHERE m.is_sent = false
      """);

    Integer unreadBossValue =
        jdbcTemplate.queryForObject(
            """
      SELECT COUNT(*)
      FROM messages m
      LEFT JOIN sender_rules sr_email
        ON sr_email.match_type = 'EMAIL' AND lower(sr_email.match_value) = lower(m.sender_email)
      LEFT JOIN sender_rules sr_domain
        ON sr_domain.match_type = 'DOMAIN' AND lower(sr_domain.match_value) = lower(m.sender_domain)
      WHERE
        m.is_sent = false
        AND m.is_read = false
        AND upper(COALESCE(sr_email.label, sr_domain.label, '')) = 'BOSS'
      """,
            Integer.class);

    int unreadTotal = toInt(messageSummaryRow.get("unread_total"));
    int needsReplyOpen = toInt(followupSummaryRow.get("needs_reply_open"));
    int overdue = toInt(followupSummaryRow.get("overdue"));
    int dueToday = toInt(followupSummaryRow.get("due_today"));
    int snoozed = toInt(followupSummaryRow.get("snoozed"));
    int unreadBoss = unreadBossValue == null ? 0 : unreadBossValue;
    int receivedLast24h = toInt(messageSummaryRow.get("received_last_24h"));
    int receivedPrev24h = toInt(messageSummaryRow.get("received_prev_24h"));
    int openFollowupsTotal = toInt(followupSummaryRow.get("open_followups_total"));
    int snoozedWakingNext24h = toInt(followupSummaryRow.get("snoozed_waking_next_24h"));
    int unreadPrev24h = toInt(messageSummaryRow.get("unread_prev_24h_approx"));
    int needsReplyPrev24h = toInt(followupSummaryRow.get("needs_reply_prev_24h_approx"));
    int overduePrev24h = toInt(followupSummaryRow.get("overdue_prev_24h_approx"));

    List<DashboardSummaryResponse.DomainCount> topDomainsUnread =
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

    List<DashboardSummaryResponse.SenderCount> topSendersUnread =
        jdbcTemplate.query(
            """
      SELECT lower(m.sender_email) AS email, COUNT(*) AS count
      FROM messages m
      WHERE
        m.is_sent = false
        AND m.is_read = false
        AND m.sender_email IS NOT NULL
        AND btrim(m.sender_email) <> ''
      GROUP BY lower(m.sender_email)
      ORDER BY COUNT(*) DESC, lower(m.sender_email) ASC
      LIMIT ?
      """,
            this::mapSenderCount,
            TOP_LIMIT);

    List<DashboardSummaryResponse.DomainCount> topDomainsReceived24h =
        jdbcTemplate.query(
            """
      SELECT lower(m.sender_domain) AS domain, COUNT(*) AS count
      FROM messages m
      WHERE
        m.is_sent = false
        AND m.received_at >= now() - interval '24 hours'
        AND m.received_at < now()
        AND m.sender_domain IS NOT NULL
        AND btrim(m.sender_domain) <> ''
      GROUP BY lower(m.sender_domain)
      ORDER BY COUNT(*) DESC, lower(m.sender_domain) ASC
      LIMIT ?
      """,
            this::mapDomainCount,
            TOP_LIMIT);

    List<DashboardSummaryResponse.SenderCount> topSendersReceived24h =
        jdbcTemplate.query(
            """
      SELECT lower(m.sender_email) AS email, COUNT(*) AS count
      FROM messages m
      WHERE
        m.is_sent = false
        AND m.received_at >= now() - interval '24 hours'
        AND m.received_at < now()
        AND m.sender_email IS NOT NULL
        AND btrim(m.sender_email) <> ''
      GROUP BY lower(m.sender_email)
      ORDER BY COUNT(*) DESC, lower(m.sender_email) ASC
      LIMIT ?
      """,
            this::mapSenderCount,
            TOP_LIMIT);

    List<DashboardSummaryResponse.AccountCount> unreadByAccount =
        jdbcTemplate.query(
            """
      SELECT a.id AS account_id, a.email AS account_email, COUNT(*) AS count
      FROM messages m
      JOIN accounts a ON a.id = m.account_id
      WHERE m.is_sent = false AND m.is_read = false
      GROUP BY a.id, a.email
      ORDER BY COUNT(*) DESC, a.email ASC
      LIMIT ?
      """,
            this::mapAccountCount,
            TOP_LIMIT);

    List<String> bossSenderDomains =
        jdbcTemplate.query(
            """
      SELECT lower(sr.match_value) AS match_value
      FROM sender_rules sr
      WHERE sr.match_type = 'DOMAIN' AND upper(sr.label) = 'BOSS'
      ORDER BY lower(sr.match_value) ASC
      """,
            (resultSet, rowNum) -> resultSet.getString("match_value"));

    List<String> bossSenderEmails =
        jdbcTemplate.query(
            """
      SELECT lower(sr.match_value) AS match_value
      FROM sender_rules sr
      WHERE sr.match_type = 'EMAIL' AND upper(sr.label) = 'BOSS'
      ORDER BY lower(sr.match_value) ASC
      """,
            (resultSet, rowNum) -> resultSet.getString("match_value"));

    List<DashboardSummaryResponse.SeriesPoint> series7d =
        jdbcTemplate.query(
            """
      WITH days AS (
        SELECT generate_series(
          (date_trunc('day', now()) - interval '6 days')::date,
          date_trunc('day', now())::date,
          interval '1 day'
        )::date AS day
      ),
      message_daily AS (
        SELECT
          (m.received_at AT TIME ZONE 'UTC')::date AS day,
          COUNT(*) FILTER (WHERE m.is_read = false) AS unread_now
        FROM messages m
        WHERE
          m.is_sent = false
          AND m.received_at >= date_trunc('day', now()) - interval '6 days'
          AND m.received_at < date_trunc('day', now()) + interval '1 day'
        GROUP BY (m.received_at AT TIME ZONE 'UTC')::date
      ),
      needs_reply_daily AS (
        SELECT
          (m.received_at AT TIME ZONE 'UTC')::date AS day,
          COUNT(*) FILTER (WHERE f.status = 'OPEN' AND f.needs_reply = true) AS needs_reply_open
        FROM followups f
        JOIN messages m ON m.id = f.message_id
        WHERE
          m.is_sent = false
          AND m.received_at >= date_trunc('day', now()) - interval '6 days'
          AND m.received_at < date_trunc('day', now()) + interval '1 day'
        GROUP BY (m.received_at AT TIME ZONE 'UTC')::date
      ),
      due_daily AS (
        SELECT
          (f.due_at AT TIME ZONE 'UTC')::date AS day,
          COUNT(*) FILTER (WHERE f.status = 'OPEN' AND f.due_at < now()) AS overdue,
          COUNT(*) FILTER (WHERE f.status = 'OPEN' AND f.due_at IS NOT NULL) AS due_today
        FROM followups f
        JOIN messages m ON m.id = f.message_id
        WHERE
          m.is_sent = false
          AND f.due_at IS NOT NULL
          AND f.due_at >= date_trunc('day', now()) - interval '6 days'
          AND f.due_at < date_trunc('day', now()) + interval '1 day'
        GROUP BY (f.due_at AT TIME ZONE 'UTC')::date
      ),
      snoozed_daily AS (
        SELECT
          (f.snoozed_until AT TIME ZONE 'UTC')::date AS day,
          COUNT(*) FILTER (WHERE f.status = 'OPEN' AND f.snoozed_until IS NOT NULL) AS snoozed
        FROM followups f
        JOIN messages m ON m.id = f.message_id
        WHERE
          m.is_sent = false
          AND f.snoozed_until IS NOT NULL
          AND f.snoozed_until >= date_trunc('day', now()) - interval '6 days'
          AND f.snoozed_until < date_trunc('day', now()) + interval '1 day'
        GROUP BY (f.snoozed_until AT TIME ZONE 'UTC')::date
      ),
      boss_daily AS (
        SELECT
          (m.received_at AT TIME ZONE 'UTC')::date AS day,
          COUNT(*) FILTER (
            WHERE
              m.is_read = false
              AND upper(COALESCE(sr_email.label, sr_domain.label, '')) = 'BOSS'
          ) AS unread_boss
        FROM messages m
        LEFT JOIN sender_rules sr_email
          ON sr_email.match_type = 'EMAIL' AND lower(sr_email.match_value) = lower(m.sender_email)
        LEFT JOIN sender_rules sr_domain
          ON sr_domain.match_type = 'DOMAIN' AND lower(sr_domain.match_value) = lower(m.sender_domain)
        WHERE
          m.is_sent = false
          AND m.received_at >= date_trunc('day', now()) - interval '6 days'
          AND m.received_at < date_trunc('day', now()) + interval '1 day'
        GROUP BY (m.received_at AT TIME ZONE 'UTC')::date
      )
      SELECT
        d.day AS day,
        COALESCE(md.unread_now, 0) AS unread_now,
        COALESCE(nrd.needs_reply_open, 0) AS needs_reply_open,
        COALESCE(dd.overdue, 0) AS overdue,
        COALESCE(dd.due_today, 0) AS due_today,
        COALESCE(sd.snoozed, 0) AS snoozed,
        COALESCE(bd.unread_boss, 0) AS unread_boss
      FROM days d
      LEFT JOIN message_daily md ON md.day = d.day
      LEFT JOIN needs_reply_daily nrd ON nrd.day = d.day
      LEFT JOIN due_daily dd ON dd.day = d.day
      LEFT JOIN snoozed_daily sd ON sd.day = d.day
      LEFT JOIN boss_daily bd ON bd.day = d.day
      ORDER BY d.day ASC
      """,
            this::mapSeriesPoint);

    return new DashboardSummaryResponse(
        unreadTotal,
        needsReplyOpen,
        overdue,
        dueToday,
        snoozed,
        unreadBoss,
        receivedLast24h,
        receivedPrev24h,
        percentDelta(receivedLast24h, receivedPrev24h),
        unreadTotal - unreadPrev24h,
        overdue - overduePrev24h,
        needsReplyOpen - needsReplyPrev24h,
        topDomainsUnread,
        topSendersUnread,
        topDomainsReceived24h,
        topSendersReceived24h,
        unreadByAccount,
        bossSenderDomains,
        bossSenderEmails,
        openFollowupsTotal,
        snoozedWakingNext24h,
        series7d,
        OffsetDateTime.now(ZoneOffset.UTC).toString());
  }

  private DashboardSummaryResponse.DomainCount mapDomainCount(ResultSet resultSet, int rowNum)
      throws SQLException {
    return new DashboardSummaryResponse.DomainCount(
        resultSet.getString("domain"), resultSet.getInt("count"));
  }

  private DashboardSummaryResponse.SenderCount mapSenderCount(ResultSet resultSet, int rowNum)
      throws SQLException {
    return new DashboardSummaryResponse.SenderCount(
        resultSet.getString("email"), resultSet.getInt("count"));
  }

  private DashboardSummaryResponse.AccountCount mapAccountCount(ResultSet resultSet, int rowNum)
      throws SQLException {
    return new DashboardSummaryResponse.AccountCount(
        resultSet.getObject("account_id", UUID.class),
        resultSet.getString("account_email"),
        resultSet.getInt("count"));
  }

  private DashboardSummaryResponse.SeriesPoint mapSeriesPoint(ResultSet resultSet, int rowNum)
      throws SQLException {
    java.sql.Date sqlDate = resultSet.getDate("day");
    String day = sqlDate == null ? "" : sqlDate.toLocalDate().toString();
    return new DashboardSummaryResponse.SeriesPoint(
        day,
        resultSet.getInt("unread_now"),
        resultSet.getInt("needs_reply_open"),
        resultSet.getInt("overdue"),
        resultSet.getInt("due_today"),
        resultSet.getInt("snoozed"),
        resultSet.getInt("unread_boss"));
  }

  private double percentDelta(int current, int previous) {
    if (previous == 0) {
      return current == 0 ? 0.0 : 100.0;
    }
    return ((current - previous) * 100.0) / previous;
  }

  private int toInt(Object value) {
    if (value instanceof Number number) {
      return number.intValue();
    }
    return 0;
  }
}
