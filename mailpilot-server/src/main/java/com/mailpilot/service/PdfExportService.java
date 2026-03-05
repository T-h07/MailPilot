package com.mailpilot.service;

import com.mailpilot.api.error.ApiBadRequestException;
import com.mailpilot.api.error.ApiInternalException;
import com.mailpilot.api.error.ApiNotFoundException;
import com.mailpilot.service.logging.LogSanitizer;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Attribute;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.nodes.TextNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class PdfExportService {

  private static final Logger LOGGER = LoggerFactory.getLogger(PdfExportService.class);
  private static final String GMAIL_PROVIDER = "GMAIL";
  private static final String PDF_BASE_URI = "https://mail.google.com/";
  private static final Set<String> URI_ATTRIBUTES = Set.of(
    "src",
    "href",
    "action",
    "poster",
    "xlink:href"
  );
  private static final DateTimeFormatter FILE_TIMESTAMP_FORMATTER = DateTimeFormatter
    .ofPattern("yyyyMMdd-HHmm")
    .withZone(ZoneOffset.UTC);
  private static final DateTimeFormatter HUMAN_TIMESTAMP_FORMATTER = DateTimeFormatter
    .ofPattern("yyyy-MM-dd HH:mm:ss 'UTC'")
    .withZone(ZoneOffset.UTC);
  private static final int MAX_FILENAME_LENGTH = 80;

  private final JdbcTemplate jdbcTemplate;
  private final MessageService messageService;
  private final HtmlPdfRenderer htmlPdfRenderer;

  public PdfExportService(
    JdbcTemplate jdbcTemplate,
    MessageService messageService,
    HtmlPdfRenderer htmlPdfRenderer
  ) {
    this.jdbcTemplate = jdbcTemplate;
    this.messageService = messageService;
    this.htmlPdfRenderer = htmlPdfRenderer;
  }

  public PdfDocument exportMessage(UUID messageId) {
    try {
      MessageExportRow message = ensureBodyCached(loadMessage(messageId));
      List<String> attachmentNames = loadAttachmentNames(message.id());
      String html = buildMessageHtml(message, attachmentNames);
      byte[] pdfBytes = htmlPdfRenderer.render(html, PDF_BASE_URI);
      if (pdfBytes.length == 0) {
        throw new ApiInternalException("Failed to render PDF export.");
      }
      return new PdfDocument(buildFilename("mailpilot-message"), pdfBytes);
    } catch (ApiNotFoundException | ApiInternalException exception) {
      throw exception;
    } catch (ApiBadRequestException exception) {
      throw new ApiInternalException("Unable to fetch full body for export. Try Open in Gmail.");
    } catch (RuntimeException exception) {
      LOGGER.error(
        "Failed to export message PDF for messageId={} reason={}",
        messageId,
        LogSanitizer.sanitize(exception.getMessage())
      );
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

      List<MessageExportRow> hydratedMessages = new ArrayList<>(threadMessages.size());
      for (MessageExportRow message : threadMessages) {
        hydratedMessages.add(ensureBodyCached(message));
      }

      String html = buildThreadHtml(thread, hydratedMessages);
      byte[] pdfBytes = htmlPdfRenderer.render(html, PDF_BASE_URI);
      if (pdfBytes.length == 0) {
        throw new ApiInternalException("Failed to render PDF export.");
      }
      return new PdfDocument(buildFilename("mailpilot-thread"), pdfBytes);
    } catch (ApiNotFoundException | ApiInternalException exception) {
      throw exception;
    } catch (ApiBadRequestException exception) {
      throw new ApiInternalException("Unable to fetch full body for export. Try Open in Gmail.");
    } catch (RuntimeException exception) {
      LOGGER.error(
        "Failed to export thread PDF for threadId={} reason={}",
        threadId,
        LogSanitizer.sanitize(exception.getMessage())
      );
      throw new ApiInternalException("Failed to export thread PDF.");
    }
  }

  private MessageExportRow ensureBodyCached(MessageExportRow message) {
    MessageService.BodyCacheSnapshot cachedBody;
    try {
      cachedBody = messageService.ensureBodyCached(message.id());
    } catch (ApiBadRequestException exception) {
      throw new ApiBadRequestException("Unable to fetch full body for export. Try Open in Gmail.");
    } catch (RuntimeException exception) {
      if (GMAIL_PROVIDER.equalsIgnoreCase(message.accountProvider())) {
        throw new ApiBadRequestException("Unable to fetch full body for export. Try Open in Gmail.");
      }
      throw exception;
    }

    MessageExportRow hydrated = message.withBody(cachedBody.bodyCache(), cachedBody.bodyCacheMime());

    if (GMAIL_PROVIDER.equalsIgnoreCase(message.accountProvider()) && !StringUtils.hasText(hydrated.bodyCache())) {
      throw new ApiBadRequestException("Unable to fetch full body for export. Try Open in Gmail.");
    }
    return hydrated;
  }

  private MessageExportRow loadMessage(UUID messageId) {
    return jdbcTemplate.query(
      """
      SELECT
        m.id,
        m.thread_id,
        COALESCE(NULLIF(a.email, ''), 'Unknown account') AS account_email,
        COALESCE(NULLIF(a.provider, ''), '') AS account_provider,
        m.sender_name,
        m.sender_email,
        m.subject,
        COALESCE(m.snippet, '') AS snippet,
        m.body_cache,
        m.body_cache_mime,
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
          resultSet.getString("account_provider"),
          resultSet.getString("sender_name"),
          resultSet.getString("sender_email"),
          resultSet.getString("subject"),
          resultSet.getString("snippet"),
          resultSet.getString("body_cache"),
          resultSet.getString("body_cache_mime"),
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
        COALESCE(NULLIF(a.provider, ''), '') AS account_provider,
        m.sender_name,
        m.sender_email,
        m.subject,
        COALESCE(m.snippet, '') AS snippet,
        m.body_cache,
        m.body_cache_mime,
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
          resultSet.getString("account_provider"),
          resultSet.getString("sender_name"),
          resultSet.getString("sender_email"),
          resultSet.getString("subject"),
          resultSet.getString("snippet"),
          resultSet.getString("body_cache"),
          resultSet.getString("body_cache_mime"),
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

  private String buildMessageHtml(MessageExportRow message, List<String> attachmentNames) {
    StringBuilder content = new StringBuilder();
    content.append("<article class=\"message-section\">");
    content.append("<h1>").append(escapeHtml(safeText(message.subject(), "No subject"))).append("</h1>");
    content.append("<div class=\"meta\">");
    content.append("<p><strong>From:</strong> ").append(escapeHtml(formatSender(message.senderName(), message.senderEmail()))).append("</p>");
    content.append("<p><strong>Date:</strong> ").append(escapeHtml(formatDate(message.receivedAt()))).append("</p>");
    content.append("<p><strong>Account:</strong> ").append(escapeHtml(safeText(message.accountEmail(), "Unknown account"))).append("</p>");
    content.append("</div>");
    content.append("<section class=\"body\">").append(renderBodyHtml(message)).append("</section>");

    if (!attachmentNames.isEmpty()) {
      content.append("<section class=\"attachments\"><h2>Attachments</h2><ul>");
      for (String attachmentName : attachmentNames) {
        content.append("<li>").append(escapeHtml(safeText(attachmentName, "unnamed-attachment"))).append("</li>");
      }
      content.append("</ul></section>");
    }

    content.append("</article>");
    return wrapHtmlDocument("MailPilot Message Export", content.toString());
  }

  private String buildThreadHtml(ThreadExportRow thread, List<MessageExportRow> messages) {
    StringBuilder content = new StringBuilder();
    content.append("<article class=\"thread-header\">");
    content.append("<h1>").append(escapeHtml(safeText(thread.subject(), "No subject"))).append("</h1>");
    content.append("<p><strong>Account:</strong> ").append(escapeHtml(safeText(thread.accountEmail(), "Unknown account"))).append("</p>");
    content.append("<p><strong>Exported At:</strong> ").append(escapeHtml(HUMAN_TIMESTAMP_FORMATTER.format(OffsetDateTime.now(ZoneOffset.UTC)))).append("</p>");
    content.append("</article>");

    for (int index = 0; index < messages.size(); index += 1) {
      MessageExportRow message = messages.get(index);
      content.append("<article class=\"message-section\">");
      content.append("<h2>Message ").append(index + 1).append("</h2>");
      content.append("<div class=\"meta\">");
      content.append("<p><strong>From:</strong> ").append(escapeHtml(formatSender(message.senderName(), message.senderEmail()))).append("</p>");
      content.append("<p><strong>Date:</strong> ").append(escapeHtml(formatDate(message.receivedAt()))).append("</p>");
      content.append("<p><strong>Subject:</strong> ").append(escapeHtml(safeText(message.subject(), "No subject"))).append("</p>");
      content.append("</div>");
      content.append("<section class=\"body\">").append(renderBodyHtml(message)).append("</section>");
      content.append("</article>");
      if (index < messages.size() - 1) {
        content.append("<hr />");
      }
    }

    return wrapHtmlDocument("MailPilot Thread Export", content.toString());
  }

  private String renderBodyHtml(MessageExportRow message) {
    if (isHtmlMime(message.bodyCacheMime()) && StringUtils.hasText(message.bodyCache())) {
      return "<div class=\"html-body\">" + sanitizeHtmlForPdf(message.bodyCache()) + "</div>";
    }

    String plainText = StringUtils.hasText(message.bodyCache()) ? message.bodyCache() : message.snippet();
    if (!StringUtils.hasText(plainText)) {
      plainText = "(Body not available)";
    }
    return "<pre class=\"plain-body\">" + escapeHtml(plainText) + "</pre>";
  }

  private String sanitizeHtmlForPdf(String html) {
    Document document = Jsoup.parse(html == null ? "" : html, PDF_BASE_URI);
    document.outputSettings().prettyPrint(false);
    document.select("script,iframe,object,embed,noscript").remove();

    for (Element element : document.getAllElements()) {
      List<String> removeAttributes = new ArrayList<>();
      for (Attribute attribute : element.attributes()) {
        String attributeName = attribute.getKey();
        String normalizedName = attributeName.toLowerCase(Locale.ROOT);
        String value = attribute.getValue() == null ? "" : attribute.getValue().trim();

        if (normalizedName.startsWith("on")) {
          removeAttributes.add(attributeName);
          continue;
        }

        if ("srcset".equals(normalizedName)) {
          removeAttributes.add(attributeName);
          continue;
        }

        if (URI_ATTRIBUTES.contains(normalizedName) && !isAllowedUri(element.tagName(), normalizedName, value)) {
          removeAttributes.add(attributeName);
        }
      }

      for (String attributeName : removeAttributes) {
        element.removeAttr(attributeName);
      }
    }

    for (Element image : document.select("img")) {
      if (isTrackingPixel(image)) {
        image.remove();
      }
    }

    return document.body().html();
  }

  private boolean isAllowedUri(String tagName, String attributeName, String uri) {
    if (!StringUtils.hasText(uri)) {
      return true;
    }

    String normalizedUri = uri.trim().toLowerCase(Locale.ROOT);
    if (normalizedUri.startsWith("javascript:") || normalizedUri.startsWith("data:") || normalizedUri.startsWith("vbscript:")) {
      return false;
    }

    if ("img".equals(tagName) && "src".equals(attributeName)) {
      return normalizedUri.startsWith("https://");
    }

    if (normalizedUri.startsWith("https://") || normalizedUri.startsWith("http://") || normalizedUri.startsWith("mailto:")) {
      return true;
    }

    if (normalizedUri.startsWith("#")) {
      return true;
    }

    return !normalizedUri.contains(":");
  }

  private boolean isTrackingPixel(Element image) {
    Integer width = parseDimension(image.attr("width"));
    Integer height = parseDimension(image.attr("height"));
    if (width != null && height != null && width <= 1 && height <= 1) {
      return true;
    }

    String style = image.attr("style");
    if (!StringUtils.hasText(style)) {
      return false;
    }

    String normalizedStyle = style.toLowerCase(Locale.ROOT).replace(" ", "");
    return normalizedStyle.contains("width:1px") && normalizedStyle.contains("height:1px");
  }

  private Integer parseDimension(String rawValue) {
    if (!StringUtils.hasText(rawValue)) {
      return null;
    }

    String trimmed = rawValue.trim().toLowerCase(Locale.ROOT);
    StringBuilder digits = new StringBuilder();
    for (int index = 0; index < trimmed.length(); index += 1) {
      char character = trimmed.charAt(index);
      if (Character.isDigit(character)) {
        digits.append(character);
      } else if (digits.length() > 0) {
        break;
      }
    }

    if (digits.length() == 0) {
      return null;
    }
    try {
      return Integer.parseInt(digits.toString());
    } catch (NumberFormatException exception) {
      return null;
    }
  }

  private String wrapHtmlDocument(String title, String contentHtml) {
    String css =
      """
      @page { size: A4; margin: 14mm; }
      html, body {
        margin: 0;
        padding: 0;
        background: #ffffff;
        color: #111111;
        font-family: "Segoe UI", Arial, sans-serif;
        font-size: 12px;
        line-height: 1.45;
      }
      * { box-sizing: border-box; }
      img { max-width: 100%; height: auto; }
      table { max-width: 100%; width: auto; border-collapse: collapse; }
      .thread-header { margin-bottom: 18px; }
      .message-section { margin-bottom: 18px; }
      .meta p { margin: 0 0 4px 0; }
      .body { margin-top: 10px; }
      .plain-body {
        white-space: pre-wrap;
        font-family: Consolas, "Courier New", monospace;
        background: #f8f8f8;
        border: 1px solid #ddd;
        border-radius: 6px;
        padding: 10px;
      }
      .attachments ul { margin-top: 6px; padding-left: 20px; }
      hr { border: none; border-top: 1px solid #dddddd; margin: 16px 0; }
      """;

    return "<!doctype html><html><head><meta charset=\"utf-8\" /><title>"
      + escapeHtml(title)
      + "</title><style>"
      + css
      + "</style></head><body>"
      + contentHtml
      + "</body></html>";
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

  private boolean isHtmlMime(String mimeType) {
    if (!StringUtils.hasText(mimeType)) {
      return false;
    }
    return mimeType.trim().toLowerCase(Locale.ROOT).startsWith("text/html");
  }

  private String safeText(String value, String fallback) {
    if (!StringUtils.hasText(value)) {
      return fallback;
    }
    return value.trim();
  }

  private String escapeHtml(String value) {
    return new TextNode(value == null ? "" : value).outerHtml();
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

  public record PdfDocument(String filename, byte[] bytes) {}

  private record ThreadExportRow(UUID id, String subject, String accountEmail) {}

  private record MessageExportRow(
    UUID id,
    UUID threadId,
    String accountEmail,
    String accountProvider,
    String senderName,
    String senderEmail,
    String subject,
    String snippet,
    String bodyCache,
    String bodyCacheMime,
    OffsetDateTime receivedAt
  ) {
    private MessageExportRow withBody(String nextBodyCache, String nextBodyCacheMime) {
      return new MessageExportRow(
        id,
        threadId,
        accountEmail,
        accountProvider,
        senderName,
        senderEmail,
        subject,
        snippet,
        nextBodyCache,
        nextBodyCacheMime,
        receivedAt
      );
    }
  }
}
