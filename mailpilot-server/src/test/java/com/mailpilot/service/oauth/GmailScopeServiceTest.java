package com.mailpilot.service.oauth;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class GmailScopeServiceTest {

  private final GmailScopeService gmailScopeService = new GmailScopeService();

  @Test
  void evaluateMarksReconnectRequiredWithoutSendScope() {
    GmailScopeService.GmailAccountCapabilities capabilities =
        gmailScopeService.evaluate("GMAIL", GmailScopeService.GMAIL_READ_SCOPE);

    assertTrue(capabilities.canRead());
    assertFalse(capabilities.canSend());
    assertTrue(capabilities.isReconnectRequired());
    assertEquals(
        "REAUTH_REQUIRED",
        gmailScopeService.resolveStatus("GMAIL", "CONNECTED", GmailScopeService.GMAIL_READ_SCOPE));
  }

  @Test
  void evaluateMarksConnectedWhenReadAndSendScopesExist() {
    String combinedScope =
        GmailScopeService.GMAIL_READ_SCOPE + " " + GmailScopeService.GMAIL_SEND_SCOPE;

    GmailScopeService.GmailAccountCapabilities capabilities =
        gmailScopeService.evaluate("GMAIL", combinedScope);

    assertTrue(capabilities.canRead());
    assertTrue(capabilities.canSend());
    assertFalse(capabilities.isReconnectRequired());
    assertEquals("CONNECTED", gmailScopeService.resolveStatus("GMAIL", "CONNECTED", combinedScope));
  }
}
