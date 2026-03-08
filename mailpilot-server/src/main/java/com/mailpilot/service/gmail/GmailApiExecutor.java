package com.mailpilot.service.gmail;

import com.mailpilot.service.gmail.GmailClient.GmailUnauthorizedException;
import com.mailpilot.service.oauth.TokenService;
import java.util.UUID;
import java.util.function.Function;
import org.springframework.stereotype.Service;

@Service
public class GmailApiExecutor {

  private final TokenService tokenService;

  public GmailApiExecutor(TokenService tokenService) {
    this.tokenService = tokenService;
  }

  public <T> T execute(UUID accountId, Function<String, T> request) {
    String accessToken = tokenService.getValidAccessToken(accountId).accessToken();
    try {
      return request.apply(accessToken);
    } catch (GmailUnauthorizedException unauthorizedException) {
      String refreshedAccessToken = tokenService.refreshAccessToken(accountId).accessToken();
      return request.apply(refreshedAccessToken);
    }
  }
}
