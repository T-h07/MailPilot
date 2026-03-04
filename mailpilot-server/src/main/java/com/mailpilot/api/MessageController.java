package com.mailpilot.api;

import com.mailpilot.api.model.MessageDetailResponse;
import com.mailpilot.api.model.MessageReadRequest;
import com.mailpilot.api.model.StatusResponse;
import com.mailpilot.service.MessageService;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/messages")
public class MessageController {

  private final MessageService messageService;

  public MessageController(MessageService messageService) {
    this.messageService = messageService;
  }

  @GetMapping("/{id}")
  public MessageDetailResponse getById(@PathVariable("id") UUID id) {
    return messageService.getMessageDetail(id);
  }

  @PostMapping("/{id}/read")
  public StatusResponse setReadState(
    @PathVariable("id") UUID id,
    @Valid @RequestBody MessageReadRequest request
  ) {
    messageService.setUnread(id, request.isUnread());
    return new StatusResponse("ok");
  }
}
