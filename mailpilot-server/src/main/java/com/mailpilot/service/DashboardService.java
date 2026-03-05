package com.mailpilot.service;

import com.mailpilot.api.model.DashboardSummaryResponse;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class DashboardService {

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
        ) AS unread_boss
      """
    );

    return new DashboardSummaryResponse(
      toInt(row.get("unread_total")),
      toInt(row.get("needs_reply_open")),
      toInt(row.get("overdue")),
      toInt(row.get("due_today")),
      toInt(row.get("snoozed")),
      toInt(row.get("unread_boss")),
      OffsetDateTime.now(ZoneOffset.UTC).toString()
    );
  }

  private int toInt(Object value) {
    if (value instanceof Number number) {
      return number.intValue();
    }
    return 0;
  }
}
