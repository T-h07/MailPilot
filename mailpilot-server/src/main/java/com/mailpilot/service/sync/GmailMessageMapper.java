package com.mailpilot.service.sync;

import com.mailpilot.service.gmail.GmailClient.GmailBody;
import com.mailpilot.service.gmail.GmailClient.GmailHeader;
import com.mailpilot.service.gmail.GmailClient.GmailMessageResponse;
import com.mailpilot.service.gmail.GmailClient.GmailPayload;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

@Component
public class GmailMessageMapper {

  private static final Pattern ANGLE_BRACKET_EMAIL = Pattern.compile("<([^>]+)>");
  private static final Pattern SIMPLE_EMAIL =
      Pattern.compile("([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,})");

  public GmailMetadata mapCoreFields(GmailMessageResponse message) {
    String providerMessageId =
        requireText(message.id(), "Message id is missing from Gmail response");
    String providerThreadId =
        StringUtils.hasText(message.threadId()) ? message.threadId() : providerMessageId;

    Map<String, String> headers = parseHeaders(message.payload());
    Sender sender = parseSender(headers.get("from"));

    String subject = nullable(headers.get("subject"));
    String messageRfc822Id = nullable(headers.get("message-id"));
    String snippet = StringUtils.hasText(message.snippet()) ? message.snippet().trim() : "";

    long internalDateMs = toInternalDateMillis(message.internalDate());
    OffsetDateTime receivedAt =
        OffsetDateTime.ofInstant(Instant.ofEpochMilli(internalDateMs), ZoneOffset.UTC);
    List<String> normalizedLabelIds = normalizeGmailLabels(message.labelIds());
    Flags flags = computeFlags(normalizedLabelIds);
    List<AttachmentMetadata> attachments = extractBodyParts(message.payload());

    return new GmailMetadata(
        providerMessageId,
        providerThreadId,
        sender.name(),
        sender.email(),
        sender.domain(),
        subject,
        snippet,
        messageRfc822Id,
        receivedAt,
        internalDateMs,
        normalizedLabelIds,
        flags.isRead(),
        flags.isInbox(),
        flags.isSent(),
        flags.isDraft(),
        !attachments.isEmpty(),
        attachments);
  }

  public Flags computeFlags(List<String> normalizedLabelIds) {
    boolean isRead = !hasGmailLabel(normalizedLabelIds, "UNREAD");
    boolean hasSpam = hasGmailLabel(normalizedLabelIds, "SPAM");
    boolean hasTrash = hasGmailLabel(normalizedLabelIds, "TRASH");
    boolean isInbox = hasGmailLabel(normalizedLabelIds, "INBOX") && !hasSpam && !hasTrash;
    boolean isSent = hasGmailLabel(normalizedLabelIds, "SENT");
    boolean isDraft = hasGmailLabel(normalizedLabelIds, "DRAFT");
    return new Flags(isRead, isInbox, isSent, isDraft);
  }

  public long toInternalDateMillis(String internalDateMillis) {
    if (StringUtils.hasText(internalDateMillis)) {
      try {
        return Long.parseLong(internalDateMillis);
      } catch (NumberFormatException ignored) {
      }
    }
    return Instant.now().toEpochMilli();
  }

  public Map<String, String> parseHeaders(GmailPayload payload) {
    Map<String, String> headers = new HashMap<>();
    if (payload == null || payload.headers() == null) {
      return headers;
    }

    for (GmailHeader header : payload.headers()) {
      if (header == null
          || !StringUtils.hasText(header.name())
          || !StringUtils.hasText(header.value())) {
        continue;
      }
      headers.put(header.name().trim().toLowerCase(Locale.ROOT), header.value().trim());
    }

    return headers;
  }

  public List<AttachmentMetadata> extractBodyParts(GmailPayload rootPayload) {
    if (rootPayload == null) {
      return List.of();
    }

    List<AttachmentMetadata> attachments = new ArrayList<>();
    collectAttachments(rootPayload, attachments);

    if (attachments.isEmpty()) {
      return List.of();
    }

    LinkedHashSet<AttachmentMetadata> deduped = new LinkedHashSet<>(attachments);
    return List.copyOf(deduped);
  }

  public List<String> normalizeGmailLabels(List<String> labelIds) {
    if (labelIds == null || labelIds.isEmpty()) {
      return List.of();
    }

    LinkedHashSet<String> normalized = new LinkedHashSet<>();
    for (String labelId : labelIds) {
      if (!StringUtils.hasText(labelId)) {
        continue;
      }
      normalized.add(labelId.trim().toUpperCase(Locale.ROOT));
    }
    return List.copyOf(normalized);
  }

  private Sender parseSender(String fromHeader) {
    if (!StringUtils.hasText(fromHeader)) {
      return new Sender("Unknown Sender", "unknown@unknown.invalid", "unknown.invalid");
    }

    String raw = fromHeader.trim();
    String email = null;
    String name = null;

    Matcher angleMatcher = ANGLE_BRACKET_EMAIL.matcher(raw);
    if (angleMatcher.find()) {
      email = angleMatcher.group(1).trim();
      name = raw.substring(0, angleMatcher.start()).replace("\"", "").trim();
    } else {
      Matcher simpleEmail = SIMPLE_EMAIL.matcher(raw);
      if (simpleEmail.find()) {
        email = simpleEmail.group(1).trim();
        name = raw.replace(email, "").replace("\"", "").trim();
      }
    }

    if (!StringUtils.hasText(email) || !email.contains("@")) {
      email = "unknown@unknown.invalid";
    }

    if (!StringUtils.hasText(name)) {
      String localPart = email.split("@")[0];
      name = localPart.isBlank() ? "Unknown Sender" : localPart;
    }

    String[] parts = email.split("@", 2);
    String domain =
        parts.length == 2 && StringUtils.hasText(parts[1])
            ? parts[1].toLowerCase(Locale.ROOT)
            : "unknown.invalid";

    return new Sender(name, email.toLowerCase(Locale.ROOT), domain);
  }

  private void collectAttachments(GmailPayload payload, List<AttachmentMetadata> attachments) {
    if (payload == null) {
      return;
    }

    GmailBody body = payload.body();
    boolean hasAttachmentId = body != null && StringUtils.hasText(body.attachmentId());
    boolean hasFilename = StringUtils.hasText(payload.filename());

    if (hasAttachmentId || hasFilename) {
      String filename = hasFilename ? payload.filename().trim() : "(unnamed)";
      long sizeBytes = body != null && body.size() != null ? Math.max(body.size(), 0L) : 0L;
      attachments.add(
          new AttachmentMetadata(
              filename,
              nullable(payload.mimeType()),
              sizeBytes,
              hasAttachmentId ? body.attachmentId().trim() : null));
    }

    List<GmailPayload> parts = payload.parts();
    if (parts == null || parts.isEmpty()) {
      return;
    }

    for (GmailPayload part : parts) {
      collectAttachments(part, attachments);
    }
  }

  private boolean hasGmailLabel(List<String> labelIds, String targetLabel) {
    if (labelIds == null || labelIds.isEmpty() || !StringUtils.hasText(targetLabel)) {
      return false;
    }

    for (String labelId : labelIds) {
      if (targetLabel.equalsIgnoreCase(labelId)) {
        return true;
      }
    }
    return false;
  }

  private String requireText(String value, String message) {
    if (!StringUtils.hasText(value)) {
      throw new IllegalStateException(message);
    }
    return value.trim();
  }

  private String nullable(String value) {
    if (!StringUtils.hasText(value)) {
      return null;
    }
    String trimmed = value.trim();
    return trimmed.isEmpty() ? null : trimmed;
  }

  public record Flags(boolean isRead, boolean isInbox, boolean isSent, boolean isDraft) {}

  public record Sender(String name, String email, String domain) {}

  public record AttachmentMetadata(
      String filename, String mimeType, long sizeBytes, String providerAttachmentId) {}

  public record GmailMetadata(
      String providerMessageId,
      String providerThreadId,
      String senderName,
      String senderEmail,
      String senderDomain,
      String subject,
      String snippet,
      String messageRfc822Id,
      OffsetDateTime receivedAt,
      long gmailInternalDateMs,
      List<String> gmailLabelIds,
      boolean isRead,
      boolean isInbox,
      boolean isSent,
      boolean isDraft,
      boolean hasAttachments,
      List<AttachmentMetadata> attachments) {}
}
