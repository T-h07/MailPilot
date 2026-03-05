package com.mailpilot.api;

import com.mailpilot.api.model.DashboardSummaryResponse;
import com.mailpilot.service.DashboardService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/dashboard")
public class DashboardController {

  private final DashboardService dashboardService;

  public DashboardController(DashboardService dashboardService) {
    this.dashboardService = dashboardService;
  }

  @GetMapping("/summary")
  public DashboardSummaryResponse summary() {
    return dashboardService.getSummary();
  }
}
