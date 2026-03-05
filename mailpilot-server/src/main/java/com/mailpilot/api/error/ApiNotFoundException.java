package com.mailpilot.api.error;

public class ApiNotFoundException extends RuntimeException {

  public ApiNotFoundException(String message) {
    super(message);
  }
}
