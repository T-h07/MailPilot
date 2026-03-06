package com.mailpilot.api.model;

public record AppStateResponse(
    boolean onboardingComplete,
    int onboardingStep,
    boolean locked,
    boolean hasPassword,
    Profile profile) {
  public record Profile(String firstName, String lastName, String fieldOfWork) {}
}
