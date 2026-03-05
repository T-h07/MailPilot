package com.mailpilot.api.error;

import com.mailpilot.api.errors.NotFoundException;

public class ApiNotFoundException extends NotFoundException {

  public ApiNotFoundException(String message) {
    super(message);
  }
}
