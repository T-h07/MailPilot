package com.mailpilot.api.model;

import java.util.Map;

public record BadgeSummaryResponse(int inbox, int viewsTotal, Map<String, Integer> views) {}
