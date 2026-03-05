package com.mailpilot.api;

import com.mailpilot.api.model.GmailOAuthConfigCheckResponse;
import com.mailpilot.api.model.GmailOAuthStartRequest;
import com.mailpilot.api.model.GmailOAuthStartResponse;
import com.mailpilot.api.model.GmailOAuthStatusResponse;
import com.mailpilot.service.oauth.GmailOAuthService;
import com.mailpilot.service.oauth.GoogleOAuthClientConfigService;
import com.mailpilot.service.oauth.OAuthStateStore.OAuthFlowStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/oauth/gmail")
public class GmailOAuthController {

  private final GoogleOAuthClientConfigService configService;
  private final GmailOAuthService gmailOAuthService;

  public GmailOAuthController(
    GoogleOAuthClientConfigService configService,
    GmailOAuthService gmailOAuthService
  ) {
    this.configService = configService;
    this.gmailOAuthService = gmailOAuthService;
  }

  @GetMapping("/config-check")
  public GmailOAuthConfigCheckResponse configCheck() {
    GoogleOAuthClientConfigService.GoogleOAuthConfigCheck check = configService.checkConfiguration();
    return new GmailOAuthConfigCheckResponse(check.configured(), check.path(), check.message());
  }

  @PostMapping("/start")
  public GmailOAuthStartResponse start(@RequestBody(required = false) GmailOAuthStartRequest request) {
    return gmailOAuthService.start(request == null ? null : request.mode());
  }

  @GetMapping("/status")
  public GmailOAuthStatusResponse status(@RequestParam("state") String state) {
    OAuthFlowStatus status = gmailOAuthService.status(state);
    return new GmailOAuthStatusResponse(state, status.status(), status.message());
  }

  @GetMapping(value = "/callback", produces = MediaType.TEXT_HTML_VALUE)
  public ResponseEntity<String> callback(
    @RequestParam(value = "code", required = false) String code,
    @RequestParam(value = "state", required = false) String state,
    @RequestParam(value = "error", required = false) String error,
    @RequestParam(value = "error_description", required = false) String errorDescription
  ) {
    GmailOAuthService.OAuthCallbackResult result = gmailOAuthService.handleCallback(
      code,
      state,
      error,
      errorDescription
    );
    return ResponseEntity
      .status(result.httpStatusCode())
      .contentType(MediaType.TEXT_HTML)
      .body(result.html());
  }
}
