package com.mailpilot.api.model;

import java.util.List;
import java.util.UUID;

public record OnboardingViewProposalsApplyResponse(String status, List<CreatedView> created) {
  public record CreatedView(UUID viewId, String name) {}
}
