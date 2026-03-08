package com.mailpilot.api.errors;

import com.mailpilot.api.error.ApiBadRequestException;
import com.mailpilot.api.error.ApiConflictException;
import com.mailpilot.api.error.ApiInternalException;
import com.mailpilot.api.error.ApiNotFoundException;
import com.mailpilot.service.gmail.GmailClient;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.ConstraintViolationException;
import java.util.Locale;
import java.util.NoSuchElementException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.async.AsyncRequestNotUsableException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@RestControllerAdvice
public class GlobalExceptionHandler {

  private static final Logger LOGGER = LoggerFactory.getLogger(GlobalExceptionHandler.class);

  @ExceptionHandler({BadRequestException.class, ApiBadRequestException.class})
  public ResponseEntity<ApiErrorResponse> handleBadRequest(
      RuntimeException exception, HttpServletRequest request) {
    return error(HttpStatus.BAD_REQUEST, "BAD_REQUEST", exception.getMessage(), request);
  }

  @ExceptionHandler({
    NotFoundException.class,
    ApiNotFoundException.class,
    NoSuchElementException.class
  })
  public ResponseEntity<ApiErrorResponse> handleNotFound(
      RuntimeException exception, HttpServletRequest request) {
    return error(HttpStatus.NOT_FOUND, "NOT_FOUND", exception.getMessage(), request);
  }

  @ExceptionHandler({ConflictException.class, ApiConflictException.class})
  public ResponseEntity<ApiErrorResponse> handleConflict(
      RuntimeException exception, HttpServletRequest request) {
    return error(HttpStatus.CONFLICT, "CONFLICT", exception.getMessage(), request);
  }

  @ExceptionHandler(UnauthorizedException.class)
  public ResponseEntity<ApiErrorResponse> handleUnauthorized(
      UnauthorizedException exception, HttpServletRequest request) {
    return error(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", exception.getMessage(), request);
  }

  @ExceptionHandler(RateLimitException.class)
  public ResponseEntity<ApiErrorResponse> handleRateLimit(
      RateLimitException exception, HttpServletRequest request) {
    return error(HttpStatus.TOO_MANY_REQUESTS, "RATE_LIMITED", exception.getMessage(), request);
  }

  @ExceptionHandler({UpstreamException.class, GmailClient.GmailApiException.class})
  public ResponseEntity<ApiErrorResponse> handleUpstream(
      RuntimeException exception, HttpServletRequest request) {
    return error(HttpStatus.BAD_GATEWAY, "UPSTREAM_ERROR", exception.getMessage(), request);
  }

  @ExceptionHandler(ApiInternalException.class)
  public ResponseEntity<ApiErrorResponse> handleInternal(
      ApiInternalException exception, HttpServletRequest request) {
    LOGGER.error("Internal API error", exception);
    return error(
        HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", exception.getMessage(), request);
  }

  @ExceptionHandler(DataAccessException.class)
  public ResponseEntity<ApiErrorResponse> handleDataAccess(
      DataAccessException exception, HttpServletRequest request) {
    LOGGER.error("Database API error", exception);
    String message = "Internal server error";
    String details =
        exception.getMostSpecificCause() == null
            ? exception.getMessage()
            : exception.getMostSpecificCause().getMessage();
    String normalized = details == null ? "" : details.toLowerCase(Locale.ROOT);
    if (normalized.contains("view_labels") || normalized.contains("message_view_labels")) {
      message =
          "View labels storage is unavailable. Restart the backend so latest migrations can run.";
    }
    return error(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", message, request);
  }

  @ExceptionHandler(MethodArgumentNotValidException.class)
  public ResponseEntity<ApiErrorResponse> handleValidation(
      MethodArgumentNotValidException exception, HttpServletRequest request) {
    String message = "Invalid request";
    FieldError firstFieldError = exception.getBindingResult().getFieldError();
    if (firstFieldError != null && firstFieldError.getDefaultMessage() != null) {
      message = firstFieldError.getDefaultMessage();
    }
    return error(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", message, request);
  }

  @ExceptionHandler(ConstraintViolationException.class)
  public ResponseEntity<ApiErrorResponse> handleConstraintViolation(
      ConstraintViolationException exception, HttpServletRequest request) {
    String message = "Invalid request input";
    ConstraintViolation<?> firstViolation =
        exception.getConstraintViolations().stream().findFirst().orElse(null);
    if (firstViolation != null && firstViolation.getMessage() != null) {
      message = firstViolation.getMessage();
    }
    return error(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", message, request);
  }

  @ExceptionHandler({
    MethodArgumentTypeMismatchException.class,
    HttpMessageNotReadableException.class,
    IllegalArgumentException.class
  })
  public ResponseEntity<ApiErrorResponse> handleInputErrors(
      Exception exception, HttpServletRequest request) {
    return error(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Invalid request input", request);
  }

  @ExceptionHandler(SecurityException.class)
  public ResponseEntity<ApiErrorResponse> handleSecurity(
      SecurityException exception, HttpServletRequest request) {
    return error(HttpStatus.FORBIDDEN, "FORBIDDEN", "Access denied", request);
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<ApiErrorResponse> handleUnhandled(
      Exception exception, HttpServletRequest request) {
    LOGGER.error("Unhandled API error", exception);
    return error(
        HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "Internal server error", request);
  }

  @ExceptionHandler(AsyncRequestNotUsableException.class)
  public void handleClientDisconnect(
      AsyncRequestNotUsableException exception, HttpServletRequest request) {
    LOGGER.debug("Client disconnected before response completed for {}", request.getRequestURI());
  }

  private ResponseEntity<ApiErrorResponse> error(
      HttpStatus status, String code, String message, HttpServletRequest request) {
    String safeMessage = message == null || message.isBlank() ? "Request failed" : message;
    ApiErrorResponse response = ApiErrorResponse.of(safeMessage, code, request.getRequestURI());
    return ResponseEntity.status(status).body(response);
  }
}
