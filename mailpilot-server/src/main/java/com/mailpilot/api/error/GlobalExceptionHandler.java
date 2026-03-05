package com.mailpilot.api.error;

import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@RestControllerAdvice
public class GlobalExceptionHandler {

  private static final Logger LOGGER = LoggerFactory.getLogger(GlobalExceptionHandler.class);

  @ExceptionHandler(ApiBadRequestException.class)
  public ResponseEntity<Map<String, String>> handleBadRequest(ApiBadRequestException exception) {
    return error(HttpStatus.BAD_REQUEST, exception.getMessage());
  }

  @ExceptionHandler(ApiNotFoundException.class)
  public ResponseEntity<Map<String, String>> handleNotFound(ApiNotFoundException exception) {
    return error(HttpStatus.NOT_FOUND, exception.getMessage());
  }

  @ExceptionHandler(ApiConflictException.class)
  public ResponseEntity<Map<String, String>> handleConflict(ApiConflictException exception) {
    return error(HttpStatus.CONFLICT, exception.getMessage());
  }

  @ExceptionHandler(ApiInternalException.class)
  public ResponseEntity<Map<String, String>> handleInternal(ApiInternalException exception) {
    LOGGER.error("Internal API error", exception);
    return error(HttpStatus.INTERNAL_SERVER_ERROR, exception.getMessage());
  }

  @ExceptionHandler(MethodArgumentNotValidException.class)
  public ResponseEntity<Map<String, String>> handleValidation(MethodArgumentNotValidException exception) {
    String message = "Invalid request";
    FieldError firstFieldError = exception.getBindingResult().getFieldError();
    if (firstFieldError != null && firstFieldError.getDefaultMessage() != null) {
      message = firstFieldError.getDefaultMessage();
    }
    return error(HttpStatus.BAD_REQUEST, message);
  }

  @ExceptionHandler({
    MethodArgumentTypeMismatchException.class,
    HttpMessageNotReadableException.class,
    IllegalArgumentException.class
  })
  public ResponseEntity<Map<String, String>> handleInputErrors(Exception exception) {
    return error(HttpStatus.BAD_REQUEST, "Invalid request input");
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<Map<String, String>> handleUnhandled(Exception exception) {
    LOGGER.error("Unhandled API error", exception);
    return error(HttpStatus.INTERNAL_SERVER_ERROR, "Internal server error");
  }

  private ResponseEntity<Map<String, String>> error(HttpStatus status, String message) {
    Map<String, String> body = new LinkedHashMap<>();
    body.put("status", "error");
    body.put("message", message);
    return ResponseEntity.status(status).body(body);
  }
}
