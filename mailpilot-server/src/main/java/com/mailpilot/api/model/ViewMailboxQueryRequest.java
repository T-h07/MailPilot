package com.mailpilot.api.model;

import java.util.UUID;

public record ViewMailboxQueryRequest(
  UUID viewId,
  String q,
  FiltersOverride filtersOverride,
  Integer pageSize,
  String cursor
) {

  public record FiltersOverride(
    Boolean unreadOnly,
    Boolean needsReply,
    Boolean overdue,
    Boolean dueToday,
    Boolean snoozed
  ) {}
}
