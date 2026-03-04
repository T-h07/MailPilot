package com.mailpilot.api;

import com.mailpilot.api.model.MailboxQueryRequest;
import com.mailpilot.api.model.MailboxQueryResponse;
import com.mailpilot.api.model.ViewMailboxQueryRequest;
import com.mailpilot.service.MailboxQueryService;
import com.mailpilot.service.ViewExecutionService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/mailbox")
public class MailboxController {

  private final MailboxQueryService mailboxQueryService;
  private final ViewExecutionService viewExecutionService;

  public MailboxController(
    MailboxQueryService mailboxQueryService,
    ViewExecutionService viewExecutionService
  ) {
    this.mailboxQueryService = mailboxQueryService;
    this.viewExecutionService = viewExecutionService;
  }

  @PostMapping("/query")
  public MailboxQueryResponse query(@Valid @RequestBody MailboxQueryRequest request) {
    return mailboxQueryService.query(request);
  }

  @PostMapping("/query/view")
  public MailboxQueryResponse queryView(@RequestBody ViewMailboxQueryRequest request) {
    return viewExecutionService.queryView(request);
  }
}
