package com.mailpilot.service;

import com.mailpilot.api.error.ApiInternalException;
import com.openhtmltopdf.pdfboxout.PdfRendererBuilder;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Attribute;
import org.jsoup.nodes.Comment;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Document.OutputSettings.Syntax;
import org.jsoup.nodes.Element;
import org.jsoup.nodes.Entities;
import org.jsoup.nodes.Node;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

@Component
public class HtmlPdfRenderer {

  private static final Logger LOGGER = LoggerFactory.getLogger(HtmlPdfRenderer.class);
  private static final Set<String> EXTERNAL_URI_ATTRIBUTES =
      Set.of("src", "href", "poster", "xlink:href", "action");

  public byte[] render(String html, String baseUri) {
    String normalizedMarkup = normalizeMarkupForRenderer(html, baseUri);
    try {
      return renderInternal(normalizedMarkup, baseUri);
    } catch (Exception firstFailure) {
      LOGGER.warn(
          "Primary HTML to PDF render failed; retrying without external assets", firstFailure);
      try {
        String strippedHtml = stripExternalAssets(normalizedMarkup, baseUri);
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

  private String normalizeMarkupForRenderer(String html, String baseUri) {
    String source = html == null ? "" : html.replace("\uFEFF", "");
    // Remove leading non-whitespace control chars that break XML parser startup.
    source = source.replaceFirst("^[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]+", "");

    Document document = Jsoup.parse(source, baseUri);
    document.outputSettings().syntax(Syntax.xml);
    document.outputSettings().escapeMode(Entities.EscapeMode.xhtml);
    document.outputSettings().prettyPrint(false);
    removeComments(document);
    return document.outerHtml();
  }

  private String stripExternalAssets(String html, String baseUri) {
    Document document = Jsoup.parse(html == null ? "" : html, baseUri);
    document.outputSettings().syntax(Syntax.xml);
    document.outputSettings().escapeMode(Entities.EscapeMode.xhtml);
    document.outputSettings().prettyPrint(false);
    removeComments(document);

    for (Element element : document.getAllElements()) {
      List<Attribute> attributes = new ArrayList<>();
      for (Attribute attribute : element.attributes()) {
        attributes.add(attribute);
      }

      for (Attribute attribute : attributes) {
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

  private void removeComments(Document document) {
    List<Node> comments = new ArrayList<>();
    for (Element element : document.getAllElements()) {
      for (Node childNode : element.childNodes()) {
        if (childNode instanceof Comment) {
          comments.add(childNode);
        }
      }
    }

    for (Node commentNode : comments) {
      commentNode.remove();
    }
  }
}
