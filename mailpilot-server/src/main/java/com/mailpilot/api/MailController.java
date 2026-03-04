package com.mailpilot.api;

import com.mailpilot.api.model.SendMailResponse;
import com.mailpilot.service.MailSendService;
import com.mailpilot.service.MailSendService.MailAttachmentInput;
import com.mailpilot.service.MailSendService.MailSendCommand;
import com.mailpilot.service.MailSendService.SendResult;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/mail")
public class MailController {

  private final MailSendService mailSendService;

  public MailController(MailSendService mailSendService) {
    this.mailSendService = mailSendService;
  }

  @PostMapping(value = "/send", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  public SendMailResponse send(
    @RequestParam("accountId") UUID accountId,
    @RequestParam("to") String to,
    @RequestParam(value = "cc", required = false) String cc,
    @RequestParam(value = "bcc", required = false) String bcc,
    @RequestParam(value = "subject", required = false) String subject,
    @RequestParam(value = "bodyText", required = false) String bodyText,
    @RequestParam(value = "bodyHtml", required = false) String bodyHtml,
    @RequestParam(value = "replyToMessageDbId", required = false) UUID replyToMessageDbId,
    @RequestParam("mode") String mode,
    @RequestPart(value = "attachments", required = false) List<MultipartFile> attachments
  ) {
    SendResult result = mailSendService.send(
      new MailSendCommand(
        accountId,
        to,
        cc,
        bcc,
        subject,
        bodyText,
        bodyHtml,
        replyToMessageDbId,
        mode,
        toAttachmentInputs(attachments)
      )
    );
    return new SendMailResponse(
      result.status(),
      result.providerMessageId(),
      result.providerThreadId(),
      result.sentAt()
    );
  }

  private List<MailAttachmentInput> toAttachmentInputs(List<MultipartFile> attachments) {
    if (attachments == null || attachments.isEmpty()) {
      return List.of();
    }

    List<MailAttachmentInput> mapped = new ArrayList<>();
    for (MultipartFile file : attachments) {
      if (file == null || file.isEmpty()) {
        continue;
      }
      try {
        String fileName = file.getOriginalFilename();
        String mimeType = file.getContentType();
        mapped.add(new MailAttachmentInput(fileName, mimeType, file.getBytes()));
      } catch (IOException exception) {
        throw new IllegalStateException("Unable to read attachment bytes.");
      }
    }
    return List.copyOf(mapped);
  }
}
