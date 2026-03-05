package com.mailpilot.service;

import com.mailpilot.api.error.ApiInternalException;
import com.openhtmltopdf.pdfboxout.PdfRendererBuilder;
import java.io.ByteArrayOutputStream;
import java.util.Locale;
import java.util.Set;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Attribute;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

@Component
public class HtmlPdfRenderer {

  private static final Logger LOGGER = LoggerFactory.getLogger(HtmlPdfRenderer.class);
  private static final Set<String> EXTERNAL_URI_ATTRIBUTES = Set.of(
    "src",
    "href",
    "poster",
    "xlink:href",
    "action"
  );

  public byte[] render(String html, String baseUri) {
    try {
      return renderInternal(html, baseUri);
    } catch (Exception firstFailure) {
      LOGGER.warn("Primary HTML to PDF render failed; retrying without external assets", firstFailure);
      try {
        String strippedHtml = stripExternalAssets(html, baseUri);
        return renderInternal(strippedHtml, baseUri);
      } catch (Exception secondFailure) {
        LOGGER.error("Failed to render HTML as PDF", secondFailure);
        throw new ApiInternalException("Failed to render PDF export.");
      }
    }
  }

  private byte[] renderInternal(String html, String baseUri) throws Exception {
    try (ByteArrayOutputStream outputStream = new ByteArrayOutputStream()) {
      PdfRendererBuilder builder = new PdfRendererBuilder();
      builder.useFastMode();
      builder.withHtmlContent(html, baseUri);
      builder.toStream(outputStream);
      builder.run();
      return outputStream.toByteArray();
    }
  }

  private String stripExternalAssets(String html, String baseUri) {
    Document document = Jsoup.parse(html == null ? "" : html, baseUri);
    document.outputSettings().prettyPrint(false);

    for (Element element : document.getAllElements()) {
      for (Attribute attribute : element.attributes()) {
        String normalizedName = attribute.getKey().toLowerCase(Locale.ROOT);
        if (!EXTERNAL_URI_ATTRIBUTES.contains(normalizedName)) {
          continue;
        }

        String value = attribute.getValue();
        if (!StringUtils.hasText(value)) {
          continue;
        }

        String normalizedValue = value.trim().toLowerCase(Locale.ROOT);
        if (normalizedValue.startsWith("http://") || normalizedValue.startsWith("https://")) {
          element.removeAttr(attribute.getKey());
        }
      }
    }

    return document.outerHtml();
  }
}
