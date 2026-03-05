package com.mailpilot.api.errors;

import java.time.Instant;

public record ApiErrorResponse(
  String status,
  String message,
  String code,
  String timestamp,
  String path
) {

  public static ApiErrorResponse of(String message, String code, String path) {
    return new ApiErrorResponse("error", message, code, Instant.now().toString(), path);
  }
}
