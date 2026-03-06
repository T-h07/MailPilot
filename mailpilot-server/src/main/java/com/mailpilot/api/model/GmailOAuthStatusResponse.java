package com.mailpilot.api.model;

import java.util.UUID;

public record GmailOAuthStatusResponse(
    String state, String status, String message, UUID accountId, String email) {}
