package com.mailpilot.api.error;

import com.mailpilot.api.errors.BadRequestException;

public class ApiBadRequestException extends BadRequestException {

  public ApiBadRequestException(String message) {
    super(message);
  }
}
