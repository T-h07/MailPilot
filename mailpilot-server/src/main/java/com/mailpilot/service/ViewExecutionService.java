package com.mailpilot.service;

import com.mailpilot.api.error.ApiBadRequestException;
import com.mailpilot.api.model.MailboxQueryRequest;
import com.mailpilot.api.model.MailboxQueryResponse;
import com.mailpilot.api.model.ViewMailboxQueryRequest;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class ViewExecutionService {

  private static final Logger LOGGER = LoggerFactory.getLogger(ViewExecutionService.class);

  private final ViewService viewService;
  private final MailboxQueryService mailboxQueryService;
  private final ViewLabelService viewLabelService;

  public ViewExecutionService(
      ViewService viewService,
      MailboxQueryService mailboxQueryService,
      ViewLabelService viewLabelService) {
    this.viewService = viewService;
    this.mailboxQueryService = mailboxQueryService;
    this.viewLabelService = viewLabelService;
  }

  public MailboxQueryResponse queryView(ViewMailboxQueryRequest request) {
    if (request == null || request.viewId() == null) {
      throw new ApiBadRequestException("viewId is required");
    }

    ViewService.ViewDefinition view = viewService.getViewDefinition(request.viewId());
    ViewMailboxQueryRequest.FiltersOverride overrides = request.filtersOverride();

    boolean unreadOnly =
        view.unreadOnly() || (overrides != null && Boolean.TRUE.equals(overrides.unreadOnly()));

    MailboxQueryRequest.Scope scope =
        "SELECTED".equals(view.scopeType())
            ? new MailboxQueryRequest.Scope(view.selectedAccountIds())
            : new MailboxQueryRequest.Scope(List.of());

    MailboxQueryRequest.Filters filters =
        new MailboxQueryRequest.Filters(
            unreadOnly,
            overrides != null && Boolean.TRUE.equals(overrides.needsReply()),
            overrides != null && Boolean.TRUE.equals(overrides.overdue()),
            overrides != null && Boolean.TRUE.equals(overrides.dueToday()),
            overrides != null && Boolean.TRUE.equals(overrides.snoozed()),
            overrides != null && Boolean.TRUE.equals(overrides.allOpen()),
            view.senderDomains(),
            view.senderEmails(),
            view.keywords(),
            overrides != null && overrides.labelNames() != null
                ? overrides.labelNames()
                : List.of());

    MailboxQueryRequest mailboxQueryRequest =
        new MailboxQueryRequest(
            scope,
            request.q(),
            filters,
            request.sort(),
            request.mode(),
            view.id(),
            request.pageSize(),
            request.cursor());

    MailboxQueryResponse baseResponse = mailboxQueryService.query(mailboxQueryRequest);
    if (baseResponse.items().isEmpty()) {
      return baseResponse;
    }

    List<UUID> messageIds =
        baseResponse.items().stream().map(MailboxQueryResponse.Item::id).toList();
    Map<UUID, List<MailboxQueryResponse.ViewLabel>> labelsByMessageId =
        viewLabelService.loadViewLabelsByMessageIds(view.id(), messageIds);

    if (LOGGER.isDebugEnabled()) {
      LOGGER.debug(
          "view_query_labels viewId={} messages={} labeledMessages={}",
          view.id(),
          messageIds.size(),
          labelsByMessageId.size());
    }

    List<MailboxQueryResponse.Item> itemsWithViewLabels =
        baseResponse.items().stream()
            .map(
                item ->
                    new MailboxQueryResponse.Item(
                        item.id(),
                        item.accountId(),
                        item.accountEmail(),
                        item.senderName(),
                        item.senderEmail(),
                        item.senderDomain(),
                        item.subject(),
                        item.snippet(),
                        item.receivedAt(),
                        item.isUnread(),
                        item.hasAttachments(),
                        item.chips(),
                        item.tags(),
                        item.highlight(),
                        labelsByMessageId.getOrDefault(item.id(), List.of())))
            .toList();

    return new MailboxQueryResponse(itemsWithViewLabels, baseResponse.nextCursor());
  }
}
