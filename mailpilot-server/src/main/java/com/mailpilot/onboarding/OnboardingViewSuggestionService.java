package com.mailpilot.onboarding;

import com.mailpilot.api.error.ApiBadRequestException;
import com.mailpilot.api.model.OnboardingViewProposalsResponse;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class OnboardingViewSuggestionService {
  private static final int DEFAULT_RANGE_DAYS = 30;
  private static final int DEFAULT_MAX_SENDERS = 50;
  private static final int DEFAULT_MAX_MESSAGES = 1500;
  private static final int MIN_HISTORY_MESSAGES = 20;
  private static final int MIN_MEDIUM_MATCHES = 6;
  private static final int MAX_MAIN = 12;
  private static final int MAX_MORE = 8;

  private static final Set<String> PERSONAL_DOMAINS =
      Set.of(
          "gmail.com",
          "yahoo.com",
          "outlook.com",
          "hotmail.com",
          "icloud.com",
          "aol.com",
          "proton.me",
          "protonmail.com");
  private static final Set<String> SOCIAL_DOMAINS =
      Set.of(
          "linkedin.com",
          "github.com",
          "reddit.com",
          "discord.com",
          "facebook.com",
          "instagram.com",
          "twitter.com",
          "x.com");
  private static final Set<String> GAMING_DOMAINS =
      Set.of("steampowered.com", "steamcommunity.com", "epicgames.com", "riotgames.com");
  private static final Set<String> FINANCE_DOMAINS =
      Set.of(
          "paypal.com",
          "stripe.com",
          "wise.com",
          "chase.com",
          "bankofamerica.com",
          "capitalone.com");
  private static final Set<String> SHOPPING_DOMAINS =
      Set.of("amazon.com", "ebay.com", "etsy.com", "shopify.com", "walmart.com");
  private static final Set<String> TRAVEL_DOMAINS =
      Set.of("booking.com", "airbnb.com", "expedia.com", "tripadvisor.com");
  private static final Set<String> NEWSLETTER_DOMAINS = Set.of("substack.com", "medium.com");

  private static final Set<String> WORK_TOKENS =
      Set.of("meeting", "calendar", "task", "proposal", "project", "deadline", "client");
  private static final Set<String> SECURITY_TOKENS =
      Set.of(
          "security",
          "alert",
          "verify",
          "verification",
          "login",
          "password",
          "otp",
          "suspicious");
  private static final Set<String> RECEIPT_TOKENS =
      Set.of("invoice", "receipt", "payment", "billing", "order", "shipped", "delivery");
  private static final Set<String> MARKETING_TOKENS =
      Set.of("sale", "discount", "offer", "promo", "coupon", "deal", "newsletter", "digest");
  private static final Set<String> SCHOOL_TOKENS =
      Set.of("assignment", "course", "class", "lecture", "campus", "semester");
  private static final Set<String> GAMING_TOKENS = Set.of("patch", "season", "ranked", "gaming");
  private static final Set<String> TRAVEL_TOKENS =
      Set.of("flight", "hotel", "booking", "itinerary", "reservation", "trip");

  private final JdbcTemplate jdbcTemplate;

  public OnboardingViewSuggestionService(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public OnboardingViewProposalsResponse generateProposals(
      String rawRange, Integer rawMaxSenders, Integer rawMaxMessages) {
    int rangeDays = resolveRangeDays(rawRange);
    int maxSenders = resolveMaxSenders(rawMaxSenders);
    int maxMessages = resolveMaxMessages(rawMaxMessages);

    OffsetDateTime to = OffsetDateTime.now(ZoneOffset.UTC);
    OffsetDateTime from = to.minusDays(rangeDays);

    List<OnboardingViewProposalsResponse.AccountItem> accounts = loadAccounts();
    Map<UUID, OnboardingViewProposalsResponse.AccountItem> accountById =
        accounts.stream()
            .collect(
                Collectors.toMap(
                    OnboardingViewProposalsResponse.AccountItem::id, Function.identity()));
    List<MailSignal> mails = loadSignals(from, to, maxMessages);

    if (mails.size() < MIN_HISTORY_MESSAGES) {
      return emptyResponse(
          rangeDays,
          mails.size(),
          accounts,
          "Not enough mail history yet; run sync and try again.");
    }

    List<Candidate> all = new ArrayList<>();
    addIfNotNull(
        all,
        buildKnown("work", "WORK", "Work", 5, mails, accountById, maxSenders, Set.of(), WORK_TOKENS));
    addIfNotNull(
        all,
        buildKnown(
            "social",
            "SOCIAL",
            "Social",
            3,
            mails,
            accountById,
            maxSenders,
            SOCIAL_DOMAINS,
            Set.of("recruiter", "invitation", "connection")));
    addIfNotNull(
        all,
        buildKnown(
            "security-alerts",
            "SECURITY",
            "Security Alerts",
            5,
            mails,
            accountById,
            maxSenders,
            Set.of("google.com", "microsoft.com", "apple.com", "github.com"),
            SECURITY_TOKENS));
    addIfNotNull(
        all,
        buildKnown(
            "finance-receipts",
            "FINANCE",
            "Finance & Receipts",
            4,
            mails,
            accountById,
            maxSenders,
            FINANCE_DOMAINS,
            RECEIPT_TOKENS));
    addIfNotNull(
        all,
        buildKnown(
            "shopping-orders",
            "SHOPPING",
            "Shopping & Orders",
            3,
            mails,
            accountById,
            maxSenders,
            SHOPPING_DOMAINS,
            Set.of("order", "delivery", "tracking", "shipped")));
    addIfNotNull(
        all,
        buildKnown(
            "marketing-subscriptions",
            "MARKETING",
            "Marketing & Subscriptions",
            2,
            mails,
            accountById,
            maxSenders,
            Set.of("mailchi.mp", "mailchimp.com", "sendgrid.net"),
            MARKETING_TOKENS));
    addIfNotNull(
        all,
        buildKnown(
            "school",
            "SCHOOL",
            "School",
            3,
            mails,
            accountById,
            maxSenders,
            Set.of(),
            SCHOOL_TOKENS));
    addIfNotNull(
        all,
        buildKnown(
            "gaming",
            "GAMING",
            "Gaming",
            2,
            mails,
            accountById,
            maxSenders,
            GAMING_DOMAINS,
            GAMING_TOKENS));
    addIfNotNull(
        all,
        buildKnown(
            "travel",
            "TRAVEL",
            "Travel",
            2,
            mails,
            accountById,
            maxSenders,
            TRAVEL_DOMAINS,
            TRAVEL_TOKENS));
    addIfNotNull(
        all,
        buildKnown(
            "newsletters",
            "NEWSLETTERS",
            "Newsletters & Knowledge",
            2,
            mails,
            accountById,
            maxSenders,
            NEWSLETTER_DOMAINS,
            Set.of("newsletter", "digest", "weekly", "roundup")));

    all.addAll(buildCustomDomainClusters(mails, accountById, maxSenders));
    all = dedupeByKey(all);
    if (all.isEmpty()) {
      return emptyResponse(
          rangeDays,
          mails.size(),
          accounts,
          "Not enough reliable patterns found yet. Run sync and try again.");
    }

    Suppression suppression = suppress(all);
    List<Candidate> primary = selectPrimary(suppression.visible);
    Set<String> primaryKeys = primary.stream().map(candidate -> candidate.key).collect(Collectors.toSet());
    List<Candidate> more = new ArrayList<>();
    suppression.visible.stream().filter(candidate -> !primaryKeys.contains(candidate.key)).limit(MAX_MORE).forEach(more::add);
    if (more.size() < MAX_MORE) {
      suppression.suppressed.stream().limit(MAX_MORE - more.size()).forEach(more::add);
    }

    return new OnboardingViewProposalsResponse(
        rangeDays,
        mails.size(),
        accounts,
        new OnboardingViewProposalsResponse.Summary(all.size(), primary.size(), all.size() - primary.size()),
        mapCandidates(primary, mails.size()),
        mapCandidates(more, mails.size()),
        primary.isEmpty()
            ? "Smart suggestions are still warming up. Sync more messages and re-run analysis."
            : null);
  }

  private void addIfNotNull(List<Candidate> all, Candidate candidate) {
    if (candidate != null) {
      all.add(candidate);
    }
  }

  private Candidate buildKnown(
      String key,
      String category,
      String defaultName,
      int basePriority,
      List<MailSignal> mails,
      Map<UUID, OnboardingViewProposalsResponse.AccountItem> accountById,
      int maxSenders,
      Set<String> knownDomains,
      Set<String> keywordPool) {
    List<MailSignal> matched = new ArrayList<>();
    for (MailSignal mail : mails) {
      if (matches(category, mail, knownDomains, keywordPool)) {
        matched.add(mail);
      }
    }
    if (matched.size() < 4) {
      return null;
    }

    List<String> topDomains =
        limit(topByCount(matched.stream().map(mail -> mail.senderDomain).toList(), maxSenders), 10);
    List<String> topSenders =
        limit(topByCount(matched.stream().map(mail -> mail.senderEmail).toList(), maxSenders), 15);
    List<String> topKeywords = limit(topKeywordMatches(keywordPool, matched), 8);
    if ("WORK".equals(category)) {
      topDomains = topDomains.stream().filter(this::isLikelyProfessionalDomain).toList();
    }
    if (topDomains.isEmpty() && topSenders.isEmpty() && topKeywords.isEmpty()) {
      return null;
    }

    List<AccountDistribution> distribution = accountDistribution(matched, accountById);
    Scope scope = decideScope(distribution, accountById.size());
    int score = confidenceScore(category, matched.size(), mails.size(), topDomains, topSenders, topKeywords, distribution);
    int priority = clamp(basePriority + ((score >= 85 || pct(matched.size(), mails.size()) >= 20.0) ? 1 : 0), 1, 5);
    String name = smartName(category, defaultName, topDomains, topKeywords);
    String explanation = explanation(category, topDomains, topKeywords, distribution);

    return new Candidate(
        key,
        category,
        name,
        score,
        confidenceLevel(score),
        priority,
        scope.type,
        scope.accountIds,
        topDomains,
        topSenders,
        topKeywords,
        false,
        explanation,
        limit(topDomains, 3),
        limit(topSenders, 3),
        samples(matched),
        distribution,
        matched.stream().map(mail -> mail.messageId).collect(Collectors.toSet()),
        matched.size());
  }

  private List<Candidate> buildCustomDomainClusters(
      List<MailSignal> mails,
      Map<UUID, OnboardingViewProposalsResponse.AccountItem> accountById,
      int maxSenders) {
    Map<String, Long> domainCounts =
        mails.stream()
            .filter(mail -> !mail.senderDomain.isBlank())
            .collect(Collectors.groupingBy(mail -> mail.senderDomain, Collectors.counting()));
    int minCount = Math.max(5, mails.size() / 25);
    List<Map.Entry<String, Long>> ranked =
        domainCounts.entrySet().stream()
            .filter(entry -> entry.getValue() >= minCount)
            .filter(entry -> isEmergentDomain(entry.getKey()))
            .sorted(Map.Entry.<String, Long>comparingByValue().reversed())
            .limit(4)
            .toList();

    List<Candidate> custom = new ArrayList<>();
    for (Map.Entry<String, Long> entry : ranked) {
      String domain = entry.getKey();
      List<MailSignal> matched =
          mails.stream().filter(mail -> domain.equals(mail.senderDomain)).toList();
      List<String> topSenders =
          limit(topByCount(matched.stream().map(mail -> mail.senderEmail).toList(), maxSenders), 15);
      List<String> keywords = limit(topTokens(matched), 8);
      List<AccountDistribution> distribution = accountDistribution(matched, accountById);
      Scope scope = decideScope(distribution, accountById.size());
      int score =
          clamp(
              45
                  + (int) (pct(matched.size(), mails.size()) * 2.0)
                  + topSenders.size()
                  + keywords.size() * 2,
              30,
              95);
      String readable = readableDomain(domain);
      String name = customName(readable, keywords);
      custom.add(
          new Candidate(
              "custom-" + slug(name),
              "CUSTOM",
              name,
              score,
              confidenceLevel(score),
              clamp(3 + (score >= 85 ? 1 : 0), 1, 5),
              scope.type,
              scope.accountIds,
              List.of(domain),
              topSenders,
              keywords,
              false,
              "Detected a high-signal cluster from " + domain + " with recurring sender traffic.",
              List.of(domain),
              limit(topSenders, 3),
              samples(matched),
              distribution,
              matched.stream().map(mail -> mail.messageId).collect(Collectors.toSet()),
              matched.size()));
    }
    return custom;
  }

  private List<Candidate> dedupeByKey(List<Candidate> candidates) {
    Map<String, Candidate> deduped = new LinkedHashMap<>();
    for (Candidate candidate : candidates) {
      Candidate previous = deduped.get(candidate.key);
      if (previous == null || compareSignal(candidate, previous) < 0) {
        deduped.put(candidate.key, candidate);
      }
    }
    return new ArrayList<>(deduped.values());
  }

  private Suppression suppress(List<Candidate> candidates) {
    List<Candidate> sorted = new ArrayList<>(candidates);
    sorted.sort(this::compareSignal);
    Set<String> suppressedKeys = new HashSet<>();
    for (int i = 0; i < sorted.size(); i++) {
      Candidate strong = sorted.get(i);
      if (suppressedKeys.contains(strong.key)) {
        continue;
      }
      for (int j = i + 1; j < sorted.size(); j++) {
        Candidate weak = sorted.get(j);
        if (suppressedKeys.contains(weak.key)) {
          continue;
        }
        double overlap = overlap(strong.messageIds, weak.messageIds);
        if (overlap >= 0.72 || (strong.category.equals(weak.category) && overlap >= 0.58)) {
          suppressedKeys.add(weak.key);
        }
      }
    }
    List<Candidate> visible = new ArrayList<>();
    List<Candidate> suppressed = new ArrayList<>();
    for (Candidate candidate : sorted) {
      if (suppressedKeys.contains(candidate.key)) {
        suppressed.add(candidate);
      } else {
        visible.add(candidate);
      }
    }
    return new Suppression(visible, suppressed);
  }

  private List<Candidate> selectPrimary(List<Candidate> visible) {
    List<Candidate> primary = new ArrayList<>();
    List<Candidate> low = new ArrayList<>();
    for (Candidate candidate : visible) {
      boolean high = "HIGH".equals(candidate.confidenceLevel);
      boolean medium = "MEDIUM".equals(candidate.confidenceLevel);
      if (high || (medium && candidate.matchCount >= MIN_MEDIUM_MATCHES)) {
        primary.add(candidate);
      } else {
        low.add(candidate);
      }
      if (primary.size() >= MAX_MAIN) {
        break;
      }
    }
    if (primary.size() < 3) {
      low.stream().limit(3 - primary.size()).forEach(primary::add);
    }
    return primary;
  }

  private List<OnboardingViewProposalsResponse.Proposal> mapCandidates(
      List<Candidate> candidates, int totalMessages) {
    return candidates.stream()
        .map(
            candidate ->
                new OnboardingViewProposalsResponse.Proposal(
                    candidate.key,
                    candidate.category,
                    candidate.name,
                    candidate.confidenceScore,
                    candidate.confidenceLevel,
                    candidate.priority,
                    new OnboardingViewProposalsResponse.AccountsScope(
                        candidate.scopeType, candidate.accountIds),
                    new OnboardingViewProposalsResponse.Rules(
                        candidate.senderDomains,
                        candidate.senderEmails,
                        candidate.subjectKeywords,
                        candidate.unreadOnly),
                    candidate.matchCount,
                    roundPct(candidate.matchCount, totalMessages),
                    candidate.explanation,
                    candidate.topDomains,
                    candidate.topSenders,
                    candidate.sampleMessages.stream()
                        .map(
                            sample ->
                                new OnboardingViewProposalsResponse.SampleMessage(
                                    sample.subject, sample.senderEmail, sample.receivedAt.toString()))
                        .toList(),
                    candidate.accountDistribution.stream()
                        .map(
                            item ->
                                new OnboardingViewProposalsResponse.AccountDistribution(
                                    item.accountId, item.email, item.count))
                        .toList()))
        .toList();
  }

  private boolean matches(
      String category, MailSignal mail, Set<String> knownDomains, Set<String> keywordPool) {
    boolean domainMatch = matchesDomain(mail.senderDomain, knownDomains);
    boolean keywordMatch = hasAnyToken(mail.text, keywordPool);
    if ("WORK".equals(category)) {
      return (mail.humanSender && isLikelyProfessionalDomain(mail.senderDomain)) || keywordMatch;
    }
    if ("SCHOOL".equals(category)) {
      return domainMatch
          || keywordMatch
          || mail.senderDomain.endsWith(".edu")
          || mail.senderDomain.contains("school")
          || mail.senderDomain.contains("university");
    }
    if ("MARKETING".equals(category)) {
      return keywordMatch || mail.senderEmail.contains("newsletter") || mail.senderEmail.contains("noreply");
    }
    return domainMatch || keywordMatch;
  }

  private boolean hasAnyToken(String text, Set<String> tokens) {
    for (String token : tokens) {
      if (text.contains(token)) {
        return true;
      }
    }
    return false;
  }

  private boolean matchesDomain(String domain, Set<String> knownDomains) {
    for (String known : knownDomains) {
      if (domain.equals(known) || domain.endsWith("." + known)) {
        return true;
      }
    }
    return false;
  }

  private boolean isEmergentDomain(String domain) {
    if (!isLikelyProfessionalDomain(domain) || PERSONAL_DOMAINS.contains(domain)) {
      return false;
    }
    return !matchesDomain(domain, SOCIAL_DOMAINS)
        && !matchesDomain(domain, GAMING_DOMAINS)
        && !matchesDomain(domain, FINANCE_DOMAINS)
        && !matchesDomain(domain, SHOPPING_DOMAINS)
        && !matchesDomain(domain, TRAVEL_DOMAINS)
        && !matchesDomain(domain, NEWSLETTER_DOMAINS);
  }

  private boolean isLikelyProfessionalDomain(String domain) {
    return domain != null
        && domain.contains(".")
        && !domain.endsWith(".local")
        && !domain.endsWith(".lan")
        && !PERSONAL_DOMAINS.contains(domain);
  }

  private List<String> topByCount(List<String> values, int max) {
    Map<String, Long> counts =
        values.stream()
            .map(this::normalize)
            .filter(value -> !value.isBlank())
            .collect(Collectors.groupingBy(Function.identity(), Collectors.counting()));
    return counts.entrySet().stream()
        .sorted(Map.Entry.<String, Long>comparingByValue().reversed())
        .map(Map.Entry::getKey)
        .limit(max)
        .toList();
  }

  private List<String> topKeywordMatches(Set<String> pool, List<MailSignal> mails) {
    Map<String, Integer> counts = new HashMap<>();
    for (MailSignal mail : mails) {
      for (String token : pool) {
        if (mail.text.contains(token)) {
          counts.merge(token, 1, Integer::sum);
        }
      }
    }
    return counts.entrySet().stream()
        .sorted(Map.Entry.<String, Integer>comparingByValue().reversed())
        .map(Map.Entry::getKey)
        .toList();
  }

  private List<String> topTokens(List<MailSignal> mails) {
    Map<String, Integer> counts = new HashMap<>();
    for (MailSignal mail : mails) {
      for (String token : mail.text.split("[^a-z0-9]+")) {
        if (token.length() < 4 || token.length() > 24) {
          continue;
        }
        if (!WORK_TOKENS.contains(token)
            && !SECURITY_TOKENS.contains(token)
            && !RECEIPT_TOKENS.contains(token)
            && !MARKETING_TOKENS.contains(token)
            && !SCHOOL_TOKENS.contains(token)
            && !GAMING_TOKENS.contains(token)
            && !TRAVEL_TOKENS.contains(token)) {
          continue;
        }
        counts.merge(token, 1, Integer::sum);
      }
    }
    return counts.entrySet().stream()
        .sorted(Map.Entry.<String, Integer>comparingByValue().reversed())
        .map(Map.Entry::getKey)
        .toList();
  }

  private List<AccountDistribution> accountDistribution(
      List<MailSignal> mails, Map<UUID, OnboardingViewProposalsResponse.AccountItem> accountById) {
    Map<UUID, Integer> counts = new HashMap<>();
    for (MailSignal mail : mails) {
      counts.merge(mail.accountId, 1, Integer::sum);
    }
    return counts.entrySet().stream()
        .sorted(Map.Entry.<UUID, Integer>comparingByValue().reversed())
        .map(
            entry ->
                new AccountDistribution(
                    entry.getKey(),
                    accountById.containsKey(entry.getKey())
                        ? accountById.get(entry.getKey()).email()
                        : "Unknown account",
                    entry.getValue()))
        .toList();
  }

  private Scope decideScope(List<AccountDistribution> distribution, int accountsCount) {
    if (distribution.isEmpty()) {
      return new Scope("ALL", List.of());
    }
    if (distribution.size() == 1 && accountsCount > 1) {
      return new Scope("SELECTED", List.of(distribution.get(0).accountId));
    }
    int total = distribution.stream().mapToInt(item -> item.count).sum();
    if (accountsCount > 1 && total > 0 && (distribution.get(0).count / (double) total) >= 0.8) {
      return new Scope("SELECTED", List.of(distribution.get(0).accountId));
    }
    return new Scope("ALL", List.of());
  }

  private int confidenceScore(
      String category,
      int matched,
      int total,
      List<String> topDomains,
      List<String> topSenders,
      List<String> topKeywords,
      List<AccountDistribution> distribution) {
    int base =
        switch (category) {
          case "SECURITY" -> 44;
          case "FINANCE" -> 40;
          case "WORK" -> 39;
          default -> 34;
        };
    int score =
        base
            + Math.min(35, (int) (pct(matched, total) * 2.0))
            + Math.min(12, topDomains.size() * 2)
            + Math.min(10, topSenders.size())
            + Math.min(10, topKeywords.size() * 2)
            + (distribution.size() > 1 ? 8 : 3);
    if ("WORK".equals(category) && topDomains.stream().noneMatch(this::isLikelyProfessionalDomain)) {
      score -= 8;
    }
    return clamp(score, 20, 98);
  }

  private String confidenceLevel(int score) {
    if (score >= 80) {
      return "HIGH";
    }
    if (score >= 58) {
      return "MEDIUM";
    }
    return "LOW";
  }

  private String smartName(
      String category, String fallback, List<String> topDomains, List<String> topKeywords) {
    if ("SOCIAL".equals(category) && topDomains.stream().anyMatch(domain -> domain.contains("linkedin"))) {
      return "LinkedIn & Recruiting";
    }
    if ("WORK".equals(category) && !topDomains.isEmpty()) {
      return readableDomain(topDomains.get(0)) + " Work";
    }
    if ("NEWSLETTERS".equals(category) && topKeywords.contains("digest")) {
      return "Newsletters & Digests";
    }
    return fallback;
  }

  private String customName(String readableDomain, List<String> keywords) {
    if (keywords.stream().anyMatch(keyword -> keyword.contains("security") || keyword.contains("alert"))) {
      return readableDomain + " Alerts";
    }
    if (keywords.stream().anyMatch(keyword -> keyword.contains("newsletter") || keyword.contains("digest"))) {
      return readableDomain + " Newsletters";
    }
    if (keywords.stream().anyMatch(keyword -> keyword.contains("recruit"))) {
      return readableDomain + " / Recruiting";
    }
    return readableDomain + " Focus";
  }

  private String explanation(
      String category,
      List<String> domains,
      List<String> keywords,
      List<AccountDistribution> distribution) {
    String domainText =
        domains.isEmpty() ? "repeated sender patterns" : String.join(", ", limit(domains, 2));
    String keywordText =
        keywords.isEmpty()
            ? "message patterns"
            : "keywords like " + String.join(", ", limit(keywords, 3));
    String accountText =
        distribution.size() > 1 ? "across multiple accounts" : "in a focused account scope";
    return "Built from "
        + category.toLowerCase(Locale.ROOT)
        + " signals ("
        + domainText
        + ") and "
        + keywordText
        + " "
        + accountText
        + ".";
  }

  private List<SampleMessage> samples(List<MailSignal> mails) {
    return mails.stream()
        .sorted(Comparator.comparing((MailSignal mail) -> mail.receivedAt).reversed())
        .limit(3)
        .map(
            mail ->
                new SampleMessage(
                    mail.subject.isBlank() ? "(No subject)" : mail.subject,
                    mail.senderEmail,
                    mail.receivedAt))
        .toList();
  }

  private int compareSignal(Candidate left, Candidate right) {
    int cmp = Integer.compare(right.confidenceScore, left.confidenceScore);
    if (cmp != 0) {
      return cmp;
    }
    cmp = Integer.compare(right.matchCount, left.matchCount);
    if (cmp != 0) {
      return cmp;
    }
    return left.name.compareToIgnoreCase(right.name);
  }

  private double overlap(Set<UUID> left, Set<UUID> right) {
    if (left.isEmpty() || right.isEmpty()) {
      return 0;
    }
    Set<UUID> small = left.size() <= right.size() ? left : right;
    Set<UUID> big = left.size() <= right.size() ? right : left;
    int same = 0;
    for (UUID id : small) {
      if (big.contains(id)) {
        same++;
      }
    }
    return same / (double) Math.min(left.size(), right.size());
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
        (rs, rowNum) ->
            new OnboardingViewProposalsResponse.AccountItem(
                rs.getObject("id", UUID.class), rs.getString("email"), rs.getString("role")));
  }

  private List<MailSignal> loadSignals(OffsetDateTime from, OffsetDateTime to, int maxMessages) {
    return jdbcTemplate.query(
        """
      SELECT
        m.id,
        m.account_id,
        COALESCE(m.sender_name, '') AS sender_name,
        lower(COALESCE(m.sender_email, '')) AS sender_email,
        lower(COALESCE(m.sender_domain, '')) AS sender_domain,
        COALESCE(m.subject, '') AS subject,
        COALESCE(m.snippet, '') AS snippet,
        m.received_at
      FROM messages m
      WHERE m.received_at >= ?
        AND m.received_at <= ?
        AND m.is_sent = false
        AND m.is_draft = false
        AND NOT ('SPAM' = ANY(m.gmail_label_ids) OR 'TRASH' = ANY(m.gmail_label_ids))
      ORDER BY m.received_at DESC
      LIMIT ?
      """,
        (rs, rowNum) -> {
          String senderEmail = normalize(rs.getString("sender_email"));
          String subject = rs.getString("subject");
          String snippet = rs.getString("snippet");
          return new MailSignal(
              rs.getObject("id", UUID.class),
              rs.getObject("account_id", UUID.class),
              rs.getString("sender_name"),
              senderEmail,
              normalize(rs.getString("sender_domain")),
              subject,
              snippet,
              rs.getObject("received_at", OffsetDateTime.class),
              normalize(subject + " " + snippet),
              looksHumanSender(senderEmail));
        },
        from,
        to,
        maxMessages);
  }

  private boolean looksHumanSender(String senderEmail) {
    String local = senderEmail.split("@", 2)[0];
    return !local.contains("noreply")
        && !local.contains("no-reply")
        && !local.contains("newsletter")
        && !local.contains("alerts")
        && !local.contains("updates");
  }

  private OnboardingViewProposalsResponse emptyResponse(
      int rangeDays,
      int analyzedMessages,
      List<OnboardingViewProposalsResponse.AccountItem> accounts,
      String message) {
    return new OnboardingViewProposalsResponse(
        rangeDays,
        analyzedMessages,
        accounts,
        new OnboardingViewProposalsResponse.Summary(0, 0, 0),
        List.of(),
        List.of(),
        message);
  }

  private String readableDomain(String domain) {
    String normalized = normalize(domain);
    if (normalized.startsWith("www.")) {
      normalized = normalized.substring(4);
    }
    String[] parts = normalized.split("\\.");
    String core = parts.length >= 2 ? parts[parts.length - 2] : normalized;
    if (core.isBlank()) {
      return "Custom";
    }
    return core.substring(0, 1).toUpperCase(Locale.ROOT) + core.substring(1);
  }

  private String slug(String value) {
    return normalize(value).replaceAll("[^a-z0-9]+", "-").replaceAll("(^-|-$)", "");
  }

  private double pct(int count, int total) {
    return total <= 0 ? 0 : (count * 100.0) / total;
  }

  private double roundPct(int count, int total) {
    return Math.round((pct(count, total) * 10.0)) / 10.0;
  }

  private List<String> limit(List<String> values, int max) {
    if (values.size() <= max) {
      return values;
    }
    return values.subList(0, max);
  }

  private String normalize(String value) {
    return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
  }

  private int clamp(int value, int min, int max) {
    return Math.max(min, Math.min(max, value));
  }

  private int resolveRangeDays(String rawRange) {
    if (rawRange == null || rawRange.isBlank()) {
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

  private int resolveMaxSenders(Integer value) {
    if (value == null) {
      return DEFAULT_MAX_SENDERS;
    }
    if (value < 10 || value > 200) {
      throw new ApiBadRequestException("maxSenders must be between 10 and 200.");
    }
    return value;
  }

  private int resolveMaxMessages(Integer value) {
    if (value == null) {
      return DEFAULT_MAX_MESSAGES;
    }
    if (value < 100 || value > 3000) {
      throw new ApiBadRequestException("maxMessages must be between 100 and 3000.");
    }
    return value;
  }

  private int parsePositiveInt(String value, String fieldName) {
    try {
      return Integer.parseInt(value);
    } catch (NumberFormatException ex) {
      throw new ApiBadRequestException(fieldName + " must be a valid integer.");
    }
  }

  private record Scope(String type, List<UUID> accountIds) {}

  private record AccountDistribution(UUID accountId, String email, int count) {}

  private record SampleMessage(String subject, String senderEmail, OffsetDateTime receivedAt) {}

  private record MailSignal(
      UUID messageId,
      UUID accountId,
      String senderName,
      String senderEmail,
      String senderDomain,
      String subject,
      String snippet,
      OffsetDateTime receivedAt,
      String text,
      boolean humanSender) {}

  private record Candidate(
      String key,
      String category,
      String name,
      int confidenceScore,
      String confidenceLevel,
      int priority,
      String scopeType,
      List<UUID> accountIds,
      List<String> senderDomains,
      List<String> senderEmails,
      List<String> subjectKeywords,
      boolean unreadOnly,
      String explanation,
      List<String> topDomains,
      List<String> topSenders,
      List<SampleMessage> sampleMessages,
      List<AccountDistribution> accountDistribution,
      Set<UUID> messageIds,
      int matchCount) {}

  private static class Suppression {
    private final List<Candidate> visible;
    private final List<Candidate> suppressed;

    private Suppression(List<Candidate> visible, List<Candidate> suppressed) {
      this.visible = visible;
      this.suppressed = suppressed;
    }
  }
}
