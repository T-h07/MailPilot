package com.mailpilot.api;

import com.mailpilot.api.error.ApiBadRequestException;
import com.mailpilot.api.model.AppPasswordChangeRequest;
import com.mailpilot.api.model.AppPasswordRequest;
import com.mailpilot.api.model.AppPasswordSetRequest;
import com.mailpilot.api.model.AppStateResponse;
import com.mailpilot.api.model.StatusResponse;
import com.mailpilot.service.AppStateService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/app")
public class AppStateController {

  private final AppStateService appStateService;

  public AppStateController(AppStateService appStateService) {
    this.appStateService = appStateService;
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
}
