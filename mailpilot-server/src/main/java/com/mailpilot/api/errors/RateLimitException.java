package com.mailpilot.api.errors;

public class RateLimitException extends RuntimeException {

  public RateLimitException(String message) {
    super(message);
  }
}
