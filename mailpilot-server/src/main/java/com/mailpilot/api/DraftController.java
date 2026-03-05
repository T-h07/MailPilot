package com.mailpilot.api;

import com.mailpilot.api.model.DraftDetailResponse;
import com.mailpilot.api.model.DraftListItemResponse;
import com.mailpilot.api.model.DraftUpsertRequest;
import com.mailpilot.api.model.StatusResponse;
import com.mailpilot.service.DraftService;
import java.util.List;
import java.util.UUID;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/drafts")
public class DraftController {

  private final DraftService draftService;

  public DraftController(DraftService draftService) {
    this.draftService = draftService;
  }

  @GetMapping
  public List<DraftListItemResponse> listDrafts(
    @RequestParam(name = "accountId", required = false) UUID accountId,
    @RequestParam(name = "q", required = false) String q,
    @RequestParam(name = "sort", required = false) String sort
  ) {
    return draftService.listDrafts(accountId, q, sort);
  }

  @GetMapping("/{id}")
  public DraftDetailResponse getDraft(@PathVariable("id") UUID id) {
    return draftService.getDraft(id);
  }

  @PostMapping
  public DraftDetailResponse createDraft(@RequestBody DraftUpsertRequest request) {
    return draftService.createDraft(request);
  }

  @PutMapping("/{id}")
  public StatusResponse updateDraft(@PathVariable("id") UUID id, @RequestBody DraftUpsertRequest request) {
    draftService.updateDraft(id, request);
    return new StatusResponse("ok");
  }

  @DeleteMapping("/{id}")
  public StatusResponse deleteDraft(@PathVariable("id") UUID id) {
    draftService.deleteDraft(id);
    return new StatusResponse("ok");
  }
}
