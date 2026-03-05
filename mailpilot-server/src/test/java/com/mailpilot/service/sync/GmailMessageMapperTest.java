package com.mailpilot.service.sync;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.mailpilot.service.gmail.GmailClient.GmailHeader;
import com.mailpilot.service.gmail.GmailClient.GmailMessageResponse;
import com.mailpilot.service.gmail.GmailClient.GmailPayload;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

class GmailMessageMapperTest {

  private final GmailMessageMapper mapper = new GmailMessageMapper();

  @Test
  void computeFlagsMarksInboxMessagesCorrectly() {
    GmailMessageMapper.Flags flags = mapper.computeFlags(List.of("INBOX"));
    assertTrue(flags.isInbox());
    assertFalse(flags.isSent());
    assertFalse(flags.isDraft());
  }

  @Test
  void computeFlagsMarksSentMessagesCorrectly() {
    GmailMessageMapper.Flags flags = mapper.computeFlags(List.of("SENT"));
    assertTrue(flags.isSent());
    assertFalse(flags.isInbox());
    assertFalse(flags.isDraft());
  }

  @Test
  void computeFlagsMarksDraftMessagesCorrectly() {
    GmailMessageMapper.Flags flags = mapper.computeFlags(List.of("DRAFT"));
    assertTrue(flags.isDraft());
    assertFalse(flags.isInbox());
    assertFalse(flags.isSent());
  }

  @Test
  void computeFlagsMarksUnreadMessagesAsNotRead() {
    GmailMessageMapper.Flags flags = mapper.computeFlags(List.of("INBOX", "UNREAD"));
    assertFalse(flags.isRead());
    assertTrue(flags.isInbox());
  }

  @Test
  void mapCoreFieldsUsesInternalDateMilliseconds() {
    long internalDateMs = 1700000000000L;
    GmailPayload payload = new GmailPayload(
      null,
      "text/plain",
      null,
      List.of(
        new GmailHeader("From", "Alice Example <alice@example.com>"),
        new GmailHeader("Subject", "Hello")
      ),
      null,
      List.of()
    );
    GmailMessageResponse message = new GmailMessageResponse(
      "msg-1",
      "thread-1",
      List.of("INBOX"),
      "snippet",
      "history-1",
      String.valueOf(internalDateMs),
      payload
    );

    GmailMessageMapper.GmailMetadata metadata = mapper.mapCoreFields(message);
    assertEquals(internalDateMs, metadata.gmailInternalDateMs());
    assertEquals(Instant.ofEpochMilli(internalDateMs), metadata.receivedAt().toInstant());
    assertNotEquals(Instant.ofEpochSecond(internalDateMs), metadata.receivedAt().toInstant());
  }
}
