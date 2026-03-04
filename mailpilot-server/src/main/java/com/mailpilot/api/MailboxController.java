package com.mailpilot.api;

import com.mailpilot.api.model.MailboxQueryRequest;
import com.mailpilot.api.model.MailboxQueryResponse;
import com.mailpilot.service.MailboxQueryService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/mailbox")
public class MailboxController {

  private final MailboxQueryService mailboxQueryService;

  public MailboxController(MailboxQueryService mailboxQueryService) {
    this.mailboxQueryService = mailboxQueryService;
  }

  @PostMapping("/query")
  public MailboxQueryResponse query(@Valid @RequestBody MailboxQueryRequest request) {
    return mailboxQueryService.query(request);
  }
}
