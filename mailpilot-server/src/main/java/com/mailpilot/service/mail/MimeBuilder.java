package com.mailpilot.service.mail;

import jakarta.activation.DataHandler;
import jakarta.mail.Message;
import jakarta.mail.MessagingException;
import jakarta.mail.Part;
import jakarta.mail.Session;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeBodyPart;
import jakarta.mail.internet.MimeMessage;
import jakarta.mail.internet.MimeMultipart;
import jakarta.mail.internet.MimeUtility;
import jakarta.mail.util.ByteArrayDataSource;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.List;
import java.util.Properties;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

@Component
public class MimeBuilder {

  public MimeBuildResult build(MimeBuildRequest request) {
    try {
      Session session = Session.getInstance(new Properties());
      MimeMessage message = new MimeMessage(session);

      message.setFrom(buildFromAddress(request.fromEmail(), request.fromDisplayName()));
      setRecipients(message, Message.RecipientType.TO, request.to());
      setRecipients(message, Message.RecipientType.CC, request.cc());
      setRecipients(message, Message.RecipientType.BCC, request.bcc());

      String subject = StringUtils.hasText(request.subject()) ? request.subject().trim() : "(no subject)";
      message.setSubject(subject, StandardCharsets.UTF_8.name());
      message.setSentDate(new Date());

      if (StringUtils.hasText(request.inReplyTo())) {
        message.setHeader("In-Reply-To", normalizeMessageId(request.inReplyTo()));
      }
      if (StringUtils.hasText(request.references())) {
        message.setHeader("References", request.references().trim());
      }

      setContent(message, request.bodyText(), request.bodyHtml(), request.attachments());
      message.saveChanges();

      ByteArrayOutputStream output = new ByteArrayOutputStream();
      message.writeTo(output);
      String messageId = message.getHeader("Message-ID", null);
      return new MimeBuildResult(output.toByteArray(), normalizeMessageIdNullable(messageId));
    } catch (Exception exception) {
      throw new IllegalStateException("Failed to build RFC822 MIME payload.", exception);
    }
  }

  private InternetAddress buildFromAddress(String email, String displayName) throws Exception {
    if (StringUtils.hasText(displayName)) {
      return new InternetAddress(email, displayName, StandardCharsets.UTF_8.name());
    }
    return new InternetAddress(email);
  }

  private void setRecipients(MimeMessage message, Message.RecipientType type, List<String> recipients)
    throws MessagingException {
    if (recipients == null || recipients.isEmpty()) {
      return;
    }
    InternetAddress[] addresses = recipients.stream().map(this::toInternetAddress).toArray(InternetAddress[]::new);
    message.setRecipients(type, addresses);
  }

  private InternetAddress toInternetAddress(String value) {
    try {
      return new InternetAddress(value, true);
    } catch (MessagingException exception) {
      throw new IllegalStateException("Invalid recipient email: " + value);
    }
  }

  private void setContent(
    MimeMessage message,
    String bodyText,
    String bodyHtml,
    List<MimeAttachment> attachments
  ) throws Exception {
    String resolvedText = bodyText == null ? "" : bodyText;
    boolean hasHtml = StringUtils.hasText(bodyHtml);
    boolean hasAttachments = attachments != null && !attachments.isEmpty();

    if (!hasAttachments) {
      if (hasHtml) {
        message.setContent(buildAlternativePart(resolvedText, bodyHtml));
      } else {
        message.setText(resolvedText, StandardCharsets.UTF_8.name());
      }
      return;
    }

    MimeMultipart mixed = new MimeMultipart("mixed");
    MimeBodyPart contentPart = new MimeBodyPart();
    if (hasHtml) {
      contentPart.setContent(buildAlternativePart(resolvedText, bodyHtml));
    } else {
      contentPart.setText(resolvedText, StandardCharsets.UTF_8.name());
    }
    mixed.addBodyPart(contentPart);

    for (MimeAttachment attachment : attachments) {
      MimeBodyPart attachmentPart = new MimeBodyPart();
      String mimeType = StringUtils.hasText(attachment.mimeType())
        ? attachment.mimeType().trim()
        : "application/octet-stream";
      ByteArrayDataSource dataSource = new ByteArrayDataSource(attachment.bytes(), mimeType);
      attachmentPart.setDataHandler(new DataHandler(dataSource));
      attachmentPart.setDisposition(Part.ATTACHMENT);
      String fileName = StringUtils.hasText(attachment.filename()) ? attachment.filename().trim() : "attachment.bin";
      attachmentPart.setFileName(MimeUtility.encodeText(fileName, StandardCharsets.UTF_8.name(), null));
      mixed.addBodyPart(attachmentPart);
    }

    message.setContent(mixed);
  }

  private MimeMultipart buildAlternativePart(String bodyText, String bodyHtml) throws Exception {
    MimeMultipart alternative = new MimeMultipart("alternative");

    MimeBodyPart textPart = new MimeBodyPart();
    textPart.setText(bodyText == null ? "" : bodyText, StandardCharsets.UTF_8.name());
    alternative.addBodyPart(textPart);

    MimeBodyPart htmlPart = new MimeBodyPart();
    htmlPart.setContent(bodyHtml, "text/html; charset=UTF-8");
    alternative.addBodyPart(htmlPart);

    return alternative;
  }

  private String normalizeMessageId(String value) {
    String trimmed = value.trim();
    if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
      return trimmed;
    }
    return "<" + trimmed.replaceAll("[<>]", "") + ">";
  }

  private String normalizeMessageIdNullable(String value) {
    if (!StringUtils.hasText(value)) {
      return null;
    }
    return normalizeMessageId(value);
  }

  public record MimeBuildRequest(
    String fromEmail,
    String fromDisplayName,
    List<String> to,
    List<String> cc,
    List<String> bcc,
    String subject,
    String bodyText,
    String bodyHtml,
    String inReplyTo,
    String references,
    List<MimeAttachment> attachments
  ) {}

  public record MimeAttachment(String filename, String mimeType, byte[] bytes) {}

  public record MimeBuildResult(byte[] rawBytes, String messageId) {}
}
