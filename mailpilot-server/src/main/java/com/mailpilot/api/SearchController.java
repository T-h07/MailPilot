package com.mailpilot.api;

import com.mailpilot.api.model.SearchHealthResponse;
import com.mailpilot.service.MailboxQueryService;
import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Profile("dev")
@RequestMapping("/api/search")
public class SearchController {

  private final MailboxQueryService mailboxQueryService;

  public SearchController(MailboxQueryService mailboxQueryService) {
    this.mailboxQueryService = mailboxQueryService;
  }

  @GetMapping("/health")
  public SearchHealthResponse health(@RequestParam(name = "q", required = false) String q) {
    MailboxQueryService.SearchHealth health = mailboxQueryService.checkSearchHealth(q);
    return new SearchHealthResponse(health.configured(), health.method(), health.matches());
  }
}
