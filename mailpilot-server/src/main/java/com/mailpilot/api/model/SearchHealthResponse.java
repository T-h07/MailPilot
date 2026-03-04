package com.mailpilot.api.model;

public record SearchHealthResponse(boolean configured, String method, int matches) {}
