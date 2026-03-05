package com.mailpilot.api;

import com.mailpilot.api.model.StatusResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/export")
public class ExportController {

  @GetMapping("/health")
  public StatusResponse health() {
    return new StatusResponse("ok");
  }
}
