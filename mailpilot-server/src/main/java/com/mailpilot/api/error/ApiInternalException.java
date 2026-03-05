package com.mailpilot.api.error;

public class ApiInternalException extends RuntimeException {

  public ApiInternalException(String message) {
    super(message);
  }
}
