package com.mailpilot.api.model;

import java.util.UUID;

public record GmailSyncStartResponse(String status, UUID accountId, int maxMessages) {}
