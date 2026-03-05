package com.mailpilot.api.error;

public class ApiConflictException extends RuntimeException {

  public ApiConflictException(String message) {
    super(message);
  }
}
