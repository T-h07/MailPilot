package com.mailpilot.service;

import com.mailpilot.api.model.AppStateResponse;
import com.mailpilot.repository.AppStateRepository;
import com.mailpilot.repository.AppStateRepository.AppStateRow;
import com.mailpilot.repository.AppStateRepository.UserProfileRow;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class AppStateService {

  private final AppStateRepository appStateRepository;
  private final LocalAuthService localAuthService;

  public AppStateService(AppStateRepository appStateRepository, LocalAuthService localAuthService) {
    this.appStateRepository = appStateRepository;
    this.localAuthService = localAuthService;
  }

  @Transactional
  public AppStateResponse getAppState() {
    AppStateRow appState = appStateRepository.getAppState();
    UserProfileRow profile = appStateRepository.getUserProfile();

    return new AppStateResponse(
        appState.onboardingComplete(),
        appState.onboardingStep(),
        appState.locked(),
        localAuthService.hasPassword(),
        new AppStateResponse.Profile(
            profile.firstName(), profile.lastName(), profile.fieldOfWork()));
  }

  @Transactional
  public AppStateRow getCurrentAppStateRow() {
    return appStateRepository.getAppState();
  }

  @Transactional
  public void setOnboardingStep(int step) {
    int clampedStep = Math.max(1, Math.min(5, step));
    appStateRepository.setOnboardingStep(clampedStep);
  }

  @Transactional
  public void markOnboardingCompleted() {
    appStateRepository.markOnboardingCompleted();
  }

  @Transactional
  public void setPassword(String password) {
    localAuthService.setPassword(password);
  }

  @Transactional
  public void login(String password) {
    localAuthService.verifyPassword(password);
    appStateRepository.setLocked(false);
  }

  @Transactional
  public void lock() {
    appStateRepository.setLocked(true);
  }

  @Transactional
  public void unlock(String password) {
    localAuthService.verifyPassword(password);
    appStateRepository.setLocked(false);
  }

  @Transactional
  public void logout() {
    appStateRepository.setLocked(true);
  }

  @Transactional
  public void updateUserProfile(String firstName, String lastName, String fieldOfWork) {
    appStateRepository.updateUserProfile(
        normalizeNullableText(firstName, 120),
        normalizeNullableText(lastName, 120),
        normalizeNullableText(fieldOfWork, 180));
  }

  private String normalizeNullableText(String value, int maxLength) {
    if (!StringUtils.hasText(value)) {
      return null;
    }

    String normalized = value.trim();
    if (normalized.length() > maxLength) {
      return normalized.substring(0, maxLength);
    }
    return normalized;
  }
}
