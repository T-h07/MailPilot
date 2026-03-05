package com.mailpilot.api;

import com.mailpilot.service.AttachmentDownloadService;
import com.mailpilot.service.AttachmentDownloadService.DownloadedAttachment;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/attachments")
public class AttachmentController {

  private final AttachmentDownloadService attachmentDownloadService;

  public AttachmentController(AttachmentDownloadService attachmentDownloadService) {
    this.attachmentDownloadService = attachmentDownloadService;
  }

  @GetMapping("/{attachmentId}/download")
  public ResponseEntity<byte[]> download(@PathVariable("attachmentId") UUID attachmentId) {
    DownloadedAttachment attachment = attachmentDownloadService.download(attachmentId);
    MediaType mediaType = resolveMediaType(attachment.mimeType());
    String safeFilename = sanitizeDispositionFilename(attachment.filename());
    ContentDisposition disposition = ContentDisposition
      .attachment()
      .filename(safeFilename, StandardCharsets.UTF_8)
      .build();

    return ResponseEntity
      .ok()
      .contentType(mediaType)
      .contentLength(attachment.bytes().length)
      .header(HttpHeaders.CONTENT_DISPOSITION, disposition.toString())
      .body(attachment.bytes());
  }

  private MediaType resolveMediaType(String mimeType) {
    try {
      return MediaType.parseMediaType(mimeType);
    } catch (Exception exception) {
      return MediaType.APPLICATION_OCTET_STREAM;
    }
  }

  private String sanitizeDispositionFilename(String value) {
    if (value == null || value.isBlank()) {
      return "attachment.bin";
    }
    return value.replaceAll("[\\r\\n]+", " ").trim();
  }
}
