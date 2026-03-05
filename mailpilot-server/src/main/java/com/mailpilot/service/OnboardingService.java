package com.mailpilot.service;

import com.mailpilot.api.error.ApiBadRequestException;
import com.mailpilot.api.error.ApiConflictException;
import com.mailpilot.api.error.ApiNotFoundException;
import com.mailpilot.api.model.OnboardingCompleteRequest;
import com.mailpilot.repository.AppStateRepository.AppStateRow;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class OnboardingService {

  private static final Pattern NAME_PATTERN = Pattern.compile("^[\\p{L}][\\p{L} '\\-]{0,39}$");

  private final AppStateService appStateService;
  private final AccountService accountService;
  private final LocalAuthService localAuthService;

  public OnboardingService(
      AppStateService appStateService,
      AccountService accountService,
      LocalAuthService localAuthService) {
    this.appStateService = appStateService;
    this.accountService = accountService;
    this.localAuthService = localAuthService;
  }

  @Transactional
  public int start() {
    AppStateRow appStateRow = appStateService.getCurrentAppStateRow();
    if (appStateRow.onboardingComplete()) {
      return 4;
    }
    appStateService.setOnboardingStep(2);
    return 2;
  }

  @Transactional
  public void confirmPrimaryAccount(UUID accountId) {
    if (accountId == null) {
      throw new ApiBadRequestException("accountId is required.");
    }

    AppStateRow appStateRow = appStateService.getCurrentAppStateRow();
    if (appStateRow.onboardingComplete()) {
      throw new ApiConflictException("Onboarding is already complete.");
    }

    accountService.setPrimaryForOnboarding(accountId);
    appStateService.setOnboardingStep(3);
  }

  @Transactional
  public void complete(OnboardingCompleteRequest request) {
    if (request == null) {
      throw new ApiBadRequestException("Request body is required.");
    }

    AppStateRow appStateRow = appStateService.getCurrentAppStateRow();
    if (appStateRow.onboardingComplete()) {
      throw new ApiConflictException("Onboarding is already complete.");
    }

    String firstName = normalizeName(request.firstName(), "First name");
    String lastName = normalizeName(request.lastName(), "Last name");
    String fieldOfWork = normalizeFieldOfWork(request.fieldOfWork());

    ensurePrimaryAccountExists();

    localAuthService.setPassword(request.password(), true);
    appStateService.updateUserProfile(firstName, lastName, fieldOfWork);
    appStateService.markOnboardingCompleted();
  }

  private void ensurePrimaryAccountExists() {
    boolean hasPrimary =
        accountService.listAccounts().stream()
            .anyMatch(
                account ->
                    "GMAIL".equalsIgnoreCase(account.provider())
                        && "PRIMARY".equalsIgnoreCase(account.role()));
    if (!hasPrimary) {
      throw new ApiNotFoundException("Primary Gmail account is required to complete onboarding.");
    }
  }

  private String normalizeName(String rawValue, String fieldLabel) {
    if (!StringUtils.hasText(rawValue)) {
      throw new ApiBadRequestException(fieldLabel + " is required.");
    }
    String value = rawValue.trim();
    if (!NAME_PATTERN.matcher(value).matches()) {
      throw new ApiBadRequestException(
          fieldLabel + " must be 1-40 chars and contain letters/spaces only.");
    }
    return value;
  }

  private String normalizeFieldOfWork(String rawValue) {
    if (!StringUtils.hasText(rawValue)) {
      throw new ApiBadRequestException("Field of work is required.");
    }
    String value = rawValue.trim();
    if (value.length() > 60) {
      throw new ApiBadRequestException("Field of work must be 1-60 characters.");
    }
    return value;
  }
}
