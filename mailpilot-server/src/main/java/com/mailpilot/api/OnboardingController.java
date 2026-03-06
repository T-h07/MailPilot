package com.mailpilot.api;

import com.mailpilot.api.error.ApiBadRequestException;
import com.mailpilot.api.model.OnboardingCompleteRequest;
import com.mailpilot.api.model.OnboardingPrimaryAccountConfirmRequest;
import com.mailpilot.api.model.OnboardingStartResponse;
import com.mailpilot.api.model.StatusResponse;
import com.mailpilot.service.OnboardingService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/onboarding")
public class OnboardingController {

  private final OnboardingService onboardingService;

  public OnboardingController(OnboardingService onboardingService) {
    this.onboardingService = onboardingService;
  }

  @PostMapping("/start")
  public OnboardingStartResponse start() {
    int step = onboardingService.start();
    return new OnboardingStartResponse("ok", step);
  }

  @PostMapping("/primary-account/confirm")
  public StatusResponse confirmPrimaryAccount(
      @RequestBody OnboardingPrimaryAccountConfirmRequest request) {
    if (request == null) {
      throw new ApiBadRequestException("Request body is required.");
    }
    onboardingService.confirmPrimaryAccount(request.accountId());
    return new StatusResponse("ok");
  }

  @PostMapping("/accounts/complete")
  public StatusResponse completeAccountsStep() {
    onboardingService.completeAccountsStep();
    return new StatusResponse("ok");
  }

  @PostMapping("/complete")
  public StatusResponse complete(@RequestBody OnboardingCompleteRequest request) {
    onboardingService.complete(request);
    return new StatusResponse("ok");
  }
}
