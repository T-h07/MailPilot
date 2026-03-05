package com.mailpilot.api;

import com.mailpilot.api.model.InsightsSummaryResponse;
import com.mailpilot.service.InsightsService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/insights")
public class InsightsController {

  private final InsightsService insightsService;

  public InsightsController(InsightsService insightsService) {
    this.insightsService = insightsService;
  }

  @GetMapping("/summary")
  public InsightsSummaryResponse summary(
    @RequestParam(name = "range", defaultValue = "7d") String range
  ) {
    return insightsService.getSummary(range);
  }
}
