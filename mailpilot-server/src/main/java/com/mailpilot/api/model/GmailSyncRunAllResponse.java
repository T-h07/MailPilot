package com.mailpilot.api.model;

public record GmailSyncRunAllResponse(String status, int maxMessages, int accountsQueued) {}
