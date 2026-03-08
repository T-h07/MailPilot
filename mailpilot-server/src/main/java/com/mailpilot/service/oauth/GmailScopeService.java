package com.mailpilot.service.oauth;

import java.util.Locale;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class GmailScopeService {

  public static final String GMAIL_PROVIDER = "GMAIL";
  public static final String GMAIL_READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
  public static final String GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

  public boolean isGmailProvider(String provider) {
    return GMAIL_PROVIDER.equalsIgnoreCase(provider);
  }

  public GmailAccountCapabilities evaluate(String provider, String scope) {
    if (!isGmailProvider(provider)) {
      return new GmailAccountCapabilities(false, false);
    }
    return new GmailAccountCapabilities(hasReadScope(scope), hasSendScope(scope));
  }

  public boolean hasReadScope(String scope) {
    return hasScope(scope, GMAIL_READ_SCOPE);
  }

  public boolean hasSendScope(String scope) {
    return hasScope(scope, GMAIL_SEND_SCOPE);
  }

  public String resolveStatus(String provider, String existingStatus, String scope) {
    if (!isGmailProvider(provider)) {
      return existingStatus;
    }
    GmailAccountCapabilities capabilities = evaluate(provider, scope);
    return capabilities.isReconnectRequired() ? "REAUTH_REQUIRED" : "CONNECTED";
  }

  private boolean hasScope(String scopeValue, String requiredScope) {
    if (!StringUtils.hasText(scopeValue) || !StringUtils.hasText(requiredScope)) {
      return false;
    }

    String required = requiredScope.toLowerCase(Locale.ROOT);
    for (String scope : scopeValue.trim().split("[\\s,]+")) {
      if (required.equals(scope.toLowerCase(Locale.ROOT))) {
        return true;
      }
    }
    return false;
  }

  public record GmailAccountCapabilities(boolean canRead, boolean canSend) {

    public boolean isReconnectRequired() {
      return !canRead || !canSend;
    }
  }
}
