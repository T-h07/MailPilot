package com.mailpilot.api;

import com.mailpilot.api.model.MessageDetailResponse;
import com.mailpilot.api.model.MessageBodyLoadResponse;
import com.mailpilot.api.model.MessageReadRequest;
import com.mailpilot.api.model.StatusResponse;
import com.mailpilot.service.MessageService;
import com.mailpilot.service.PdfExportService;
import com.mailpilot.service.PdfExportService.PdfDocument;
import jakarta.validation.Valid;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/messages")
public class MessageController {

  private final MessageService messageService;
  private final PdfExportService pdfExportService;

  public MessageController(MessageService messageService, PdfExportService pdfExportService) {
    this.messageService = messageService;
    this.pdfExportService = pdfExportService;
  }

  @GetMapping("/{id}")
  public MessageDetailResponse getById(@PathVariable("id") UUID id) {
    return messageService.getMessageDetail(id);
  }

  @GetMapping("/{id}/export/pdf")
  public ResponseEntity<byte[]> exportMessagePdf(@PathVariable("id") UUID id) {
    PdfDocument document = pdfExportService.exportMessage(id);
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

  @PostMapping("/{id}/read")
  public StatusResponse setReadState(
    @PathVariable("id") UUID id,
    @Valid @RequestBody MessageReadRequest request
  ) {
    messageService.setUnread(id, request.isUnread());
    return new StatusResponse("ok");
  }

  @PostMapping("/{id}/body/load")
  public MessageBodyLoadResponse loadBody(
    @PathVariable("id") UUID id,
    @RequestParam(name = "force", defaultValue = "false") boolean force
  ) {
    return messageService.loadBody(id, force);
  }

  private String sanitizeDispositionFilename(String value) {
    if (value == null || value.isBlank()) {
      return "mailpilot-message-export.pdf";
    }
    return value.replaceAll("[\\r\\n]+", " ").trim();
  }
}
