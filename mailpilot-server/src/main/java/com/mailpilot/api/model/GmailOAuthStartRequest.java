package com.mailpilot.api.model;

public record GmailOAuthStartRequest(
    String returnTo, String mode, String context, String accountHint) {}
