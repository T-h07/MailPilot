package com.mailpilot.api.model;

import java.util.List;

public record InsightsSummaryResponse(
  String range,
  int receivedCount,
  int uniqueSenders,
  List<DomainCount> topDomains,
  List<SenderCount> topSenders,
  Series series
) {

  public record DomainCount(String domain, int count) {}

  public record SenderCount(String email, int count) {}

  public record Series(List<VolumePoint> volumePerDay) {}

  public record VolumePoint(String date, int count) {}
}
