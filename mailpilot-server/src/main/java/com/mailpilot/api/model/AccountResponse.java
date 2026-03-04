package com.mailpilot.api.model;

import java.util.UUID;

public record AccountResponse(UUID id, String email, String provider, String status) {}
