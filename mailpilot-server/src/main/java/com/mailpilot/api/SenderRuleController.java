package com.mailpilot.api;

import com.mailpilot.api.model.SenderRuleRequest;
import com.mailpilot.api.model.SenderRuleResponse;
import com.mailpilot.api.model.StatusResponse;
import com.mailpilot.service.SenderRuleService;
import java.util.List;
import java.util.UUID;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/sender-rules")
public class SenderRuleController {

  private final SenderRuleService senderRuleService;

  public SenderRuleController(SenderRuleService senderRuleService) {
    this.senderRuleService = senderRuleService;
  }

  @GetMapping
  public List<SenderRuleResponse> list() {
    return senderRuleService.listRules();
  }

  @PostMapping
  public SenderRuleResponse create(@RequestBody SenderRuleRequest request) {
    return senderRuleService.createRule(request);
  }

  @PutMapping("/{id}")
  public SenderRuleResponse update(@PathVariable("id") UUID id, @RequestBody SenderRuleRequest request) {
    return senderRuleService.updateRule(id, request);
  }

  @DeleteMapping("/{id}")
  public StatusResponse delete(@PathVariable("id") UUID id) {
    senderRuleService.deleteRule(id);
    return new StatusResponse("ok");
  }
}
