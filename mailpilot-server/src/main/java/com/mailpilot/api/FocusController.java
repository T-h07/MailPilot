package com.mailpilot.api;

import com.mailpilot.api.model.FocusQueueResponse;
import com.mailpilot.api.model.FocusSummaryResponse;
import com.mailpilot.service.FocusService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/focus")
public class FocusController {

  private final FocusService focusService;

  public FocusController(FocusService focusService) {
    this.focusService = focusService;
  }

  @GetMapping("/summary")
  public FocusSummaryResponse getSummary() {
    return focusService.getSummary();
  }

  @GetMapping("/queue")
  public FocusQueueResponse getQueue(
    @RequestParam("type") String type,
    @RequestParam(value = "pageSize", required = false) Integer pageSize,
    @RequestParam(value = "cursor", required = false) String cursor
  ) {
    return focusService.getQueue(type, pageSize, cursor);
  }
}
