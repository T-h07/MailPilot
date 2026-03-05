package com.mailpilot.api.errors;

public class UpstreamException extends RuntimeException {

  public UpstreamException(String message) {
    super(message);
  }
}
