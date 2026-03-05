package com.mailpilot.api.errors;

public class ConflictException extends RuntimeException {

  public ConflictException(String message) {
    super(message);
  }
}
