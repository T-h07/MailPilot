package com.mailpilot.api.model;

public record OnboardingCompleteRequest(
    String firstName, String lastName, String fieldOfWork, String password) {}
