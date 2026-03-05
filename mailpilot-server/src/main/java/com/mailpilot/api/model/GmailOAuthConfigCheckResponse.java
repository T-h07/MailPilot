package com.mailpilot.api.model;

public record GmailOAuthConfigCheckResponse(boolean configured, String path, String message) {}
