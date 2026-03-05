package com.mailpilot.api;

import com.mailpilot.api.model.MessageViewLabelsUpdateRequest;
import com.mailpilot.api.model.StatusResponse;
import com.mailpilot.api.model.ViewLabelRequest;
import com.mailpilot.api.model.ViewLabelResponse;
import com.mailpilot.api.model.ViewResponse;
import com.mailpilot.api.model.ViewUpsertRequest;
import com.mailpilot.service.ViewService;
import com.mailpilot.service.ViewLabelService;
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
@RequestMapping("/api/views")
public class ViewController {

  private final ViewService viewService;
  private final ViewLabelService viewLabelService;

  public ViewController(ViewService viewService, ViewLabelService viewLabelService) {
    this.viewService = viewService;
    this.viewLabelService = viewLabelService;
  }

  @GetMapping
  public List<ViewResponse> listViews() {
    return viewService.listViews();
  }

  @GetMapping("/{id}")
  public ViewResponse getView(@PathVariable("id") UUID id) {
    return viewService.getView(id);
  }

  @PostMapping
  public ViewResponse createView(@RequestBody ViewUpsertRequest request) {
    return viewService.createView(request);
  }

  @PutMapping("/{id}")
  public ViewResponse updateView(@PathVariable("id") UUID id, @RequestBody ViewUpsertRequest request) {
    return viewService.updateView(id, request);
  }

  @DeleteMapping("/{id}")
  public StatusResponse deleteView(@PathVariable("id") UUID id) {
    viewService.deleteView(id);
    return new StatusResponse("ok");
  }

  @GetMapping("/{id}/labels")
  public List<ViewLabelResponse> listLabels(@PathVariable("id") UUID id) {
    return viewLabelService.listLabels(id);
  }

  @PostMapping("/{id}/labels")
  public ViewLabelResponse createLabel(@PathVariable("id") UUID id, @RequestBody ViewLabelRequest request) {
    return viewLabelService.createLabel(id, request);
  }

  @PutMapping("/{id}/labels/{labelId}")
  public ViewLabelResponse updateLabel(
    @PathVariable("id") UUID id,
    @PathVariable("labelId") UUID labelId,
    @RequestBody ViewLabelRequest request
  ) {
    return viewLabelService.updateLabel(id, labelId, request);
  }

  @DeleteMapping("/{id}/labels/{labelId}")
  public StatusResponse deleteLabel(@PathVariable("id") UUID id, @PathVariable("labelId") UUID labelId) {
    viewLabelService.deleteLabel(id, labelId);
    return new StatusResponse("ok");
  }

  @GetMapping("/{viewId}/messages/{messageId}/labels")
  public List<ViewLabelResponse> listMessageLabels(
    @PathVariable("viewId") UUID viewId,
    @PathVariable("messageId") UUID messageId
  ) {
    return viewLabelService.listMessageLabels(viewId, messageId);
  }

  @PutMapping("/{viewId}/messages/{messageId}/labels")
  public StatusResponse replaceMessageLabels(
    @PathVariable("viewId") UUID viewId,
    @PathVariable("messageId") UUID messageId,
    @RequestBody MessageViewLabelsUpdateRequest request
  ) {
    viewLabelService.replaceMessageLabels(viewId, messageId, request == null ? null : request.labelIds());
    return new StatusResponse("ok");
  }
}
