package com.mailpilot.api;

import com.mailpilot.api.error.ApiBadRequestException;
import com.mailpilot.api.model.StatusResponse;
import com.mailpilot.api.model.SystemResetRequest;
import com.mailpilot.service.SystemResetService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/system")
public class SystemController {

  private final SystemResetService systemResetService;

  public SystemController(SystemResetService systemResetService) {
    this.systemResetService = systemResetService;
  }

  @PostMapping("/reset")
  public StatusResponse reset(@RequestBody SystemResetRequest request) {
    if (request == null) {
      throw new ApiBadRequestException("Request body is required.");
    }
    systemResetService.reset(request.password(), request.confirmText());
    return new StatusResponse("ok");
  }
}
