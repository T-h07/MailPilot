package com.mailpilot.service.gmail;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.mailpilot.api.error.ApiBadRequestException;
import com.mailpilot.service.gmail.GmailClient.GmailBody;
import com.mailpilot.service.gmail.GmailClient.GmailHeader;
import com.mailpilot.service.gmail.GmailClient.GmailPayload;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import org.junit.jupiter.api.Test;

class GmailMimeParserTest {

  private final GmailMimeParser parser = new GmailMimeParser();

  @Test
  void extractPreferredBodyPrefersHtmlOverPlainText() {
    GmailPayload payload =
        new GmailPayload(
            null,
            "multipart/alternative",
            null,
            List.of(),
            null,
            List.of(
                new GmailPayload(
                    "0.1",
                    "text/plain",
                    null,
                    List.of(),
                    new GmailBody(5L, encode("plain"), null),
                    List.of()),
                new GmailPayload(
                    "0.2",
                    "text/html",
                    null,
                    List.of(),
                    new GmailBody(11L, encode("<b>html</b>"), null),
                    List.of())));

    GmailMimeParser.DecodedBody body = parser.extractPreferredBody(payload);

    assertEquals("text/html", body.mimeType());
    assertEquals("<b>html</b>", body.content());
  }

  @Test
  void extractPreferredBodyRejectsAttachmentOnlyMessages() {
    GmailPayload payload =
        new GmailPayload(
            "0",
            "text/plain",
            null,
            List.of(),
            new GmailBody(0L, null, "attachment-body"),
            List.of());

    ApiBadRequestException exception =
        assertThrows(ApiBadRequestException.class, () -> parser.extractPreferredBody(payload));

    assertTrue(exception.getMessage().contains("attachment-only"));
  }

  @Test
  void extractAttachmentsDiscoversNestedAttachmentMetadata() {
    GmailPayload attachmentPart =
        new GmailPayload(
            "2",
            "application/pdf",
            "report.pdf",
            List.of(new GmailHeader("Content-Disposition", "attachment")),
            new GmailBody(128L, null, "att-123"),
            List.of());
    GmailPayload inlinePart =
        new GmailPayload(
            "3",
            "image/png",
            "logo.png",
            List.of(
                new GmailHeader("Content-Disposition", "inline"),
                new GmailHeader("Content-Id", "<cid-logo>")),
            new GmailBody(64L, encode("inline-bytes"), null),
            List.of());
    GmailPayload payload =
        new GmailPayload(
            "0",
            "multipart/mixed",
            null,
            List.of(),
            null,
            List.of(
                new GmailPayload(
                    "1",
                    "text/plain",
                    null,
                    List.of(),
                    new GmailBody(4L, encode("hi"), null),
                    List.of()),
                attachmentPart,
                inlinePart));

    List<GmailMimeParser.GmailAttachmentPart> attachments = parser.extractAttachments(payload);

    assertEquals(2, attachments.size());
    GmailMimeParser.GmailAttachmentPart downloadable = attachments.getFirst();
    GmailMimeParser.GmailAttachmentPart inline = attachments.get(1);

    assertEquals("report.pdf", downloadable.filename());
    assertEquals("att-123", downloadable.providerAttachmentId());
    assertFalse(downloadable.isInline());

    assertEquals("logo.png", inline.filename());
    assertEquals("cid-logo", inline.contentId());
    assertTrue(inline.isInline());
    assertTrue(inline.hasEmbeddedData());
  }

  @Test
  void findInlineAttachmentPayloadMatchesContentId() {
    GmailPayload inlinePart =
        new GmailPayload(
            "2",
            "image/png",
            "logo.png",
            List.of(new GmailHeader("Content-Id", "<cid-logo>")),
            new GmailBody(64L, encode("image-data"), null),
            List.of());
    GmailPayload payload =
        new GmailPayload("0", "multipart/related", null, List.of(), null, List.of(inlinePart));

    GmailPayload match =
        parser.findInlineAttachmentPayload(
            payload,
            new GmailMimeParser.AttachmentLookup(null, "cid-logo", "logo.png", "image/png", 64L));

    assertNotNull(match);
    assertEquals("2", match.partId());
  }

  private String encode(String value) {
    return Base64.getUrlEncoder()
        .withoutPadding()
        .encodeToString(value.getBytes(StandardCharsets.UTF_8));
  }
}
