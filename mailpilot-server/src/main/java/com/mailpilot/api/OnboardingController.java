package com.mailpilot.api;

import com.mailpilot.api.error.ApiBadRequestException;
import com.mailpilot.api.model.OnboardingCompleteRequest;
import com.mailpilot.api.model.OnboardingPrimaryAccountConfirmRequest;
import com.mailpilot.api.model.OnboardingStartResponse;
import com.mailpilot.api.model.OnboardingViewProposalsApplyRequest;
import com.mailpilot.api.model.OnboardingViewProposalsApplyResponse;
import com.mailpilot.api.model.OnboardingViewProposalsResponse;
import com.mailpilot.api.model.StatusResponse;
import com.mailpilot.service.OnboardingService;
import com.mailpilot.service.OnboardingViewProposalService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/onboarding")
public class OnboardingController {

  private final OnboardingService onboardingService;
  private final OnboardingViewProposalService onboardingViewProposalService;

  public OnboardingController(
      OnboardingService onboardingService,
      OnboardingViewProposalService onboardingViewProposalService) {
    this.onboardingService = onboardingService;
    this.onboardingViewProposalService = onboardingViewProposalService;
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

  @GetMapping("/view-proposals")
  public OnboardingViewProposalsResponse viewProposals(
      @RequestParam(name = "range", required = false) String range,
      @RequestParam(name = "maxSenders", required = false) Integer maxSenders) {
    return onboardingViewProposalService.generateProposals(range, maxSenders);
  }

  @PostMapping("/view-proposals/apply")
  public OnboardingViewProposalsApplyResponse applyViewProposals(
      @RequestBody OnboardingViewProposalsApplyRequest request) {
    if (request == null) {
      throw new ApiBadRequestException("Request body is required.");
    }
    return onboardingViewProposalService.apply(request);
  }

  @PostMapping("/view-proposals/complete")
  public StatusResponse completeViewProposalsStep() {
    onboardingService.completeViewProposalsStep();
    return new StatusResponse("ok");
  }

  @PostMapping("/complete")
  public StatusResponse complete(@RequestBody OnboardingCompleteRequest request) {
    onboardingService.complete(request);
    return new StatusResponse("ok");
  }
}
