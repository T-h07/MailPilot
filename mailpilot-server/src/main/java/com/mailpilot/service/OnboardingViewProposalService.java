package com.mailpilot.service;

import com.mailpilot.api.error.ApiBadRequestException;
import com.mailpilot.api.model.OnboardingViewProposalsApplyRequest;
import com.mailpilot.api.model.OnboardingViewProposalsApplyResponse;
import com.mailpilot.api.model.OnboardingViewProposalsResponse;
import com.mailpilot.api.model.ViewResponse;
import com.mailpilot.api.model.ViewUpsertRequest;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class OnboardingViewProposalService {

  private static final int DEFAULT_RANGE_DAYS = 30;
  private static final int DEFAULT_MAX_SENDERS = 50;
  private static final int MIN_MAX_SENDERS = 10;
  private static final int MAX_MAX_SENDERS = 200;
  private static final int MIN_COUNT_THRESHOLD = 3;
  private static final int MIN_HISTORY_MESSAGES = 12;
  private static final int MAX_APPLY_VIEWS = 12;
  private static final int MAX_APPLY_DOMAINS = 20;
  private static final int MAX_APPLY_EMAILS = 20;
  private static final int MAX_APPLY_KEYWORDS = 10;

  private static final Set<String> PERSONAL_DOMAINS =
      Set.of("gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "aol.com");
  private static final Set<String> SOCIAL_DOMAINS =
      Set.of(
          "linkedin.com",
          "github.com",
          "reddit.com",
          "discord.com",
          "x.com",
          "twitter.com",
          "facebook.com",
          "instagram.com");
  private static final Set<String> GAMING_DOMAINS =
      Set.of("steampowered.com", "steamcommunity.com", "epicgames.com", "riotgames.com", "ea.com");
  private static final Set<String> FINANCE_DOMAINS =
      Set.of(
          "paypal.com",
          "stripe.com",
          "wise.com",
          "chase.com",
          "bankofamerica.com",
          "capitalone.com",
          "amazon.com");
  private static final Set<String> MARKETING_TOKENS =
      Set.of("newsletter", "digest", "updates", "promo", "marketing", "noreply", "no-reply");
  private static final Set<String> RECEIPT_TOKENS =
      Set.of("receipt", "invoice", "payment", "order", "shipped");
  private static final Set<String> SCHOOL_TOKENS =
      Set.of("assignment", "course", "class", "campus");

  private final JdbcTemplate jdbcTemplate;
  private final ViewService viewService;

  public OnboardingViewProposalService(JdbcTemplate jdbcTemplate, ViewService viewService) {
    this.jdbcTemplate = jdbcTemplate;
    this.viewService = viewService;
  }

  public OnboardingViewProposalsResponse generateProposals(String rawRange, Integer rawMaxSenders) {
    int rangeDays = resolveRangeDays(rawRange);
    int maxSenders = resolveMaxSenders(rawMaxSenders);
    OffsetDateTime to = OffsetDateTime.now(ZoneOffset.UTC);
    OffsetDateTime from = to.minusDays(rangeDays);

    List<OnboardingViewProposalsResponse.AccountItem> accounts = loadAccounts();
    int totalCount = countTotalMessages(from, to);
    if (totalCount < MIN_HISTORY_MESSAGES) {
      return new OnboardingViewProposalsResponse(
          rangeDays, accounts, List.of(), "Not enough mail history yet; run sync and try again.");
    }

    List<FrequencyStat> topDomains = loadTopDomains(from, to, maxSenders);
    List<FrequencyStat> topEmails = loadTopEmails(from, to, maxSenders);
    if (topDomains.isEmpty() && topEmails.isEmpty()) {
      return new OnboardingViewProposalsResponse(
          rangeDays,
          accounts,
          List.of(),
          "Not enough sender activity yet; run sync and try again.");
    }

    List<ProposalSeed> seeds = buildProposalSeeds(topDomains, topEmails);
    List<OnboardingViewProposalsResponse.Proposal> proposals = new ArrayList<>();
    for (ProposalSeed seed : seeds) {
      int estimatedCount = estimateMatchCount(seed, from, to);
      if (estimatedCount <= 0) {
        continue;
      }
      double estimatedPct =
          totalCount <= 0 ? 0.0 : Math.round((estimatedCount * 1000.0) / totalCount) / 10.0;
      proposals.add(
          new OnboardingViewProposalsResponse.Proposal(
              seed.key(),
              seed.name(),
              seed.priority(),
              new OnboardingViewProposalsResponse.AccountsScope(
                  seed.scopeType(), seed.accountIds()),
              new OnboardingViewProposalsResponse.Rules(
                  seed.senderDomains(),
                  seed.senderEmails(),
                  seed.subjectKeywords(),
                  seed.unreadOnly()),
              estimatedCount,
              estimatedPct,
              seed.explanation()));
      if (proposals.size() >= MAX_APPLY_VIEWS) {
        break;
      }
    }

    String message =
        proposals.isEmpty()
            ? "Not enough reliable patterns found yet. Run sync and try again."
            : null;
    return new OnboardingViewProposalsResponse(rangeDays, accounts, proposals, message);
  }

  @Transactional
  public OnboardingViewProposalsApplyResponse apply(OnboardingViewProposalsApplyRequest request) {
    List<OnboardingViewProposalsApplyRequest.CreateItem> createItems =
        request == null || request.create() == null ? List.of() : request.create();
    if (createItems.isEmpty()) {
      return new OnboardingViewProposalsApplyResponse("ok", List.of());
    }
    if (createItems.size() > MAX_APPLY_VIEWS) {
      throw new ApiBadRequestException("A maximum of 12 views can be created at once.");
    }

    Set<String> existingNames = new HashSet<>();
    int maxSortOrder = 0;
    for (ViewResponse existingView : viewService.listViews()) {
      existingNames.add(normalize(existingView.name()));
      if (existingView.sortOrder() > maxSortOrder) {
        maxSortOrder = existingView.sortOrder();
      }
    }

    List<OnboardingViewProposalsApplyResponse.CreatedView> created = new ArrayList<>();
    int nextSortOrder = maxSortOrder + 10;
    for (int index = 0; index < createItems.size(); index++) {
      NormalizedApplyItem item = normalizeApplyItem(createItems.get(index), nextSortOrder + index);
      String uniqueName = ensureUniqueName(item.name(), existingNames);
      ViewUpsertRequest payload =
          new ViewUpsertRequest(
              uniqueName,
              item.priority(),
              item.sortOrder(),
              null,
              item.scopeType(),
              item.selectedAccountIds(),
              new ViewUpsertRequest.Rules(
                  item.senderDomains(),
                  item.senderEmails(),
                  item.subjectKeywords(),
                  item.unreadOnly()));
      ViewResponse createdView = viewService.createView(payload);
      existingNames.add(normalize(uniqueName));
      created.add(
          new OnboardingViewProposalsApplyResponse.CreatedView(
              createdView.id(), createdView.name()));
    }

    return new OnboardingViewProposalsApplyResponse("ok", created);
  }

  private List<ProposalSeed> buildProposalSeeds(
      List<FrequencyStat> topDomains, List<FrequencyStat> topEmails) {
    List<ProposalSeed> seeds = new ArrayList<>();
    Set<String> usedDomains = new LinkedHashSet<>();

    List<String> socialDomains = selectMatchingDomains(topDomains, SOCIAL_DOMAINS, usedDomains, 6);
    if (!socialDomains.isEmpty()) {
      seeds.add(
          new ProposalSeed(
              "social",
              "Social",
              3,
              "ALL",
              List.of(),
              socialDomains,
              List.of(),
              List.of(),
              false,
              "Based on frequent activity from social platforms in recent mail."));
    }

    List<String> gamingDomains = selectMatchingDomains(topDomains, GAMING_DOMAINS, usedDomains, 6);
    if (!gamingDomains.isEmpty()) {
      seeds.add(
          new ProposalSeed(
              "gaming",
              "Gaming",
              2,
              "ALL",
              List.of(),
              gamingDomains,
              List.of(),
              List.of(),
              false,
              "Detected recurring gaming platform senders in your inbox."));
    }

    List<String> receiptDomains =
        selectMatchingDomains(topDomains, FINANCE_DOMAINS, usedDomains, 6);
    if (!receiptDomains.isEmpty()) {
      seeds.add(
          new ProposalSeed(
              "receipts",
              "Receipts",
              4,
              "ALL",
              List.of(),
              receiptDomains,
              List.of(),
              List.of("receipt", "invoice", "order"),
              false,
              "Likely billing and purchase messages from finance or commerce senders."));
    }

    List<String> schoolDomains = new ArrayList<>();
    for (FrequencyStat domain : topDomains) {
      if (usedDomains.contains(domain.value())) {
        continue;
      }
      if (domain.value().endsWith(".edu")
          || domain.value().contains("school")
          || domain.value().contains("university")) {
        schoolDomains.add(domain.value());
      }
      if (schoolDomains.size() >= 5) {
        break;
      }
    }
    if (!schoolDomains.isEmpty()) {
      usedDomains.addAll(schoolDomains);
      seeds.add(
          new ProposalSeed(
              "school",
              "School",
              3,
              "ALL",
              List.of(),
              schoolDomains,
              List.of(),
              List.of("assignment", "course", "class"),
              false,
              "Detected education-related domains and classroom traffic."));
    }

    List<String> subscriptionEmails = new ArrayList<>();
    for (FrequencyStat senderEmail : topEmails) {
      if (matchesToken(senderEmail.value(), MARKETING_TOKENS)) {
        subscriptionEmails.add(senderEmail.value());
      }
      if (subscriptionEmails.size() >= 8) {
        break;
      }
    }
    if (!subscriptionEmails.isEmpty()) {
      seeds.add(
          new ProposalSeed(
              "subscriptions",
              "Subscriptions",
              2,
              "ALL",
              List.of(),
              List.of(),
              subscriptionEmails,
              List.of("newsletter", "digest"),
              false,
              "Frequent digest and no-reply style senders were grouped as subscriptions."));
    }

    List<String> workDomains = new ArrayList<>();
    for (FrequencyStat domain : topDomains) {
      if (usedDomains.contains(domain.value())) {
        continue;
      }
      if (PERSONAL_DOMAINS.contains(domain.value())) {
        continue;
      }
      if (matchesAnyKnownDomain(domain.value(), SOCIAL_DOMAINS)
          || matchesAnyKnownDomain(domain.value(), GAMING_DOMAINS)
          || matchesAnyKnownDomain(domain.value(), FINANCE_DOMAINS)
          || matchesToken(domain.value(), MARKETING_TOKENS)
          || domain.count() < 4) {
        continue;
      }
      workDomains.add(domain.value());
      if (workDomains.size() >= 4) {
        break;
      }
    }
    if (!workDomains.isEmpty()) {
      seeds.add(
          new ProposalSeed(
              "work",
              "Work",
              5,
              "ALL",
              List.of(),
              workDomains,
              List.of(),
              List.of("meeting"),
              false,
              "Based on recurring professional domains in your recent mail."));
    }

    if (seeds.isEmpty() && !topDomains.isEmpty()) {
      FrequencyStat strongest = topDomains.getFirst();
      seeds.add(
          new ProposalSeed(
              "priority",
              "Priority Senders",
              4,
              "ALL",
              List.of(),
              List.of(strongest.value()),
              List.of(),
              List.of(),
              false,
              "Built from the most active sender domain in your mailbox."));
    }

    return seeds;
  }

  private List<String> selectMatchingDomains(
      List<FrequencyStat> topDomains,
      Set<String> knownDomains,
      Set<String> usedDomains,
      int limit) {
    List<String> matches = new ArrayList<>();
    for (FrequencyStat stat : topDomains) {
      if (usedDomains.contains(stat.value())) {
        continue;
      }
      if (!matchesAnyKnownDomain(stat.value(), knownDomains)) {
        continue;
      }
      matches.add(stat.value());
      if (matches.size() >= limit) {
        break;
      }
    }
    usedDomains.addAll(matches);
    return matches;
  }

  private int estimateMatchCount(ProposalSeed proposal, OffsetDateTime from, OffsetDateTime to) {
    StringBuilder sql =
        new StringBuilder(
            """
      SELECT COUNT(*)
      FROM messages m
      WHERE m.received_at >= ?
        AND m.received_at <= ?
        AND m.is_sent = false
        AND m.is_draft = false
        AND NOT ('SPAM' = ANY(m.gmail_label_ids) OR 'TRASH' = ANY(m.gmail_label_ids))
      """);
    List<Object> params = new ArrayList<>();
    params.add(from);
    params.add(to);

    if ("SELECTED".equalsIgnoreCase(proposal.scopeType()) && !proposal.accountIds().isEmpty()) {
      sql.append(" AND m.account_id IN (")
          .append(placeholders(proposal.accountIds().size()))
          .append(")");
      params.addAll(proposal.accountIds());
    }

    if (!proposal.senderDomains().isEmpty()) {
      sql.append(" AND lower(m.sender_domain) IN (")
          .append(placeholders(proposal.senderDomains().size()))
          .append(")");
      params.addAll(proposal.senderDomains());
    }

    if (!proposal.senderEmails().isEmpty()) {
      sql.append(" AND lower(m.sender_email) IN (")
          .append(placeholders(proposal.senderEmails().size()))
          .append(")");
      params.addAll(proposal.senderEmails());
    }

    if (!proposal.subjectKeywords().isEmpty()) {
      sql.append(" AND (");
      for (int i = 0; i < proposal.subjectKeywords().size(); i++) {
        if (i > 0) {
          sql.append(" OR ");
        }
        sql.append(
            "(lower(COALESCE(m.subject, '')) LIKE ? OR lower(COALESCE(m.snippet, '')) LIKE ?)");
        String likeValue = "%" + proposal.subjectKeywords().get(i) + "%";
        params.add(likeValue);
        params.add(likeValue);
      }
      sql.append(")");
    }

    if (proposal.unreadOnly()) {
      sql.append(" AND m.is_read = false");
    }

    Integer count = jdbcTemplate.queryForObject(sql.toString(), Integer.class, params.toArray());
    return count == null ? 0 : count;
  }

  private int countTotalMessages(OffsetDateTime from, OffsetDateTime to) {
    Integer count =
        jdbcTemplate.queryForObject(
            """
        SELECT COUNT(*)
        FROM messages m
        WHERE m.received_at >= ?
          AND m.received_at <= ?
          AND m.is_sent = false
          AND m.is_draft = false
          AND NOT ('SPAM' = ANY(m.gmail_label_ids) OR 'TRASH' = ANY(m.gmail_label_ids))
        """,
            Integer.class,
            from,
            to);
    return count == null ? 0 : count;
  }

  private List<FrequencyStat> loadTopDomains(
      OffsetDateTime from, OffsetDateTime to, int maxSenders) {
    return jdbcTemplate.query(
        """
      SELECT lower(m.sender_domain) AS sender_domain, COUNT(*) AS message_count
      FROM messages m
      WHERE m.received_at >= ?
        AND m.received_at <= ?
        AND m.is_sent = false
        AND m.is_draft = false
        AND NOT ('SPAM' = ANY(m.gmail_label_ids) OR 'TRASH' = ANY(m.gmail_label_ids))
        AND m.sender_domain IS NOT NULL
        AND m.sender_domain <> ''
      GROUP BY lower(m.sender_domain)
      HAVING COUNT(*) >= ?
      ORDER BY message_count DESC
      LIMIT ?
      """,
        (resultSet, rowNum) ->
            new FrequencyStat(
                normalize(resultSet.getString("sender_domain")), resultSet.getInt("message_count")),
        from,
        to,
        MIN_COUNT_THRESHOLD,
        maxSenders);
  }

  private List<FrequencyStat> loadTopEmails(
      OffsetDateTime from, OffsetDateTime to, int maxSenders) {
    return jdbcTemplate.query(
        """
      SELECT lower(m.sender_email) AS sender_email, COUNT(*) AS message_count
      FROM messages m
      WHERE m.received_at >= ?
        AND m.received_at <= ?
        AND m.is_sent = false
        AND m.is_draft = false
        AND NOT ('SPAM' = ANY(m.gmail_label_ids) OR 'TRASH' = ANY(m.gmail_label_ids))
        AND m.sender_email IS NOT NULL
        AND m.sender_email <> ''
      GROUP BY lower(m.sender_email)
      HAVING COUNT(*) >= ?
      ORDER BY message_count DESC
      LIMIT ?
      """,
        (resultSet, rowNum) ->
            new FrequencyStat(
                normalize(resultSet.getString("sender_email")), resultSet.getInt("message_count")),
        from,
        to,
        MIN_COUNT_THRESHOLD,
        maxSenders);
  }

  private List<OnboardingViewProposalsResponse.AccountItem> loadAccounts() {
    return jdbcTemplate.query(
        """
      SELECT id, email, role
      FROM accounts
      ORDER BY
        CASE role
          WHEN 'PRIMARY' THEN 0
          WHEN 'CUSTOM' THEN 1
          ELSE 2
        END,
        email ASC
      """,
        (resultSet, rowNum) ->
            new OnboardingViewProposalsResponse.AccountItem(
                resultSet.getObject("id", UUID.class),
                resultSet.getString("email"),
                resultSet.getString("role")));
  }

  private NormalizedApplyItem normalizeApplyItem(
      OnboardingViewProposalsApplyRequest.CreateItem createItem, int defaultSortOrder) {
    if (createItem == null) {
      throw new ApiBadRequestException("Each proposal payload must be provided.");
    }

    String name = safeTrim(createItem.name());
    if (name.length() < 2 || name.length() > 50) {
      throw new ApiBadRequestException("View name must be between 2 and 50 characters.");
    }

    int priority = createItem.priority() == null ? 3 : createItem.priority();
    if (priority < 1 || priority > 5) {
      throw new ApiBadRequestException("priority must be between 1 and 5.");
    }

    int sortOrder = createItem.sortOrder() == null ? defaultSortOrder : createItem.sortOrder();
    if (sortOrder < 0 || sortOrder > 9999) {
      throw new ApiBadRequestException("sortOrder must be between 0 and 9999.");
    }

    OnboardingViewProposalsApplyRequest.AccountsScope scope = createItem.accountsScope();
    String scopeType = scope == null ? "ALL" : safeTrim(scope.type()).toUpperCase(Locale.ROOT);
    if (!"ALL".equals(scopeType) && !"SELECTED".equals(scopeType)) {
      throw new ApiBadRequestException("accountsScope.type must be ALL or SELECTED.");
    }
    List<UUID> selectedAccountIds = normalizeUuidList(scope == null ? null : scope.accountIds());
    if ("SELECTED".equals(scopeType) && selectedAccountIds.isEmpty()) {
      throw new ApiBadRequestException("accountIds are required when accountsScope.type=SELECTED.");
    }
    if ("ALL".equals(scopeType)) {
      selectedAccountIds = List.of();
    }

    OnboardingViewProposalsApplyRequest.Rules rules = createItem.rules();
    List<String> senderDomains =
        normalizeStringList(rules == null ? null : rules.senderDomains(), MAX_APPLY_DOMAINS, true);
    List<String> senderEmails =
        normalizeStringList(rules == null ? null : rules.senderEmails(), MAX_APPLY_EMAILS, true);
    List<String> subjectKeywords =
        normalizeStringList(
            rules == null ? null : rules.subjectKeywords(), MAX_APPLY_KEYWORDS, true);
    boolean unreadOnly = rules != null && Boolean.TRUE.equals(rules.unreadOnly());

    return new NormalizedApplyItem(
        name,
        priority,
        sortOrder,
        scopeType,
        selectedAccountIds,
        senderDomains,
        senderEmails,
        subjectKeywords,
        unreadOnly);
  }

  private List<UUID> normalizeUuidList(List<UUID> values) {
    if (values == null || values.isEmpty()) {
      return List.of();
    }
    LinkedHashSet<UUID> deduped = new LinkedHashSet<>();
    for (UUID value : values) {
      if (value != null) {
        deduped.add(value);
      }
    }
    return List.copyOf(deduped);
  }

  private List<String> normalizeStringList(List<String> values, int maxSize, boolean lowercase) {
    if (values == null || values.isEmpty()) {
      return List.of();
    }
    if (values.size() > maxSize) {
      throw new ApiBadRequestException("Rule item limit exceeded.");
    }
    LinkedHashSet<String> normalized = new LinkedHashSet<>();
    for (String value : values) {
      String trimmed = safeTrim(value);
      if (trimmed.isBlank()) {
        continue;
      }
      normalized.add(lowercase ? normalize(trimmed) : trimmed);
      if (normalized.size() > maxSize) {
        throw new ApiBadRequestException("Rule item limit exceeded.");
      }
    }
    return List.copyOf(normalized);
  }

  private String ensureUniqueName(String baseName, Set<String> existingNormalizedNames) {
    String normalizedBase = normalize(baseName);
    if (!existingNormalizedNames.contains(normalizedBase)) {
      return baseName;
    }
    for (int suffix = 2; suffix < 100; suffix++) {
      String candidate = baseName + " (" + suffix + ")";
      if (!existingNormalizedNames.contains(normalize(candidate))) {
        return candidate;
      }
    }
    throw new ApiBadRequestException("Unable to create a unique view name. Rename and retry.");
  }

  private int resolveRangeDays(String rawRange) {
    if (!StringUtils.hasText(rawRange)) {
      return DEFAULT_RANGE_DAYS;
    }

    String normalized = rawRange.trim().toLowerCase(Locale.ROOT);
    return switch (normalized) {
      case "2d" -> 2;
      case "7d" -> 7;
      case "14d" -> 14;
      case "30d" -> 30;
      case "6m" -> 180;
      default -> {
        if (normalized.endsWith("d")) {
          int days = parsePositiveInt(normalized.substring(0, normalized.length() - 1), "range");
          if (days < 1 || days > 365) {
            throw new ApiBadRequestException("range days must be between 1 and 365.");
          }
          yield days;
        }
        throw new ApiBadRequestException("range must be one of 2d, 7d, 14d, 30d, 6m.");
      }
    };
  }

  private int resolveMaxSenders(Integer rawMaxSenders) {
    if (rawMaxSenders == null) {
      return DEFAULT_MAX_SENDERS;
    }
    if (rawMaxSenders < MIN_MAX_SENDERS || rawMaxSenders > MAX_MAX_SENDERS) {
      throw new ApiBadRequestException("maxSenders must be between 10 and 200.");
    }
    return rawMaxSenders;
  }

  private int parsePositiveInt(String value, String fieldName) {
    try {
      return Integer.parseInt(value);
    } catch (NumberFormatException exception) {
      throw new ApiBadRequestException(fieldName + " must be a valid integer.");
    }
  }

  private boolean matchesAnyKnownDomain(String domain, Set<String> knownDomains) {
    for (String knownDomain : knownDomains) {
      if (domain.equals(knownDomain) || domain.endsWith("." + knownDomain)) {
        return true;
      }
    }
    return false;
  }

  private boolean matchesToken(String value, Set<String> tokens) {
    for (String token : tokens) {
      if (value.contains(token)) {
        return true;
      }
    }
    return false;
  }

  private String placeholders(int count) {
    return String.join(",", Collections.nCopies(count, "?"));
  }

  private String normalize(String value) {
    return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
  }

  private String safeTrim(String value) {
    return value == null ? "" : value.trim();
  }

  private record FrequencyStat(String value, int count) {
    private FrequencyStat {
      value = Objects.requireNonNullElse(value, "");
    }
  }

  private record ProposalSeed(
      String key,
      String name,
      int priority,
      String scopeType,
      List<UUID> accountIds,
      List<String> senderDomains,
      List<String> senderEmails,
      List<String> subjectKeywords,
      boolean unreadOnly,
      String explanation) {}

  private record NormalizedApplyItem(
      String name,
      int priority,
      int sortOrder,
      String scopeType,
      List<UUID> selectedAccountIds,
      List<String> senderDomains,
      List<String> senderEmails,
      List<String> subjectKeywords,
      boolean unreadOnly) {}
}
