package com.mailpilot.api;

import com.mailpilot.api.model.GmailSyncRunAllResponse;
import com.mailpilot.api.model.GmailSyncStartResponse;
import com.mailpilot.api.model.GmailSyncStatusResponse;
import com.mailpilot.service.sync.GmailSyncCoordinator;
import java.util.List;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/sync")
public class SyncController {

  private final GmailSyncCoordinator gmailSyncCoordinator;

  public SyncController(GmailSyncCoordinator gmailSyncCoordinator) {
    this.gmailSyncCoordinator = gmailSyncCoordinator;
  }

  @PostMapping("/gmail/{accountId}/run")
  public GmailSyncStartResponse runSingleAccount(
    @PathVariable("accountId") UUID accountId,
    @RequestParam(value = "maxMessages", required = false) Integer maxMessages
  ) {
    int normalizedMaxMessages = gmailSyncCoordinator.normalizeMaxMessages(maxMessages);
    gmailSyncCoordinator.triggerAccountSync(accountId, normalizedMaxMessages);
    return new GmailSyncStartResponse("started", accountId, normalizedMaxMessages);
  }

  @PostMapping("/gmail/run")
  public GmailSyncRunAllResponse runAllAccounts(
    @RequestParam(value = "maxMessages", required = false) Integer maxMessages
  ) {
    int normalizedMaxMessages = gmailSyncCoordinator.normalizeMaxMessages(maxMessages);
    int queuedAccounts = gmailSyncCoordinator.triggerAllConnectedAccounts(normalizedMaxMessages);
    return new GmailSyncRunAllResponse("started", normalizedMaxMessages, queuedAccounts);
  }

  @GetMapping("/status")
  public List<GmailSyncStatusResponse> status() {
    return gmailSyncCoordinator
      .listStatus()
      .stream()
      .map((status) ->
        new GmailSyncStatusResponse(
          status.accountId(),
          status.email(),
          status.status(),
          status.lastSyncAt(),
          status.lastError(),
          status.lastRunStartedAt()
        )
      )
      .toList();
  }
}
