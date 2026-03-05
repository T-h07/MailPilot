package com.mailpilot.api;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.mailpilot.api.error.ApiBadRequestException;
import com.mailpilot.api.errors.GlobalExceptionHandler;
import com.mailpilot.service.MessageService;
import com.mailpilot.service.PdfExportService;
import com.mailpilot.service.PdfExportService.PdfDocument;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(MessageController.class)
@Import(GlobalExceptionHandler.class)
class MessageControllerWebMvcTest {

  @Autowired
  private MockMvc mockMvc;

  @MockBean
  private MessageService messageService;

  @MockBean
  private PdfExportService pdfExportService;

  @Test
  void exportPdfReturnsApplicationPdfContentType() throws Exception {
    UUID messageId = UUID.randomUUID();
    byte[] bytes = "pdf-bytes".getBytes(StandardCharsets.UTF_8);
    when(pdfExportService.exportMessage(messageId)).thenReturn(new PdfDocument("sample.pdf", bytes));

    mockMvc.perform(get("/api/messages/{id}/export/pdf", messageId))
      .andExpect(status().isOk())
      .andExpect(header().string(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_PDF_VALUE))
      .andExpect(content().bytes(bytes));
  }

  @Test
  void badRequestReturnsStructuredErrorResponse() throws Exception {
    UUID messageId = UUID.randomUUID();
    when(messageService.getMessageDetail(messageId)).thenThrow(new ApiBadRequestException("Invalid request payload"));

    mockMvc.perform(get("/api/messages/{id}", messageId))
      .andExpect(status().isBadRequest())
      .andExpect(jsonPath("$.status").value("error"))
      .andExpect(jsonPath("$.message").value("Invalid request payload"))
      .andExpect(jsonPath("$.code").value("BAD_REQUEST"))
      .andExpect(jsonPath("$.timestamp").exists())
      .andExpect(jsonPath("$.path").value("/api/messages/" + messageId));
  }
}
