package com.mailpilot.api.error;

import com.mailpilot.api.errors.ConflictException;

public class ApiConflictException extends ConflictException {

  public ApiConflictException(String message) {
    super(message);
  }
}
