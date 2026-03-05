package com.mailpilot.service;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class SenderHighlightResolver {

  private final JdbcTemplate jdbcTemplate;

  public SenderHighlightResolver(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public RuleSet loadRuleSet(Set<String> senderEmails, Set<String> senderDomains) {
    List<String> normalizedEmails = normalizeValues(senderEmails);
    List<String> normalizedDomains = normalizeValues(senderDomains);

    Map<String, Highlight> emailRules = loadRules("EMAIL", normalizedEmails);
    Map<String, Highlight> domainRules = loadRules("DOMAIN", normalizedDomains);
    return new RuleSet(emailRules, domainRules);
  }

  public Highlight resolve(String senderEmail, String senderDomain, RuleSet ruleSet) {
    if (ruleSet == null) {
      return null;
    }

    String normalizedEmail = normalize(senderEmail);
    if (!normalizedEmail.isBlank()) {
      Highlight emailRule = ruleSet.emailRules().get(normalizedEmail);
      if (emailRule != null) {
        return emailRule;
      }
    }

    String normalizedDomain = normalize(senderDomain);
    if (!normalizedDomain.isBlank()) {
      return ruleSet.domainRules().get(normalizedDomain);
    }

    return null;
  }

  public Highlight resolveSingle(String senderEmail, String senderDomain) {
    String normalizedEmail = normalize(senderEmail);
    String normalizedDomain = normalize(senderDomain);
    if (normalizedEmail.isBlank() && normalizedDomain.isBlank()) {
      return null;
    }

    List<Highlight> rows =
        jdbcTemplate.query(
            """
      SELECT label, accent
      FROM sender_rules
      WHERE
        (match_type = 'EMAIL' AND ? <> '' AND lower(match_value) = ?)
        OR
        (match_type = 'DOMAIN' AND ? <> '' AND lower(match_value) = ?)
      ORDER BY CASE WHEN match_type = 'EMAIL' THEN 0 ELSE 1 END
      LIMIT 1
      """,
            (resultSet, rowNum) ->
                new Highlight(resultSet.getString("label"), resultSet.getString("accent")),
            normalizedEmail,
            normalizedEmail,
            normalizedDomain,
            normalizedDomain);

    return rows.isEmpty() ? null : rows.getFirst();
  }

  private Map<String, Highlight> loadRules(String matchType, List<String> matchValues) {
    if (matchValues.isEmpty()) {
      return Map.of();
    }

    String sql =
        "SELECT match_value, label, accent FROM sender_rules WHERE match_type = ? AND match_value IN ("
            + placeholders(matchValues.size())
            + ")";

    List<Object> args = new ArrayList<>(matchValues.size() + 1);
    args.add(matchType);
    args.addAll(matchValues);

    List<Map<String, Object>> rows = jdbcTemplate.queryForList(sql, args.toArray());
    Map<String, Highlight> rulesByValue = new LinkedHashMap<>();
    for (Map<String, Object> row : rows) {
      String matchValue = normalize((String) row.get("match_value"));
      String label = row.get("label") == null ? null : row.get("label").toString();
      String accent = row.get("accent") == null ? null : row.get("accent").toString();
      if (matchValue.isBlank()
          || label == null
          || label.isBlank()
          || accent == null
          || accent.isBlank()) {
        continue;
      }
      rulesByValue.put(matchValue, new Highlight(label, accent));
    }
    return rulesByValue;
  }

  private List<String> normalizeValues(Set<String> values) {
    if (values == null || values.isEmpty()) {
      return List.of();
    }

    Set<String> normalized = new LinkedHashSet<>();
    for (String value : values) {
      String candidate = normalize(value);
      if (!candidate.isBlank()) {
        normalized.add(candidate);
      }
    }
    return List.copyOf(normalized);
  }

  private String normalize(String value) {
    return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
  }

  private String placeholders(int count) {
    return String.join(",", Collections.nCopies(count, "?"));
  }

  public record Highlight(String label, String accent) {}

  public record RuleSet(Map<String, Highlight> emailRules, Map<String, Highlight> domainRules) {}
}
