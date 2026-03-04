package com.mailpilot.service.gmail;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.time.Duration;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ThreadLocalRandom;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

@Service
public class GmailClient {

  private static final String GMAIL_BASE_URL = "https://gmail.googleapis.com/gmail/v1/users/me";
  private static final String LIST_MESSAGES_URL = GMAIL_BASE_URL + "/messages";
  private static final String MESSAGE_URL = GMAIL_BASE_URL + "/messages/{messageId}";
  private static final String PROFILE_URL = GMAIL_BASE_URL + "/profile";
  private static final String HISTORY_URL = GMAIL_BASE_URL + "/history";

  private static final int MAX_RETRY_ATTEMPTS = 5;
  private static final long BASE_BACKOFF_MS = 300L;

  private final RestTemplate restTemplate;
  private final ObjectMapper objectMapper;

  public GmailClient(RestTemplateBuilder restTemplateBuilder, ObjectMapper objectMapper) {
    this.restTemplate = restTemplateBuilder
      .setConnectTimeout(Duration.ofSeconds(10))
      .setReadTimeout(Duration.ofSeconds(30))
      .build();
    this.objectMapper = objectMapper;
  }

  public MessageListResponse listMessages(
    String accessToken,
    int maxResults,
    String pageToken,
    String query
  ) {
    URI uri = UriComponentsBuilder
      .fromUriString(LIST_MESSAGES_URL)
      .queryParam("maxResults", maxResults)
      .queryParamIfPresent("pageToken", nullable(pageToken))
      .queryParamIfPresent("q", nullable(query))
      .build(true)
      .toUri();

    return executeWithRetry(
      "listMessages",
      uri,
      accessToken,
      MessageListResponse.class,
      ErrorSemantics.DEFAULT
    );
  }

  public GmailMessageResponse getMessage(String accessToken, String messageId) {
    URI uri = UriComponentsBuilder
      .fromUriString(MESSAGE_URL)
      .queryParam("format", "metadata")
      .queryParam("metadataHeaders", "From")
      .queryParam("metadataHeaders", "Subject")
      .queryParam("metadataHeaders", "Date")
      .queryParam("metadataHeaders", "Message-ID")
      .buildAndExpand(messageId)
      .encode()
      .toUri();

    return executeWithRetry(
      "getMessage",
      uri,
      accessToken,
      GmailMessageResponse.class,
      ErrorSemantics.MESSAGE_FETCH
    );
  }

  public GmailProfileResponse getProfile(String accessToken) {
    URI uri = UriComponentsBuilder.fromUriString(PROFILE_URL).build(true).toUri();
    return executeWithRetry(
      "getProfile",
      uri,
      accessToken,
      GmailProfileResponse.class,
      ErrorSemantics.DEFAULT
    );
  }

  public HistoryListResponse historyList(String accessToken, String startHistoryId, String pageToken) {
    URI uri = UriComponentsBuilder
      .fromUriString(HISTORY_URL)
      .queryParam("startHistoryId", startHistoryId)
      .queryParam("maxResults", 500)
      .queryParamIfPresent("pageToken", nullable(pageToken))
      .queryParam("historyTypes", "messageAdded")
      .queryParam("historyTypes", "messageDeleted")
      .queryParam("historyTypes", "labelAdded")
      .queryParam("historyTypes", "labelRemoved")
      .build(true)
      .toUri();

    return executeWithRetry(
      "historyList",
      uri,
      accessToken,
      HistoryListResponse.class,
      ErrorSemantics.HISTORY_LIST
    );
  }

  private <T> T executeWithRetry(
    String operation,
    URI uri,
    String accessToken,
    Class<T> responseType,
    ErrorSemantics semantics
  ) {
    HttpEntity<Void> requestEntity = new HttpEntity<>(authHeaders(accessToken));

    for (int attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        ResponseEntity<T> response = restTemplate.exchange(
          uri,
          HttpMethod.GET,
          requestEntity,
          responseType
        );
        T body = response.getBody();
        if (body == null) {
          throw new GmailApiException(operation + " returned an empty response body.");
        }
        return body;
      } catch (HttpStatusCodeException exception) {
        int status = exception.getStatusCode().value();

        if (status == 401) {
          throw new GmailUnauthorizedException("Google API returned 401 Unauthorized.");
        }

        if (status == 404 && semantics == ErrorSemantics.MESSAGE_FETCH) {
          throw new GmailMessageNotFoundException("Gmail message not found.");
        }

        if ((status == 404 || status == 400) && semantics == ErrorSemantics.HISTORY_LIST) {
          String errorBody = normalize(exception.getResponseBodyAsString());
          if (
            errorBody.contains("starthistoryid") ||
            (errorBody.contains("history") && errorBody.contains("too old")) ||
            errorBody.contains("historyid") && errorBody.contains("invalid")
          ) {
            throw new GmailHistoryExpiredException(
              "Gmail history cursor expired. Falling back to bootstrap sync."
            );
          }
        }

        if ((status == 429 || status >= 500) && attempt < MAX_RETRY_ATTEMPTS - 1) {
          sleepBackoff(attempt);
          continue;
        }

        throw new GmailApiException(operation + " failed: " + bestErrorMessage(exception));
      } catch (ResourceAccessException exception) {
        if (attempt < MAX_RETRY_ATTEMPTS - 1) {
          sleepBackoff(attempt);
          continue;
        }
        throw new GmailApiException(operation + " failed due to network timeout.");
      }
    }

    throw new GmailApiException(operation + " failed after retries.");
  }

  private HttpHeaders authHeaders(String accessToken) {
    HttpHeaders headers = new HttpHeaders();
    headers.setBearerAuth(accessToken);
    return headers;
  }

  private java.util.Optional<String> nullable(String value) {
    return StringUtils.hasText(value) ? java.util.Optional.of(value) : java.util.Optional.empty();
  }

  private void sleepBackoff(int attempt) {
    long jitter = ThreadLocalRandom.current().nextLong(75L, 175L);
    long delayMs = (long) (BASE_BACKOFF_MS * Math.pow(2, attempt) + jitter);
    try {
      Thread.sleep(delayMs);
    } catch (InterruptedException exception) {
      Thread.currentThread().interrupt();
      throw new GmailApiException("Interrupted during Gmail API retry backoff.");
    }
  }

  private String bestErrorMessage(HttpStatusCodeException exception) {
    String body = exception.getResponseBodyAsString();
    if (!StringUtils.hasText(body)) {
      return "HTTP " + exception.getStatusCode().value();
    }

    try {
      GoogleErrorEnvelope envelope = objectMapper.readValue(body, GoogleErrorEnvelope.class);
      if (envelope.error() != null && StringUtils.hasText(envelope.error().message())) {
        return envelope.error().message();
      }
    } catch (Exception ignored) {}

    return body;
  }

  private String normalize(String value) {
    if (!StringUtils.hasText(value)) {
      return "";
    }
    return value.toLowerCase(Locale.ROOT);
  }

  private enum ErrorSemantics {
    DEFAULT,
    MESSAGE_FETCH,
    HISTORY_LIST,
  }

  @JsonIgnoreProperties(ignoreUnknown = true)
  private record GoogleErrorEnvelope(@JsonProperty("error") GoogleError error) {}

  @JsonIgnoreProperties(ignoreUnknown = true)
  private record GoogleError(@JsonProperty("message") String message) {}

  @JsonIgnoreProperties(ignoreUnknown = true)
  public record MessageListResponse(
    @JsonProperty("messages") List<MessageRef> messages,
    @JsonProperty("nextPageToken") String nextPageToken,
    @JsonProperty("resultSizeEstimate") Long resultSizeEstimate
  ) {}

  @JsonIgnoreProperties(ignoreUnknown = true)
  public record MessageRef(@JsonProperty("id") String id, @JsonProperty("threadId") String threadId) {}

  @JsonIgnoreProperties(ignoreUnknown = true)
  public record GmailMessageResponse(
    @JsonProperty("id") String id,
    @JsonProperty("threadId") String threadId,
    @JsonProperty("labelIds") List<String> labelIds,
    @JsonProperty("snippet") String snippet,
    @JsonProperty("historyId") String historyId,
    @JsonProperty("internalDate") String internalDate,
    @JsonProperty("payload") GmailPayload payload
  ) {}

  @JsonIgnoreProperties(ignoreUnknown = true)
  public record GmailPayload(
    @JsonProperty("partId") String partId,
    @JsonProperty("mimeType") String mimeType,
    @JsonProperty("filename") String filename,
    @JsonProperty("headers") List<GmailHeader> headers,
    @JsonProperty("body") GmailBody body,
    @JsonProperty("parts") List<GmailPayload> parts
  ) {}

  @JsonIgnoreProperties(ignoreUnknown = true)
  public record GmailHeader(@JsonProperty("name") String name, @JsonProperty("value") String value) {}

  @JsonIgnoreProperties(ignoreUnknown = true)
  public record GmailBody(
    @JsonProperty("size") Long size,
    @JsonProperty("data") String data,
    @JsonProperty("attachmentId") String attachmentId
  ) {}

  @JsonIgnoreProperties(ignoreUnknown = true)
  public record GmailProfileResponse(
    @JsonProperty("emailAddress") String emailAddress,
    @JsonProperty("historyId") String historyId
  ) {}

  @JsonIgnoreProperties(ignoreUnknown = true)
  public record HistoryListResponse(
    @JsonProperty("history") List<HistoryRecord> history,
    @JsonProperty("nextPageToken") String nextPageToken,
    @JsonProperty("historyId") String historyId
  ) {}

  @JsonIgnoreProperties(ignoreUnknown = true)
  public record HistoryRecord(
    @JsonProperty("id") String id,
    @JsonProperty("messages") List<MessageRef> messages,
    @JsonProperty("messagesAdded") List<HistoryMessageContainer> messagesAdded,
    @JsonProperty("messagesDeleted") List<HistoryMessageContainer> messagesDeleted,
    @JsonProperty("labelsAdded") List<HistoryMessageContainer> labelsAdded,
    @JsonProperty("labelsRemoved") List<HistoryMessageContainer> labelsRemoved
  ) {}

  @JsonIgnoreProperties(ignoreUnknown = true)
  public record HistoryMessageContainer(@JsonProperty("message") MessageRef message) {}

  public static class GmailApiException extends RuntimeException {

    public GmailApiException(String message) {
      super(message);
    }
  }

  public static class GmailUnauthorizedException extends GmailApiException {

    public GmailUnauthorizedException(String message) {
      super(message);
    }
  }

  public static class GmailMessageNotFoundException extends GmailApiException {

    public GmailMessageNotFoundException(String message) {
      super(message);
    }
  }

  public static class GmailHistoryExpiredException extends GmailApiException {

    public GmailHistoryExpiredException(String message) {
      super(message);
    }
  }
}
