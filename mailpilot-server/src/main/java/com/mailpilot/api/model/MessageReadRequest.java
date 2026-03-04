package com.mailpilot.api.model;

import jakarta.validation.constraints.NotNull;

public record MessageReadRequest(@NotNull(message = "isUnread is required") Boolean isUnread) {}
