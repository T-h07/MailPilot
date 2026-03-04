package com.mailpilot.api;

import com.mailpilot.api.model.BadgeSummaryResponse;
import com.mailpilot.api.model.StatusResponse;
import com.mailpilot.service.BadgeService;
import com.mailpilot.service.events.AppEventBus;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/badges")
public class BadgeController {

  private final BadgeService badgeService;
  private final AppEventBus appEventBus;

  public BadgeController(BadgeService badgeService, AppEventBus appEventBus) {
    this.badgeService = badgeService;
    this.appEventBus = appEventBus;
  }

  @GetMapping("/summary")
  public BadgeSummaryResponse summary() {
    BadgeService.BadgeSummary summary = badgeService.computeBadgeSummary();
    return new BadgeSummaryResponse(summary.inbox(), summary.viewsTotal(), summary.views());
  }

  @PostMapping("/inbox/opened")
  public StatusResponse inboxOpened() {
    badgeService.markInboxOpened();
    appEventBus.publishBadgeUpdate(badgeService.computeBadgeSummary());
    return new StatusResponse("ok");
  }

  @PostMapping("/views/{viewId}/opened")
  public StatusResponse viewOpened(@PathVariable("viewId") UUID viewId) {
    badgeService.markViewOpened(viewId);
    appEventBus.publishBadgeUpdate(badgeService.computeBadgeSummary());
    return new StatusResponse("ok");
  }
}
