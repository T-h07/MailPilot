package com.mailpilot.api.model;

import java.util.UUID;

public record AccountDeleteResponse(String status, UUID deletedAccountId) {}
