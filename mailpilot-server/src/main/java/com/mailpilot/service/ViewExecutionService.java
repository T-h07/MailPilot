package com.mailpilot.service;

import com.mailpilot.api.error.ApiBadRequestException;
import com.mailpilot.api.model.MailboxQueryRequest;
import com.mailpilot.api.model.MailboxQueryResponse;
import com.mailpilot.api.model.ViewMailboxQueryRequest;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class ViewExecutionService {

  private final ViewService viewService;
  private final MailboxQueryService mailboxQueryService;

  public ViewExecutionService(ViewService viewService, MailboxQueryService mailboxQueryService) {
    this.viewService = viewService;
    this.mailboxQueryService = mailboxQueryService;
  }

  public MailboxQueryResponse queryView(ViewMailboxQueryRequest request) {
    if (request == null || request.viewId() == null) {
      throw new ApiBadRequestException("viewId is required");
    }

    ViewService.ViewDefinition view = viewService.getViewDefinition(request.viewId());
    ViewMailboxQueryRequest.FiltersOverride overrides = request.filtersOverride();

    boolean unreadOnly = view.unreadOnly() || (overrides != null && Boolean.TRUE.equals(overrides.unreadOnly()));

    MailboxQueryRequest.Scope scope = "SELECTED".equals(view.scopeType())
      ? new MailboxQueryRequest.Scope(view.selectedAccountIds())
      : new MailboxQueryRequest.Scope(List.of());

    MailboxQueryRequest.Filters filters = new MailboxQueryRequest.Filters(
      unreadOnly,
      overrides != null && Boolean.TRUE.equals(overrides.needsReply()),
      overrides != null && Boolean.TRUE.equals(overrides.overdue()),
      overrides != null && Boolean.TRUE.equals(overrides.dueToday()),
      overrides != null && Boolean.TRUE.equals(overrides.snoozed()),
      overrides != null && Boolean.TRUE.equals(overrides.allOpen()),
      view.senderDomains(),
      view.senderEmails(),
      view.keywords()
    );

    MailboxQueryRequest mailboxQueryRequest = new MailboxQueryRequest(
      scope,
      request.q(),
      filters,
      request.sort(),
      request.mode(),
      request.pageSize(),
      request.cursor()
    );

    return mailboxQueryService.query(mailboxQueryRequest);
  }
}
