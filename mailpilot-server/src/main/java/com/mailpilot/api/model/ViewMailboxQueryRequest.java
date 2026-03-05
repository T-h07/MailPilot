package com.mailpilot.api.model;

import java.util.UUID;

public record ViewMailboxQueryRequest(
  UUID viewId,
  String q,
  FiltersOverride filtersOverride,
  String sort,
  Integer pageSize,
  String cursor
) {

  public record FiltersOverride(
    Boolean unreadOnly,
    Boolean needsReply,
    Boolean overdue,
    Boolean dueToday,
    Boolean snoozed,
    Boolean allOpen
  ) {}
}
