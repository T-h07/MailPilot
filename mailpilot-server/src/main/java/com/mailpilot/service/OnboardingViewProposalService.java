package com.mailpilot.service;

import com.mailpilot.api.error.ApiBadRequestException;
import com.mailpilot.api.model.OnboardingViewProposalsApplyRequest;
import com.mailpilot.api.model.OnboardingViewProposalsApplyResponse;
import com.mailpilot.api.model.OnboardingViewProposalsResponse;
import com.mailpilot.api.model.ViewResponse;
import com.mailpilot.api.model.ViewUpsertRequest;
import com.mailpilot.onboarding.OnboardingViewSuggestionService;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OnboardingViewProposalService {

  private static final int MAX_APPLY_VIEWS = 12;
  private static final int MAX_APPLY_DOMAINS = 20;
  private static final int MAX_APPLY_EMAILS = 20;
  private static final int MAX_APPLY_KEYWORDS = 10;

  private final ViewService viewService;
  private final OnboardingViewSuggestionService onboardingViewSuggestionService;

  public OnboardingViewProposalService(
      ViewService viewService, OnboardingViewSuggestionService onboardingViewSuggestionService) {
    this.viewService = viewService;
    this.onboardingViewSuggestionService = onboardingViewSuggestionService;
  }

  public OnboardingViewProposalsResponse generateProposals(
      String rawRange, Integer rawMaxSenders, Integer rawMaxMessages) {
    return onboardingViewSuggestionService.generateProposals(rawRange, rawMaxSenders, rawMaxMessages);
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

    List<OnboardingViewProposalsApplyResponse.CreatedView> created = new java.util.ArrayList<>();
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

  private String normalize(String value) {
    return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
  }

  private String safeTrim(String value) {
    return value == null ? "" : value.trim();
  }

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
