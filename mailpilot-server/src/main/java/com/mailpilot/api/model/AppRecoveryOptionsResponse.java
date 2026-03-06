package com.mailpilot.api.model;

public record AppRecoveryOptionsResponse(
    boolean canRecover, String maskedEmail, String primaryEmail, String reason) {}
