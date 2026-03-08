package com.mailpilot.service.gmail;

import com.mailpilot.api.error.ApiBadRequestException;
import com.mailpilot.service.gmail.GmailClient.GmailBody;
import com.mailpilot.service.gmail.GmailClient.GmailHeader;
import com.mailpilot.service.gmail.GmailClient.GmailPayload;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

@Component
public class GmailMimeParser {

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

  public DecodedBody extractPreferredBody(GmailPayload payload) {
    BodyCollector collector = new BodyCollector(new ArrayList<>(), new ArrayList<>());
    collectBodyParts(payload, collector);

    String html = joinCollectedParts(collector.htmlParts());
    if (StringUtils.hasText(html)) {
      return new DecodedBody("text/html", html);
    }

    String plain = joinCollectedParts(collector.plainParts());
    if (StringUtils.hasText(plain)) {
      return new DecodedBody("text/plain", plain);
    }

    if (collector.attachmentOnlyBody()) {
      throw new ApiBadRequestException(
          "Message body is stored as attachment-only content and cannot be loaded yet.");
    }
    throw new ApiBadRequestException("No body content available from Gmail for this message.");
  }

  public List<GmailAttachmentPart> extractAttachments(GmailPayload rootPayload) {
    if (rootPayload == null) {
      return List.of();
    }

    List<GmailAttachmentPart> attachments = new ArrayList<>();
    collectAttachments(rootPayload, attachments);
    if (attachments.isEmpty()) {
      return List.of();
    }

    LinkedHashSet<GmailAttachmentPart> deduped = new LinkedHashSet<>(attachments);
    return List.copyOf(deduped);
  }

  public GmailPayload findInlineAttachmentPayload(GmailPayload payload, AttachmentLookup lookup) {
    if (payload == null) {
      return null;
    }

    List<GmailPayload> candidates = new ArrayList<>();
    collectInlinePayloadCandidates(payload, candidates);
    if (candidates.isEmpty()) {
      return null;
    }

    if (StringUtils.hasText(lookup.partId())) {
      for (GmailPayload candidate : candidates) {
        if (lookup.partId().trim().equals(candidate.partId())) {
          return candidate;
        }
      }
    }

    if (StringUtils.hasText(lookup.contentId())) {
      String expectedContentId = normalizeComparisonValue(lookup.contentId());
      for (GmailPayload candidate : candidates) {
        String candidateContentId = normalizeComparisonValue(extractPartContentId(candidate));
        if (StringUtils.hasText(candidateContentId)
            && expectedContentId.equals(candidateContentId)) {
          return candidate;
        }
      }
    }

    String expectedFilename = normalizeComparisonValue(lookup.filename());
    String expectedMimeType = normalizeComparisonValue(lookup.mimeType());
    long expectedSize = Math.max(lookup.sizeBytes(), 0L);

    GmailPayload bestMatch = null;
    int bestScore = Integer.MIN_VALUE;
    for (GmailPayload candidate : candidates) {
      int score = 0;
      String candidateFilename = normalizeComparisonValue(candidate.filename());
      String candidateMimeType = normalizeComparisonValue(candidate.mimeType());
      long candidateSize =
          candidate.body() != null && candidate.body().size() != null
              ? Math.max(candidate.body().size(), 0L)
              : 0L;

      if (StringUtils.hasText(expectedFilename) && expectedFilename.equals(candidateFilename)) {
        score += 6;
      }
      if (StringUtils.hasText(expectedMimeType) && expectedMimeType.equals(candidateMimeType)) {
        score += 3;
      }
      if (expectedSize > 0L && candidateSize > 0L) {
        if (expectedSize == candidateSize) {
          score += 4;
        } else if (Math.abs(expectedSize - candidateSize) <= 16L) {
          score += 1;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = candidate;
      }
    }

    if (bestScore > 0) {
      return bestMatch;
    }

    return candidates.size() == 1 ? candidates.getFirst() : null;
  }

  public byte[] decodeBase64Url(String value) {
    String trimmed = value == null ? "" : value.trim();
    int paddingNeeded = (4 - (trimmed.length() % 4)) % 4;
    String padded = trimmed + "=".repeat(paddingNeeded);
    return Base64.getUrlDecoder().decode(padded);
  }

  private void collectBodyParts(GmailPayload payload, BodyCollector collector) {
    if (payload == null) {
      return;
    }

    String mimeType = normalizeMime(payload.mimeType());
    if (mimeType.startsWith("text/plain")) {
      collectBodyPart(payload.body(), collector.plainParts(), collector);
    } else if (mimeType.startsWith("text/html")) {
      collectBodyPart(payload.body(), collector.htmlParts(), collector);
    }

    List<GmailPayload> parts = payload.parts();
    if (parts == null || parts.isEmpty()) {
      return;
    }
    for (GmailPayload part : parts) {
      collectBodyParts(part, collector);
    }
  }

  private void collectBodyPart(GmailBody body, List<String> target, BodyCollector collector) {
    if (body == null) {
      return;
    }

    if (StringUtils.hasText(body.data())) {
      try {
        String decoded = new String(decodeBase64Url(body.data()), StandardCharsets.UTF_8);
        if (StringUtils.hasText(decoded)) {
          target.add(decoded);
        }
      } catch (IllegalArgumentException exception) {
        throw new ApiBadRequestException("Message body returned invalid base64 encoding.");
      }
      return;
    }

    if (StringUtils.hasText(body.attachmentId())) {
      collector.markAttachmentOnlyBody();
    }
  }

  private String joinCollectedParts(List<String> parts) {
    if (parts == null || parts.isEmpty()) {
      return "";
    }
    return String.join("\n\n", parts).trim();
  }

  private void collectAttachments(GmailPayload payload, List<GmailAttachmentPart> attachments) {
    if (payload == null) {
      return;
    }

    GmailBody body = payload.body();
    Map<String, String> partHeaders = parseHeaders(payload);
    String contentDisposition = nullable(partHeaders.get("content-disposition"));
    String contentId = normalizeContentId(partHeaders.get("content-id"));
    boolean hasAttachmentId = body != null && StringUtils.hasText(body.attachmentId());
    boolean hasEmbeddedData = body != null && StringUtils.hasText(body.data());
    boolean hasFilename = StringUtils.hasText(payload.filename());
    String filename = hasFilename ? payload.filename().trim() : null;
    String mimeType = nullable(payload.mimeType());
    boolean dispositionAttachment = isDispositionType(contentDisposition, "attachment");
    boolean dispositionInline = isDispositionType(contentDisposition, "inline");

    boolean shouldCapture =
        (hasFilename
                && (hasAttachmentId
                    || hasEmbeddedData
                    || dispositionAttachment
                    || isLikelyFileMime(mimeType)))
            || (dispositionAttachment && (hasAttachmentId || hasEmbeddedData));

    if (shouldCapture) {
      String resolvedFilename = hasFilename ? filename : "(unnamed)";
      long sizeBytes = body != null && body.size() != null ? Math.max(body.size(), 0L) : 0L;
      boolean isInline =
          !dispositionAttachment && (dispositionInline || StringUtils.hasText(contentId));
      attachments.add(
          new GmailAttachmentPart(
              resolvedFilename,
              mimeType,
              sizeBytes,
              hasAttachmentId ? body.attachmentId().trim() : null,
              nullable(payload.partId()),
              contentId,
              isInline,
              hasEmbeddedData));
    }

    List<GmailPayload> parts = payload.parts();
    if (parts == null || parts.isEmpty()) {
      return;
    }
    for (GmailPayload part : parts) {
      collectAttachments(part, attachments);
    }
  }

  private void collectInlinePayloadCandidates(GmailPayload payload, List<GmailPayload> candidates) {
    if (payload == null) {
      return;
    }

    if (payload.body() != null && StringUtils.hasText(payload.body().data())) {
      candidates.add(payload);
    }

    List<GmailPayload> parts = payload.parts();
    if (parts == null || parts.isEmpty()) {
      return;
    }
    for (GmailPayload part : parts) {
      collectInlinePayloadCandidates(part, candidates);
    }
  }

  private String extractPartContentId(GmailPayload payload) {
    List<GmailHeader> headers = payload == null ? null : payload.headers();
    if (headers == null || headers.isEmpty()) {
      return null;
    }

    for (GmailHeader header : headers) {
      if (header == null
          || !StringUtils.hasText(header.name())
          || !StringUtils.hasText(header.value())) {
        continue;
      }
      if ("content-id".equalsIgnoreCase(header.name().trim())) {
        return normalizeContentId(header.value());
      }
    }
    return null;
  }

  private String normalizeComparisonValue(String value) {
    return StringUtils.hasText(value) ? value.trim().toLowerCase(Locale.ROOT) : "";
  }

  private String normalizeMime(String mimeType) {
    if (!StringUtils.hasText(mimeType)) {
      return "";
    }
    return mimeType.trim().toLowerCase(Locale.ROOT);
  }

  private String nullable(String value) {
    if (!StringUtils.hasText(value)) {
      return null;
    }
    String trimmed = value.trim();
    return trimmed.isEmpty() ? null : trimmed;
  }

  private boolean isLikelyFileMime(String mimeType) {
    if (!StringUtils.hasText(mimeType)) {
      return false;
    }
    String normalized = mimeType.trim().toLowerCase(Locale.ROOT);
    return !normalized.startsWith("multipart/") && !normalized.startsWith("text/");
  }

  private boolean isDispositionType(String headerValue, String expectedPrefix) {
    if (!StringUtils.hasText(headerValue) || !StringUtils.hasText(expectedPrefix)) {
      return false;
    }
    String normalized = headerValue.trim().toLowerCase(Locale.ROOT);
    return normalized.startsWith(expectedPrefix.toLowerCase(Locale.ROOT));
  }

  private String normalizeContentId(String contentId) {
    if (!StringUtils.hasText(contentId)) {
      return null;
    }
    String normalized = contentId.trim();
    if (normalized.startsWith("<") && normalized.endsWith(">") && normalized.length() > 2) {
      return normalized.substring(1, normalized.length() - 1);
    }
    return normalized;
  }

  private static final class BodyCollector {

    private final List<String> plainParts;
    private final List<String> htmlParts;
    private boolean attachmentOnlyBody;

    private BodyCollector(List<String> plainParts, List<String> htmlParts) {
      this.plainParts = plainParts;
      this.htmlParts = htmlParts;
      this.attachmentOnlyBody = false;
    }

    private List<String> plainParts() {
      return plainParts;
    }

    private List<String> htmlParts() {
      return htmlParts;
    }

    private boolean attachmentOnlyBody() {
      return attachmentOnlyBody;
    }

    private void markAttachmentOnlyBody() {
      attachmentOnlyBody = true;
    }
  }

  public record DecodedBody(String mimeType, String content) {}

  public record GmailAttachmentPart(
      String filename,
      String mimeType,
      long sizeBytes,
      String providerAttachmentId,
      String partId,
      String contentId,
      boolean isInline,
      boolean hasEmbeddedData) {}

  public record AttachmentLookup(
      String partId, String contentId, String filename, String mimeType, long sizeBytes) {}
}
