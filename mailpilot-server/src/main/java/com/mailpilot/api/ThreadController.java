package com.mailpilot.api;

import com.mailpilot.service.PdfExportService;
import com.mailpilot.service.PdfExportService.PdfDocument;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
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
@RequestMapping("/api/threads")
public class ThreadController {

  private final PdfExportService pdfExportService;

  public ThreadController(PdfExportService pdfExportService) {
    this.pdfExportService = pdfExportService;
  }

  @GetMapping("/{threadId}/export/pdf")
  public ResponseEntity<byte[]> exportThreadPdf(@PathVariable("threadId") UUID threadId) {
    PdfDocument document = pdfExportService.exportThread(threadId);
    String safeFilename = sanitizeDispositionFilename(document.filename());
    ContentDisposition disposition = ContentDisposition
      .attachment()
      .filename(safeFilename, StandardCharsets.UTF_8)
      .build();

    return ResponseEntity
      .ok()
      .contentType(MediaType.APPLICATION_PDF)
      .contentLength(document.bytes().length)
      .header(HttpHeaders.CONTENT_DISPOSITION, disposition.toString())
      .body(document.bytes());
  }

  private String sanitizeDispositionFilename(String value) {
    if (value == null || value.isBlank()) {
      return "mailpilot-thread-export.pdf";
    }
    String sanitized = value
      .replaceAll("[\\p{Cntrl}<>:\"/\\\\|?*]+", " ")
      .replaceAll("\\s+", " ")
      .trim();
    if (sanitized.isBlank()) {
      return "mailpilot-thread-export.pdf";
    }
    if (!sanitized.toLowerCase(Locale.ROOT).endsWith(".pdf")) {
      sanitized = sanitized + ".pdf";
    }
    if (sanitized.length() > 80) {
      sanitized = sanitized.substring(0, 80).trim();
      if (!sanitized.toLowerCase(Locale.ROOT).endsWith(".pdf")) {
        sanitized = sanitized.replaceAll("\\.*$", "") + ".pdf";
      }
    }
    return sanitized;
  }
}
