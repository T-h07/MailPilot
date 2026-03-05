package com.mailpilot.api.model;

import java.util.List;
import java.util.UUID;

public record MessageViewLabelsUpdateRequest(List<UUID> labelIds) {}
