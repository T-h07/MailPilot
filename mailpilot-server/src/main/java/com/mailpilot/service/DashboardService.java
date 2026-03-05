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
    Map<String, Object> row = jdbcTemplate.queryForMap(
      """
      SELECT
        (SELECT COUNT(*) FROM messages m WHERE m.is_read = false AND m.is_sent = false) AS unread_total,
        (
          SELECT COUNT(*)
          FROM followups f
          JOIN messages m ON m.id = f.message_id
          WHERE m.is_sent = false AND f.status = 'OPEN' AND f.needs_reply = true
        ) AS needs_reply_open,
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
        ) AS snoozed,
        (
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
        ) AS unread_boss,
        (
          SELECT COUNT(*)
          FROM messages m
          WHERE m.is_sent = false AND m.received_at >= now() - interval '24 hours' AND m.received_at < now()
        ) AS received_last_24h,
        (
          SELECT COUNT(*)
          FROM messages m
          WHERE m.is_sent = false AND m.received_at >= now() - interval '48 hours' AND m.received_at < now() - interval '24 hours'
        ) AS received_prev_24h,
        (
          SELECT COUNT(*)
          FROM followups f
          JOIN messages m ON m.id = f.message_id
          WHERE m.is_sent = false AND f.status = 'OPEN'
        ) AS open_followups_total,
        (
          SELECT COUNT(*)
          FROM followups f
          JOIN messages m ON m.id = f.message_id
          WHERE
            m.is_sent = false
            AND f.status = 'OPEN'
            AND f.snoozed_until > now()
            AND f.snoozed_until <= now() + interval '24 hours'
        ) AS snoozed_waking_next_24h,
        (
          SELECT COUNT(*)
          FROM messages m
          WHERE m.is_read = false AND m.is_sent = false AND m.received_at < now() - interval '24 hours'
        ) AS unread_prev_24h_approx,
        (
          SELECT COUNT(*)
          FROM followups f
          JOIN messages m ON m.id = f.message_id
          WHERE
            m.is_sent = false
            AND f.status = 'OPEN'
            AND f.needs_reply = true
            AND f.created_at < now() - interval '24 hours'
        ) AS needs_reply_prev_24h_approx,
        (
          SELECT COUNT(*)
          FROM followups f
          JOIN messages m ON m.id = f.message_id
          WHERE
            m.is_sent = false
            AND f.status = 'OPEN'
            AND f.due_at < now() - interval '24 hours'
            AND f.created_at < now() - interval '24 hours'
        ) AS overdue_prev_24h_approx
      """
    );

    int unreadTotal = toInt(row.get("unread_total"));
    int needsReplyOpen = toInt(row.get("needs_reply_open"));
    int overdue = toInt(row.get("overdue"));
    int dueToday = toInt(row.get("due_today"));
    int snoozed = toInt(row.get("snoozed"));
    int unreadBoss = toInt(row.get("unread_boss"));
    int receivedLast24h = toInt(row.get("received_last_24h"));
    int receivedPrev24h = toInt(row.get("received_prev_24h"));
    int openFollowupsTotal = toInt(row.get("open_followups_total"));
    int snoozedWakingNext24h = toInt(row.get("snoozed_waking_next_24h"));
    int unreadPrev24h = toInt(row.get("unread_prev_24h_approx"));
    int needsReplyPrev24h = toInt(row.get("needs_reply_prev_24h_approx"));
    int overduePrev24h = toInt(row.get("overdue_prev_24h_approx"));

    List<DashboardSummaryResponse.DomainCount> topDomainsUnread = jdbcTemplate.query(
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

    List<DashboardSummaryResponse.SenderCount> topSendersUnread = jdbcTemplate.query(
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
      TOP_LIMIT
    );

    List<DashboardSummaryResponse.DomainCount> topDomainsReceived24h = jdbcTemplate.query(
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
      TOP_LIMIT
    );

    List<DashboardSummaryResponse.SenderCount> topSendersReceived24h = jdbcTemplate.query(
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
      TOP_LIMIT
    );

    List<DashboardSummaryResponse.AccountCount> unreadByAccount = jdbcTemplate.query(
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
      TOP_LIMIT
    );

    List<String> bossSenderDomains = jdbcTemplate.query(
      """
      SELECT lower(sr.match_value) AS match_value
      FROM sender_rules sr
      WHERE sr.match_type = 'DOMAIN' AND upper(sr.label) = 'BOSS'
      ORDER BY lower(sr.match_value) ASC
      """,
      (resultSet, rowNum) -> resultSet.getString("match_value")
    );

    List<String> bossSenderEmails = jdbcTemplate.query(
      """
      SELECT lower(sr.match_value) AS match_value
      FROM sender_rules sr
      WHERE sr.match_type = 'EMAIL' AND upper(sr.label) = 'BOSS'
      ORDER BY lower(sr.match_value) ASC
      """,
      (resultSet, rowNum) -> resultSet.getString("match_value")
    );

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
      OffsetDateTime.now(ZoneOffset.UTC).toString()
    );
  }

  private DashboardSummaryResponse.DomainCount mapDomainCount(ResultSet resultSet, int rowNum)
    throws SQLException {
    return new DashboardSummaryResponse.DomainCount(
      resultSet.getString("domain"),
      resultSet.getInt("count")
    );
  }

  private DashboardSummaryResponse.SenderCount mapSenderCount(ResultSet resultSet, int rowNum)
    throws SQLException {
    return new DashboardSummaryResponse.SenderCount(
      resultSet.getString("email"),
      resultSet.getInt("count")
    );
  }

  private DashboardSummaryResponse.AccountCount mapAccountCount(ResultSet resultSet, int rowNum)
    throws SQLException {
    return new DashboardSummaryResponse.AccountCount(
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

  private int toInt(Object value) {
    if (value instanceof Number number) {
      return number.intValue();
    }
    return 0;
  }
}
