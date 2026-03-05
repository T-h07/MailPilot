package com.mailpilot.api;

import com.mailpilot.api.model.MessageRepairResponse;
import com.mailpilot.service.sync.GmailSyncService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/dev")
public class DevController {

  private final GmailSyncService gmailSyncService;

  public DevController(GmailSyncService gmailSyncService) {
    this.gmailSyncService = gmailSyncService;
  }

  @PostMapping("/repair/messages")
  public MessageRepairResponse repairMessages(
    @RequestParam(name = "days", defaultValue = "30") int days
  ) {
    GmailSyncService.RepairResult result = gmailSyncService.repairMessageMetadata(days);
    return new MessageRepairResponse(result.status(), result.updated(), result.skipped());
  }
}
