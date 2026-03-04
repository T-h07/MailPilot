package com.mailpilot.api;

import com.mailpilot.api.model.FollowupActionRequest;
import com.mailpilot.api.model.FollowupStateResponse;
import com.mailpilot.api.model.FollowupUpdateRequest;
import com.mailpilot.api.model.FollowupUpdateResponse;
import com.mailpilot.service.FollowupService;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/followups")
public class FollowupController {

  private final FollowupService followupService;

  public FollowupController(FollowupService followupService) {
    this.followupService = followupService;
  }

  @GetMapping("/{messageId}")
  public FollowupStateResponse get(@PathVariable("messageId") UUID messageId) {
    return followupService.getFollowup(messageId);
  }

  @PutMapping("/{messageId}")
  public FollowupUpdateResponse upsert(
    @PathVariable("messageId") UUID messageId,
    @RequestBody FollowupUpdateRequest request
  ) {
    FollowupStateResponse followup = followupService.upsertFollowup(messageId, request);
    return new FollowupUpdateResponse("ok", followup);
  }

  @PostMapping("/{messageId}/actions")
  public FollowupUpdateResponse applyAction(
    @PathVariable("messageId") UUID messageId,
    @RequestBody FollowupActionRequest request
  ) {
    FollowupStateResponse followup = followupService.applyAction(messageId, request);
    return new FollowupUpdateResponse("ok", followup);
  }
}
