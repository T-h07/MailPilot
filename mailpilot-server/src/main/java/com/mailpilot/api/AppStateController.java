package com.mailpilot.api;

import com.mailpilot.api.error.ApiBadRequestException;
import com.mailpilot.api.model.AppPasswordChangeRequest;
import com.mailpilot.api.model.AppPasswordRequest;
import com.mailpilot.api.model.AppPasswordSetRequest;
import com.mailpilot.api.model.AppRecoveryOptionsResponse;
import com.mailpilot.api.model.AppRecoveryRequestResponse;
import com.mailpilot.api.model.AppRecoveryVerifyRequest;
import com.mailpilot.api.model.AppStateResponse;
import com.mailpilot.api.model.StatusResponse;
import com.mailpilot.service.AppStateService;
import com.mailpilot.service.LocalPasswordRecoveryService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/app")
public class AppStateController {

  private final AppStateService appStateService;
  private final LocalPasswordRecoveryService localPasswordRecoveryService;

  public AppStateController(
      AppStateService appStateService, LocalPasswordRecoveryService localPasswordRecoveryService) {
    this.appStateService = appStateService;
    this.localPasswordRecoveryService = localPasswordRecoveryService;
  }

  @GetMapping("/state")
  public AppStateResponse getState() {
    return appStateService.getAppState();
  }

  @PostMapping("/password/set")
  public StatusResponse setPassword(@RequestBody AppPasswordSetRequest request) {
    if (request == null) {
      throw new ApiBadRequestException("Request body is required.");
    }
    appStateService.setPassword(request.password());
    return new StatusResponse("ok");
  }

  @PostMapping("/password/change")
  public StatusResponse changePassword(@RequestBody AppPasswordChangeRequest request) {
    if (request == null) {
      throw new ApiBadRequestException("Request body is required.");
    }
    appStateService.changePassword(
        request.currentPassword(), request.newPassword(), request.confirmNewPassword());
    return new StatusResponse("ok");
  }

  @PostMapping("/login")
  public StatusResponse login(@RequestBody AppPasswordRequest request) {
    if (request == null) {
      throw new ApiBadRequestException("Request body is required.");
    }
    appStateService.login(request.password());
    return new StatusResponse("ok");
  }

  @PostMapping("/lock")
  public StatusResponse lock() {
    appStateService.lock();
    return new StatusResponse("ok");
  }

  @PostMapping("/unlock")
  public StatusResponse unlock(@RequestBody AppPasswordRequest request) {
    if (request == null) {
      throw new ApiBadRequestException("Request body is required.");
    }
    appStateService.unlock(request.password());
    return new StatusResponse("ok");
  }

  @PostMapping("/logout")
  public StatusResponse logout() {
    appStateService.logout();
    return new StatusResponse("ok");
  }

  @GetMapping("/recovery/options")
  public AppRecoveryOptionsResponse recoveryOptions() {
    LocalPasswordRecoveryService.RecoveryAvailability availability =
        localPasswordRecoveryService.getRecoveryAvailability();
    return new AppRecoveryOptionsResponse(
        availability.canRecover(), availability.maskedEmail(), availability.reason());
  }

  @PostMapping("/recovery/request")
  public AppRecoveryRequestResponse requestRecoveryCode(HttpServletRequest request) {
    String requestIp = request == null ? null : request.getRemoteAddr();
    int cooldownSeconds = localPasswordRecoveryService.requestRecoveryCode(requestIp);
    return new AppRecoveryRequestResponse("ok", cooldownSeconds);
  }

  @PostMapping("/recovery/verify")
  public StatusResponse verifyRecoveryCode(@RequestBody AppRecoveryVerifyRequest request) {
    if (request == null) {
      throw new ApiBadRequestException("Request body is required.");
    }
    localPasswordRecoveryService.verifyAndResetPassword(
        request.code(), request.newPassword(), request.confirmNewPassword());
    return new StatusResponse("ok");
  }
}
