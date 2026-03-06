package com.mailpilot.api;

import com.mailpilot.api.error.ApiBadRequestException;
import com.mailpilot.api.model.StatusResponse;
import com.mailpilot.api.model.UserProfileUpdateRequest;
import com.mailpilot.service.AppStateService;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/user")
public class UserProfileController {

  private final AppStateService appStateService;

  public UserProfileController(AppStateService appStateService) {
    this.appStateService = appStateService;
  }

  @PatchMapping("/profile")
  public StatusResponse updateProfile(@RequestBody UserProfileUpdateRequest request) {
    if (request == null) {
      throw new ApiBadRequestException("Request body is required.");
    }
    appStateService.updateUserProfile(
        request.firstName(), request.lastName(), request.fieldOfWork());
    return new StatusResponse("ok");
  }
}
