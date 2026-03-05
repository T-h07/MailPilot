package com.mailpilot.service;

import com.mailpilot.api.error.ApiInternalException;
import com.openhtmltopdf.pdfboxout.PdfRendererBuilder;
import java.io.ByteArrayOutputStream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

@Component
public class HtmlPdfRenderer {

  private static final Logger LOGGER = LoggerFactory.getLogger(HtmlPdfRenderer.class);

  public byte[] render(String html, String baseUri) {
    try (ByteArrayOutputStream outputStream = new ByteArrayOutputStream()) {
      PdfRendererBuilder builder = new PdfRendererBuilder();
      builder.useFastMode();
      builder.withHtmlContent(html, baseUri);
      builder.toStream(outputStream);
      builder.run();
      return outputStream.toByteArray();
    } catch (Exception exception) {
      LOGGER.error("Failed to render HTML as PDF", exception);
      throw new ApiInternalException("Failed to render PDF export.");
    }
  }
}
