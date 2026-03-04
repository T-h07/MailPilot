package com.mailpilot.api;

import com.mailpilot.api.model.StatusResponse;
import com.mailpilot.api.model.ViewResponse;
import com.mailpilot.api.model.ViewUpsertRequest;
import com.mailpilot.service.ViewService;
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

  public ViewController(ViewService viewService) {
    this.viewService = viewService;
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
}
