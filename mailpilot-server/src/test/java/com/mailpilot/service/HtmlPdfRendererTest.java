package com.mailpilot.service;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.reflect.Method;
import org.junit.jupiter.api.Test;

class HtmlPdfRendererTest {

  @Test
  void renderHandlesHtmlWithInvalidCommentSyntax() {
    HtmlPdfRenderer renderer = new HtmlPdfRenderer();
    String html =
        """
        <html>
          <body>
            <!-- user-content--gmail -->
            <p>Hello from MailPilot</p>
          </body>
        </html>
        """;

    byte[] pdf = assertDoesNotThrow(() -> renderer.render(html, "https://mail.google.com"));
    assertTrue(pdf.length > 0);
  }

  @Test
  void stripExternalAssetsDoesNotMutateAttributesDuringIteration() throws Exception {
    HtmlPdfRenderer renderer = new HtmlPdfRenderer();
    Method stripMethod =
        HtmlPdfRenderer.class.getDeclaredMethod("stripExternalAssets", String.class, String.class);
    stripMethod.setAccessible(true);

    String html =
        """
        <html>
          <body>
            <img src="https://example.com/image.png" alt="img" />
            <a href="http://example.com/path">open</a>
            <video poster="https://example.com/poster.png"></video>
            <form action="https://example.com/submit"></form>
          </body>
        </html>
        """;

    String sanitizedHtml =
        assertDoesNotThrow(
            () -> (String) stripMethod.invoke(renderer, html, "https://mail.google.com"));

    assertFalse(sanitizedHtml.contains("https://example.com/image.png"));
    assertFalse(sanitizedHtml.contains("http://example.com/path"));
    assertFalse(sanitizedHtml.contains("https://example.com/poster.png"));
    assertFalse(sanitizedHtml.contains("https://example.com/submit"));
  }
}
