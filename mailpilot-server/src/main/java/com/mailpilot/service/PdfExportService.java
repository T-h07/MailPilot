package com.mailpilot.service;

import com.mailpilot.api.error.ApiNotFoundException;
import com.mailpilot.api.error.ApiInternalException;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDFont;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class PdfExportService {

  private static final Logger LOGGER = LoggerFactory.getLogger(PdfExportService.class);
  private static final DateTimeFormatter FILE_TIMESTAMP_FORMATTER = DateTimeFormatter
    .ofPattern("yyyyMMdd-HHmm")
    .withZone(ZoneOffset.UTC);
  private static final DateTimeFormatter HUMAN_TIMESTAMP_FORMATTER = DateTimeFormatter
    .ofPattern("yyyy-MM-dd HH:mm:ss 'UTC'")
    .withZone(ZoneOffset.UTC);
  private static final int MAX_FILENAME_LENGTH = 80;

  private final JdbcTemplate jdbcTemplate;

  public PdfExportService(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public PdfDocument exportMessage(UUID messageId) {
    try {
      MessageExportRow message = loadMessage(messageId);
      List<String> attachmentNames = loadAttachmentNames(message.id());

      List<String> lines = new ArrayList<>();
      lines.add("MailPilot - Email Export");
      lines.add(repeat("=", 64));
      lines.add("Subject: " + safeText(message.subject(), "No subject"));
      lines.add("From: " + formatSender(message.senderName(), message.senderEmail()));
      lines.add("Date: " + formatDate(message.receivedAt()));
      lines.add("Account: " + safeText(message.accountEmail(), "Unknown account"));
      lines.add("");
      lines.add("Body");
      lines.add(repeat("-", 64));
      appendBody(lines, message.bodyCache(), message.snippet());
      lines.add("");
      lines.add("Attachments");
      lines.add(repeat("-", 64));
      if (attachmentNames.isEmpty()) {
        lines.add("(none)");
      } else {
        for (String attachmentName : attachmentNames) {
          lines.add("- " + safeText(attachmentName, "unnamed-attachment"));
        }
      }

      byte[] pdfBytes = renderPdf(lines);
      if (pdfBytes.length == 0) {
        throw new ApiInternalException("Failed to generate message PDF.");
      }
      return new PdfDocument(buildFilename("mailpilot-message"), pdfBytes);
    } catch (ApiNotFoundException | ApiInternalException exception) {
      throw exception;
    } catch (RuntimeException exception) {
      LOGGER.error("Failed to export message PDF: {}", messageId, exception);
      throw new ApiInternalException("Failed to export message PDF.");
    }
  }

  public PdfDocument exportThread(UUID threadId) {
    try {
      ThreadExportRow thread = loadThread(threadId);
      List<MessageExportRow> threadMessages = loadThreadMessages(threadId);
      if (threadMessages.isEmpty()) {
        throw new ApiNotFoundException("No messages in thread");
      }

      List<String> lines = new ArrayList<>();
      lines.add("MailPilot - Thread Export");
      lines.add(repeat("=", 64));
      lines.add("Thread Subject: " + safeText(thread.subject(), "No subject"));
      lines.add("Account: " + safeText(thread.accountEmail(), "Unknown account"));
      lines.add("Exported At: " + HUMAN_TIMESTAMP_FORMATTER.format(OffsetDateTime.now(ZoneOffset.UTC)));
      lines.add("Message Count: " + threadMessages.size());
      lines.add("");

      String normalizedThreadSubject = normalizeSubject(thread.subject());
      for (int index = 0; index < threadMessages.size(); index += 1) {
        MessageExportRow message = threadMessages.get(index);
        lines.add("Message " + (index + 1));
        lines.add(repeat("-", 64));
        lines.add("From: " + formatSender(message.senderName(), message.senderEmail()));
        lines.add("Date: " + formatDate(message.receivedAt()));
        if (!normalizeSubject(message.subject()).equals(normalizedThreadSubject)) {
          lines.add("Subject: " + safeText(message.subject(), "No subject"));
        }
        lines.add("");
        appendBody(lines, message.bodyCache(), message.snippet());
        lines.add("");
        if (index < threadMessages.size() - 1) {
          lines.add(repeat("=", 64));
          lines.add("");
        }
      }

      byte[] pdfBytes = renderPdf(lines);
      if (pdfBytes.length == 0) {
        throw new ApiInternalException("Failed to generate thread PDF.");
      }
      return new PdfDocument(buildFilename("mailpilot-thread"), pdfBytes);
    } catch (ApiNotFoundException | ApiInternalException exception) {
      throw exception;
    } catch (RuntimeException exception) {
      LOGGER.error("Failed to export thread PDF: {}", threadId, exception);
      throw new ApiInternalException("Failed to export thread PDF.");
    }
  }

  private MessageExportRow loadMessage(UUID messageId) {
    return jdbcTemplate.query(
      """
      SELECT
        m.id,
        m.thread_id,
        COALESCE(NULLIF(a.email, ''), 'Unknown account') AS account_email,
        m.sender_name,
        m.sender_email,
        m.subject,
        COALESCE(m.snippet, '') AS snippet,
        m.body_cache,
        m.received_at
      FROM messages m
      JOIN accounts a ON a.id = m.account_id
      WHERE m.id = ?
      """,
      (resultSet, rowNum) ->
        new MessageExportRow(
          resultSet.getObject("id", UUID.class),
          resultSet.getObject("thread_id", UUID.class),
          resultSet.getString("account_email"),
          resultSet.getString("sender_name"),
          resultSet.getString("sender_email"),
          resultSet.getString("subject"),
          resultSet.getString("snippet"),
          resultSet.getString("body_cache"),
          resultSet.getObject("received_at", OffsetDateTime.class)
        ),
      messageId
    ).stream().findFirst().orElseThrow(() -> new ApiNotFoundException("Message not found"));
  }

  private ThreadExportRow loadThread(UUID threadId) {
    return jdbcTemplate.query(
      """
      SELECT
        t.id,
        t.subject,
        COALESCE(NULLIF(a.email, ''), 'Unknown account') AS account_email
      FROM threads t
      JOIN accounts a ON a.id = t.account_id
      WHERE t.id = ?
      """,
      (resultSet, rowNum) ->
        new ThreadExportRow(
          resultSet.getObject("id", UUID.class),
          resultSet.getString("subject"),
          resultSet.getString("account_email")
        ),
      threadId
    ).stream().findFirst().orElseThrow(() -> new ApiNotFoundException("Thread not found"));
  }

  private List<MessageExportRow> loadThreadMessages(UUID threadId) {
    return jdbcTemplate.query(
      """
      SELECT
        m.id,
        m.thread_id,
        COALESCE(NULLIF(a.email, ''), 'Unknown account') AS account_email,
        m.sender_name,
        m.sender_email,
        m.subject,
        COALESCE(m.snippet, '') AS snippet,
        m.body_cache,
        m.received_at
      FROM messages m
      JOIN accounts a ON a.id = m.account_id
      WHERE m.thread_id = ?
      ORDER BY m.received_at ASC, m.id ASC
      """,
      (resultSet, rowNum) ->
        new MessageExportRow(
          resultSet.getObject("id", UUID.class),
          resultSet.getObject("thread_id", UUID.class),
          resultSet.getString("account_email"),
          resultSet.getString("sender_name"),
          resultSet.getString("sender_email"),
          resultSet.getString("subject"),
          resultSet.getString("snippet"),
          resultSet.getString("body_cache"),
          resultSet.getObject("received_at", OffsetDateTime.class)
        ),
      threadId
    );
  }

  private List<String> loadAttachmentNames(UUID messageId) {
    return jdbcTemplate.query(
      """
      SELECT filename
      FROM attachments
      WHERE message_id = ?
      ORDER BY filename
      """,
      (resultSet, rowNum) -> resultSet.getString("filename"),
      messageId
    );
  }

  private byte[] renderPdf(List<String> lines) {
    if (lines.isEmpty()) {
      throw new ApiInternalException("Failed to generate PDF document.");
    }

    try (PDDocument document = new PDDocument(); ByteArrayOutputStream outputStream = new ByteArrayOutputStream()) {
      PdfTextWriter writer = new PdfTextWriter(document);
      for (String line : lines) {
        writer.writeParagraph(line, isHeading(line));
      }
      writer.finish();
      document.save(outputStream);
      return outputStream.toByteArray();
    } catch (IOException exception) {
      LOGGER.error("Failed to generate PDF export", exception);
      throw new ApiInternalException("Failed to generate PDF document.");
    }
  }

  private String formatSender(String senderName, String senderEmail) {
    String normalizedName = StringUtils.hasText(senderName) ? senderName.trim() : null;
    String normalizedEmail = StringUtils.hasText(senderEmail) ? senderEmail.trim() : null;

    if (normalizedName != null && normalizedEmail != null) {
      return normalizedName + " <" + normalizedEmail + ">";
    }
    if (normalizedEmail != null) {
      return normalizedEmail;
    }
    if (normalizedName != null) {
      return normalizedName;
    }
    return "Unknown sender";
  }

  private String formatDate(OffsetDateTime receivedAt) {
    if (receivedAt == null) {
      return "(unknown)";
    }
    return HUMAN_TIMESTAMP_FORMATTER.format(receivedAt.withOffsetSameInstant(ZoneOffset.UTC));
  }

  private String normalizeSubject(String subject) {
    if (!StringUtils.hasText(subject)) {
      return "";
    }
    return subject.trim().toLowerCase(Locale.ROOT);
  }

  private String buildFilename(String prefix) {
    String timestamp = FILE_TIMESTAMP_FORMATTER.format(OffsetDateTime.now(ZoneOffset.UTC));
    String safePrefix = sanitizeFilenameComponent(prefix, "mailpilot-export");
    String candidate = safePrefix + "-" + timestamp + ".pdf";
    if (candidate.length() > MAX_FILENAME_LENGTH) {
      String withoutExtension = candidate.substring(0, MAX_FILENAME_LENGTH - 4).replaceAll("[.\\s]+$", "");
      return withoutExtension + ".pdf";
    }
    return candidate;
  }

  private String sanitizeFilenameComponent(String value, String fallback) {
    if (!StringUtils.hasText(value)) {
      return fallback;
    }
    String sanitized = value
      .trim()
      .replaceAll("[\\\\/:*?\"<>|]", "-")
      .replaceAll("\\s+", "-")
      .replaceAll("[^a-zA-Z0-9._-]", "-")
      .replaceAll("-{2,}", "-")
      .replaceAll("(^[-.]+|[-.]+$)", "");
    if (sanitized.isBlank()) {
      return fallback;
    }
    return sanitized.length() > 40 ? sanitized.substring(0, 40) : sanitized;
  }

  private void appendBody(List<String> lines, String bodyCache, String snippet) {
    if (StringUtils.hasText(bodyCache)) {
      lines.add(bodyCache);
      return;
    }
    if (StringUtils.hasText(snippet)) {
      lines.add(snippet);
      lines.add("");
    }
    lines.add("(Body not cached)");
  }

  private String safeText(String value, String fallback) {
    if (!StringUtils.hasText(value)) {
      return fallback;
    }
    return value.trim();
  }

  private boolean isHeading(String line) {
    String normalized = line == null ? "" : line.trim();
    return normalized.startsWith("MailPilot -")
      || normalized.startsWith("Subject:")
      || normalized.startsWith("Thread Subject:")
      || normalized.equals("Body")
      || normalized.equals("Attachments")
      || normalized.startsWith("Message ");
  }

  private String repeat(String value, int count) {
    return value.repeat(Math.max(count, 0));
  }

  public record PdfDocument(String filename, byte[] bytes) {}

  private record ThreadExportRow(UUID id, String subject, String accountEmail) {}

  private record MessageExportRow(
    UUID id,
    UUID threadId,
    String accountEmail,
    String senderName,
    String senderEmail,
    String subject,
    String snippet,
    String bodyCache,
    OffsetDateTime receivedAt
  ) {}

  private static final class PdfTextWriter {

    private static final PDRectangle PAGE_SIZE = PDRectangle.LETTER;
    private static final float MARGIN = 48f;
    private static final float FONT_SIZE = 11f;
    private static final float LINE_HEIGHT = 14f;
    private static final PDFont BODY_FONT = PDType1Font.HELVETICA;
    private static final PDFont HEADING_FONT = PDType1Font.HELVETICA_BOLD;

    private final PDDocument document;
    private final float writableWidth;
    private PDPageContentStream contentStream;
    private float cursorY;

    private PdfTextWriter(PDDocument document) throws IOException {
      this.document = document;
      this.writableWidth = PAGE_SIZE.getWidth() - (MARGIN * 2);
      startNewPage();
    }

    private void writeParagraph(String text, boolean heading) throws IOException {
      String value = text == null ? "" : text;
      PDFont font = heading ? HEADING_FONT : BODY_FONT;
      String[] logicalLines = value.replace("\r", "").split("\n", -1);
      for (String logicalLine : logicalLines) {
        List<String> wrappedLines = wrapLine(sanitizeText(logicalLine), font);
        if (wrappedLines.isEmpty()) {
          writeLine("", font);
          continue;
        }
        for (String wrapped : wrappedLines) {
          writeLine(wrapped, font);
        }
      }
      writeLine("", BODY_FONT);
    }

    private void writeLine(String line, PDFont font) throws IOException {
      ensureCapacity();
      contentStream.beginText();
      contentStream.setFont(font, FONT_SIZE);
      contentStream.newLineAtOffset(MARGIN, cursorY);
      contentStream.showText(line);
      contentStream.endText();
      cursorY -= LINE_HEIGHT;
    }

    private List<String> wrapLine(String input, PDFont font) throws IOException {
      List<String> lines = new ArrayList<>();
      if (input.isEmpty()) {
        lines.add("");
        return lines;
      }

      StringBuilder currentLine = new StringBuilder();
      for (String word : input.split(" ")) {
        if (word.isEmpty()) {
          continue;
        }

        String candidate = currentLine.isEmpty() ? word : currentLine + " " + word;
        if (stringWidth(candidate, font) <= writableWidth) {
          currentLine.setLength(0);
          currentLine.append(candidate);
          continue;
        }

        if (!currentLine.isEmpty()) {
          lines.add(currentLine.toString());
          currentLine.setLength(0);
        }

        if (stringWidth(word, font) <= writableWidth) {
          currentLine.append(word);
          continue;
        }

        StringBuilder segment = new StringBuilder();
        for (int index = 0; index < word.length(); index += 1) {
          char nextChar = word.charAt(index);
          String segmentCandidate = segment + String.valueOf(nextChar);
          if (!segment.isEmpty() && stringWidth(segmentCandidate, font) > writableWidth) {
            lines.add(segment.toString());
            segment.setLength(0);
          }
          segment.append(nextChar);
        }
        currentLine.append(segment);
      }

      if (!currentLine.isEmpty()) {
        lines.add(currentLine.toString());
      }

      return lines;
    }

    private float stringWidth(String value, PDFont font) throws IOException {
      return (font.getStringWidth(value) / 1000f) * FONT_SIZE;
    }

    private String sanitizeText(String input) {
      if (input == null || input.isEmpty()) {
        return "";
      }

      StringBuilder builder = new StringBuilder(input.length());
      for (int index = 0; index < input.length(); index += 1) {
        char character = input.charAt(index);
        if (character == '\t') {
          builder.append("  ");
          continue;
        }
        if (character < 32 || character > 126) {
          builder.append('?');
          continue;
        }
        builder.append(character);
      }
      return builder.toString();
    }

    private void ensureCapacity() throws IOException {
      if (cursorY < MARGIN) {
        startNewPage();
      }
    }

    private void startNewPage() throws IOException {
      closeCurrentStream();
      PDPage page = new PDPage(PAGE_SIZE);
      document.addPage(page);
      contentStream = new PDPageContentStream(document, page);
      cursorY = PAGE_SIZE.getHeight() - MARGIN;
    }

    private void finish() throws IOException {
      closeCurrentStream();
    }

    private void closeCurrentStream() throws IOException {
      if (contentStream != null) {
        contentStream.close();
        contentStream = null;
      }
    }
  }
}
