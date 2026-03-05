package com.mailpilot.service;

import com.mailpilot.api.error.ApiBadRequestException;
import com.mailpilot.api.error.ApiConflictException;
import com.mailpilot.api.error.ApiNotFoundException;
import com.mailpilot.service.gmail.GmailClient;
import com.mailpilot.service.gmail.GmailClient.GmailApiException;
import com.mailpilot.service.gmail.GmailClient.GmailMessageResponse;
import com.mailpilot.service.gmail.GmailClient.GmailPayload;
import com.mailpilot.service.gmail.GmailClient.GmailSendResponse;
import com.mailpilot.service.gmail.GmailClient.GmailUnauthorizedException;
import com.mailpilot.service.mail.MimeBuilder;
import com.mailpilot.service.mail.MimeBuilder.MimeAttachment;
import com.mailpilot.service.mail.MimeBuilder.MimeBuildRequest;
import com.mailpilot.service.mail.MimeBuilder.MimeBuildResult;
import com.mailpilot.service.oauth.TokenService;
import com.mailpilot.service.sync.GmailSyncCoordinator;
import jakarta.mail.internet.InternetAddress;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class MailSendService {

  private static final Logger LOGGER = LoggerFactory.getLogger(MailSendService.class);

  private static final String GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
  private static final int SYNC_AFTER_SEND_MAX_MESSAGES = 50;

  private final JdbcTemplate jdbcTemplate;
  private final TokenService tokenService;
  private final GmailClient gmailClient;
  private final MimeBuilder mimeBuilder;
  private final GmailSyncCoordinator gmailSyncCoordinator;

  public MailSendService(
    JdbcTemplate jdbcTemplate,
    TokenService tokenService,
    GmailClient gmailClient,
    MimeBuilder mimeBuilder,
    GmailSyncCoordinator gmailSyncCoordinator
  ) {
    this.jdbcTemplate = jdbcTemplate;
    this.tokenService = tokenService;
    this.gmailClient = gmailClient;
    this.mimeBuilder = mimeBuilder;
    this.gmailSyncCoordinator = gmailSyncCoordinator;
  }

  public SendResult send(MailSendCommand command) {
    if (command == null) {
      throw new ApiBadRequestException("Invalid request");
    }

    SendMode mode = SendMode.fromInput(command.mode());
    AccountRow account = loadAccount(command.accountId());
    if (!"GMAIL".equalsIgnoreCase(account.provider())) {
      throw new ApiBadRequestException("Account provider must be GMAIL");
    }
    if (!canSend(account.scope(), account.refreshTokenEncrypted())) {
      throw new ApiConflictException("Re-auth required to send email (missing gmail.send scope).");
    }

    OriginalContext original = mode == SendMode.NEW ? null : loadOriginalContext(command, account.id());
    ComposePlan composePlan = buildComposePlan(command, mode, account, original);

    MimeBuildResult mimePayload = mimeBuilder.build(
      new MimeBuildRequest(
        account.email(),
        account.displayName(),
        composePlan.to(),
        composePlan.cc(),
        composePlan.bcc(),
        composePlan.subject(),
        composePlan.bodyText(),
        composePlan.bodyHtml(),
        composePlan.inReplyTo(),
        composePlan.references(),
        composePlan.attachments()
      )
    );

    String encodedRaw = Base64.getUrlEncoder().withoutPadding().encodeToString(mimePayload.rawBytes());
    GmailSendResponse gmailSendResponse = executeWithTokenRetry(
      account.id(),
      (accessToken) -> gmailClient.sendMessage(accessToken, encodedRaw, composePlan.providerThreadId())
    );

    OffsetDateTime sentAt = OffsetDateTime.now(ZoneOffset.UTC);
    persistSentMessage(account, composePlan, gmailSendResponse, mimePayload, sentAt);
    triggerLightweightSync(account.id());

    return new SendResult(
      "ok",
      gmailSendResponse.id(),
      firstNonBlank(gmailSendResponse.threadId(), composePlan.providerThreadId()),
      sentAt
    );
  }

  private ComposePlan buildComposePlan(
    MailSendCommand command,
    SendMode mode,
    AccountRow account,
    OriginalContext original
  ) {
    List<String> to = parseRecipients(command.to(), "to");
    List<String> cc = parseRecipients(command.cc(), "cc");
    List<String> bcc = parseRecipients(command.bcc(), "bcc");

    String bodyText = command.bodyText() == null ? "" : command.bodyText();
    String bodyHtml = normalizeNullable(command.bodyHtml());
    List<MimeAttachment> attachments = mapAttachments(command.attachments());

    return switch (mode) {
      case NEW -> {
        String subject = normalizeSubject(command.subject(), true, null, mode);
        if (to.isEmpty()) {
          throw new ApiBadRequestException("To is required for new email.");
        }
        yield new ComposePlan(
          mode,
          to,
          cc,
          bcc,
          subject,
          bodyText,
          bodyHtml,
          null,
          null,
          null,
          null,
          attachments
        );
      }
      case REPLY -> {
        if (original == null) {
          throw new ApiBadRequestException("replyToMessageDbId is required for reply mode.");
        }
        if (to.isEmpty() && StringUtils.hasText(original.senderEmail())) {
          to = List.of(original.senderEmail());
        }
        if (to.isEmpty()) {
          throw new ApiBadRequestException("Unable to determine reply recipient.");
        }

        String subject = normalizeSubject(command.subject(), false, original.subject(), mode);
        String inReplyTo = normalizeMessageIdNullable(original.messageRfc822Id());
        String references = buildReferences(original.referencesHeader(), inReplyTo);

        yield new ComposePlan(
          mode,
          to,
          cc,
          bcc,
          subject,
          bodyText,
          bodyHtml,
          inReplyTo,
          references,
          original.providerThreadId(),
          original.threadId(),
          attachments
        );
      }
      case REPLY_ALL -> {
        if (original == null) {
          throw new ApiBadRequestException("replyToMessageDbId is required for reply-all mode.");
        }

        if (to.isEmpty() && cc.isEmpty()) {
          ReplyAllRecipients replyAllRecipients = buildReplyAllRecipients(original, account.email());
          to = replyAllRecipients.to();
          cc = replyAllRecipients.cc();
        }
        if (to.isEmpty()) {
          throw new ApiBadRequestException("Unable to determine recipients for reply-all. Provide To manually.");
        }

        String subject = normalizeSubject(command.subject(), false, original.subject(), mode);
        String inReplyTo = normalizeMessageIdNullable(original.messageRfc822Id());
        String references = buildReferences(original.referencesHeader(), inReplyTo);

        yield new ComposePlan(
          mode,
          to,
          cc,
          bcc,
          subject,
          bodyText,
          bodyHtml,
          inReplyTo,
          references,
          original.providerThreadId(),
          original.threadId(),
          attachments
        );
      }
      case FORWARD -> {
        if (original == null) {
          throw new ApiBadRequestException("replyToMessageDbId is required for forward mode.");
        }
        if (to.isEmpty()) {
          throw new ApiBadRequestException("To is required when forwarding.");
        }

        String subject = normalizeSubject(command.subject(), false, original.subject(), mode);
        yield new ComposePlan(
          mode,
          to,
          cc,
          bcc,
          subject,
          bodyText,
          bodyHtml,
          null,
          null,
          original.providerThreadId(),
          original.threadId(),
          attachments
        );
      }
    };
  }

  private ReplyAllRecipients buildReplyAllRecipients(OriginalContext original, String accountEmail) {
    List<String> to = new ArrayList<>();
    List<String> cc = new ArrayList<>();
    Set<String> seen = new LinkedHashSet<>();
    String ownEmail = normalizeEmail(accountEmail);

    addRecipient(to, seen, ownEmail, original.senderEmail());
    for (String recipient : original.originalToRecipients()) {
      addRecipient(to, seen, ownEmail, recipient);
    }
    for (String recipient : original.originalCcRecipients()) {
      addRecipient(cc, seen, ownEmail, recipient);
    }

    if (to.isEmpty() && !cc.isEmpty()) {
      to.add(cc.removeFirst());
    }

    return new ReplyAllRecipients(List.copyOf(to), List.copyOf(cc));
  }

  private void addRecipient(List<String> target, Set<String> seen, String ownEmail, String rawEmail) {
    String normalized = normalizeEmail(rawEmail);
    if (!StringUtils.hasText(normalized)) {
      return;
    }
    if (normalized.equals(ownEmail)) {
      return;
    }
    if (seen.add(normalized)) {
      target.add(normalized);
    }
  }

  private List<MimeAttachment> mapAttachments(List<MailAttachmentInput> inputs) {
    if (inputs == null || inputs.isEmpty()) {
      return List.of();
    }
    List<MimeAttachment> mapped = new ArrayList<>(inputs.size());
    for (MailAttachmentInput input : inputs) {
      if (input == null || input.bytes() == null || input.bytes().length == 0) {
        continue;
      }
      String filename = StringUtils.hasText(input.filename()) ? input.filename().trim() : "attachment.bin";
      String mimeType = normalizeNullable(input.mimeType());
      mapped.add(new MimeAttachment(filename, mimeType, input.bytes()));
    }
    return List.copyOf(mapped);
  }

  private OriginalContext loadOriginalContext(MailSendCommand command, UUID expectedAccountId) {
    if (command.replyToMessageDbId() == null) {
      throw new ApiBadRequestException("replyToMessageDbId is required for this mode.");
    }

    OriginalMessageRow row = jdbcTemplate.query(
      """
      SELECT
        m.id,
        m.account_id,
        m.thread_id,
        m.provider_message_id,
        m.message_rfc822_id,
        COALESCE(m.subject, '(no subject)') AS subject,
        m.sender_email,
        t.provider_thread_id
      FROM messages m
      LEFT JOIN threads t ON t.id = m.thread_id
      WHERE m.id = ?
      """,
      (resultSet, rowNum) ->
        new OriginalMessageRow(
          resultSet.getObject("id", UUID.class),
          resultSet.getObject("account_id", UUID.class),
          resultSet.getObject("thread_id", UUID.class),
          resultSet.getString("provider_message_id"),
          resultSet.getString("message_rfc822_id"),
          resultSet.getString("subject"),
          resultSet.getString("sender_email"),
          resultSet.getString("provider_thread_id")
        ),
      command.replyToMessageDbId()
    ).stream().findFirst().orElseThrow(() -> new ApiNotFoundException("Original message not found"));

    if (!expectedAccountId.equals(row.accountId())) {
      throw new ApiBadRequestException("replyToMessageDbId does not belong to the selected account.");
    }

    Map<String, String> headers = fetchOriginalHeaders(row.accountId(), row.providerMessageId());
    String rfc822Id = firstNonBlank(
      normalizeMessageIdNullable(row.messageRfc822Id()),
      normalizeMessageIdNullable(headers.get("message-id"))
    );

    String references = normalizeNullable(headers.get("references"));
    List<String> originalTo = parseHeaderRecipients(headers.get("to"));
    List<String> originalCc = parseHeaderRecipients(headers.get("cc"));

    return new OriginalContext(
      row.id(),
      row.threadId(),
      row.providerThreadId(),
      row.subject(),
      row.senderEmail(),
      rfc822Id,
      references,
      originalTo,
      originalCc
    );
  }

  private Map<String, String> fetchOriginalHeaders(UUID accountId, String providerMessageId) {
    if (!StringUtils.hasText(providerMessageId)) {
      return Map.of();
    }

    try {
      GmailMessageResponse message = executeWithTokenRetry(
        accountId,
        (accessToken) -> gmailClient.getMessage(accessToken, providerMessageId)
      );
      return extractHeaders(message.payload());
    } catch (GmailApiException exception) {
      LOGGER.warn("Unable to load Gmail metadata for reply context: {}", exception.getMessage());
      return Map.of();
    }
  }

  private Map<String, String> extractHeaders(GmailPayload payload) {
    if (payload == null || payload.headers() == null || payload.headers().isEmpty()) {
      return Map.of();
    }
    Map<String, String> headers = new HashMap<>();
    payload
      .headers()
      .forEach((header) -> {
        if (header == null || !StringUtils.hasText(header.name()) || !StringUtils.hasText(header.value())) {
          return;
        }
        headers.put(header.name().trim().toLowerCase(Locale.ROOT), header.value().trim());
      });
    return headers;
  }

  private AccountRow loadAccount(UUID accountId) {
    if (accountId == null) {
      throw new ApiBadRequestException("accountId is required.");
    }

    return jdbcTemplate.query(
      """
      SELECT
        a.id,
        a.provider,
        a.email,
        a.display_name,
        ot.scope,
        ot.refresh_token_enc
      FROM accounts a
      LEFT JOIN oauth_tokens ot ON ot.account_id = a.id
      WHERE a.id = ?
      """,
      (resultSet, rowNum) ->
        new AccountRow(
          resultSet.getObject("id", UUID.class),
          resultSet.getString("provider"),
          resultSet.getString("email"),
          resultSet.getString("display_name"),
          resultSet.getString("scope"),
          resultSet.getString("refresh_token_enc")
        ),
      accountId
    ).stream().findFirst().orElseThrow(() -> new ApiBadRequestException("Account not found"));
  }

  private void persistSentMessage(
    AccountRow account,
    ComposePlan plan,
    GmailSendResponse gmailSendResponse,
    MimeBuildResult mimePayload,
    OffsetDateTime sentAt
  ) {
    String providerThreadId = firstNonBlank(
      gmailSendResponse.threadId(),
      plan.providerThreadId(),
      gmailSendResponse.id()
    );

    UUID threadId = null;
    if (StringUtils.hasText(providerThreadId)) {
      threadId = upsertThread(account.id(), providerThreadId, plan.subject(), sentAt);
    } else if (plan.localThreadId() != null) {
      threadId = plan.localThreadId();
    }

    String senderDomain = deriveDomain(account.email());
    String senderName = StringUtils.hasText(account.displayName()) ? account.displayName() : localPart(account.email());
    String bodyCache = StringUtils.hasText(plan.bodyText()) ? plan.bodyText() : null;
    String snippet = buildSnippet(plan.bodyText());
    boolean hasAttachments = !plan.attachments().isEmpty();

    UUID messageId = jdbcTemplate.queryForObject(
      """
      INSERT INTO messages (
        account_id,
        thread_id,
        provider_message_id,
        message_rfc822_id,
        sender_name,
        sender_email,
        sender_domain,
        subject,
        snippet,
        received_at,
        gmail_internal_date_ms,
        gmail_label_ids,
        is_read,
        is_inbox,
        is_sent,
        is_draft,
        has_attachments,
        body_cache,
        body_cache_mime
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ARRAY['SENT']::text[], true, false, true, false, ?, ?, 'text/plain')
      ON CONFLICT (account_id, provider_message_id)
      DO UPDATE SET
        thread_id = COALESCE(EXCLUDED.thread_id, messages.thread_id),
        message_rfc822_id = COALESCE(EXCLUDED.message_rfc822_id, messages.message_rfc822_id),
        sender_name = EXCLUDED.sender_name,
        sender_email = EXCLUDED.sender_email,
        sender_domain = EXCLUDED.sender_domain,
        subject = EXCLUDED.subject,
        snippet = EXCLUDED.snippet,
        received_at = EXCLUDED.received_at,
        gmail_internal_date_ms = EXCLUDED.gmail_internal_date_ms,
        gmail_label_ids = EXCLUDED.gmail_label_ids,
        is_read = true,
        is_inbox = false,
        is_sent = true,
        is_draft = false,
        has_attachments = EXCLUDED.has_attachments,
        body_cache = COALESCE(EXCLUDED.body_cache, messages.body_cache),
        body_cache_mime = COALESCE(EXCLUDED.body_cache_mime, messages.body_cache_mime)
      RETURNING id
      """,
      UUID.class,
      account.id(),
      threadId,
      gmailSendResponse.id(),
      mimePayload.messageId(),
      senderName,
      account.email(),
      senderDomain,
      plan.subject(),
      snippet,
      sentAt,
      sentAt.toInstant().toEpochMilli(),
      hasAttachments,
      bodyCache
    );

    if (messageId == null) {
      throw new IllegalStateException("Failed to persist sent message.");
    }

    upsertSentAttachments(messageId, plan.attachments());
  }

  private UUID upsertThread(
    UUID accountId,
    String providerThreadId,
    String subject,
    OffsetDateTime sentAt
  ) {
    UUID threadId = jdbcTemplate.queryForObject(
      """
      INSERT INTO threads (account_id, provider_thread_id, subject, last_message_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (account_id, provider_thread_id)
      DO UPDATE SET
        subject = COALESCE(threads.subject, EXCLUDED.subject),
        last_message_at = GREATEST(COALESCE(threads.last_message_at, EXCLUDED.last_message_at), EXCLUDED.last_message_at)
      RETURNING id
      """,
      UUID.class,
      accountId,
      providerThreadId,
      subject,
      sentAt
    );

    if (threadId == null) {
      throw new IllegalStateException("Failed to upsert thread");
    }
    return threadId;
  }

  private void upsertSentAttachments(UUID messageId, List<MimeAttachment> attachments) {
    for (MimeAttachment attachment : attachments) {
      String filename = StringUtils.hasText(attachment.filename()) ? attachment.filename().trim() : "attachment.bin";
      long sizeBytes = attachment.bytes().length;
      String mimeType = normalizeNullable(attachment.mimeType());

      UUID existingId = jdbcTemplate.query(
        """
        SELECT id
        FROM attachments
        WHERE message_id = ?
          AND provider_attachment_id IS NULL
          AND filename = ?
          AND size_bytes = ?
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (resultSet, rowNum) -> resultSet.getObject("id", UUID.class),
        messageId,
        filename,
        sizeBytes
      ).stream().findFirst().orElse(null);

      if (existingId != null) {
        jdbcTemplate.update(
          "UPDATE attachments SET mime_type = ? WHERE id = ?",
          mimeType,
          existingId
        );
      } else {
        jdbcTemplate.update(
          """
          INSERT INTO attachments (message_id, provider_attachment_id, filename, mime_type, size_bytes)
          VALUES (?, NULL, ?, ?, ?)
          """,
          messageId,
          filename,
          mimeType,
          sizeBytes
        );
      }
    }
  }

  private void triggerLightweightSync(UUID accountId) {
    try {
      gmailSyncCoordinator.triggerAccountSync(accountId, SYNC_AFTER_SEND_MAX_MESSAGES);
    } catch (Exception exception) {
      LOGGER.warn("Unable to trigger post-send incremental sync: {}", exception.getMessage());
    }
  }

  private <T> T executeWithTokenRetry(UUID accountId, Function<String, T> call) {
    String accessToken = tokenService.getValidAccessToken(accountId).accessToken();
    try {
      return call.apply(accessToken);
    } catch (GmailUnauthorizedException unauthorizedException) {
      String refreshedAccessToken = tokenService.refreshAccessToken(accountId).accessToken();
      return call.apply(refreshedAccessToken);
    }
  }

  private boolean canSend(String scope, String refreshTokenEncrypted) {
    if (!StringUtils.hasText(refreshTokenEncrypted)) {
      return false;
    }
    return hasScope(scope, GMAIL_SEND_SCOPE);
  }

  private boolean hasScope(String scopeValue, String requiredScope) {
    if (!StringUtils.hasText(scopeValue)) {
      return false;
    }
    String required = requiredScope.toLowerCase(Locale.ROOT);
    for (String scope : scopeValue.trim().split("\\s+")) {
      if (required.equals(scope.toLowerCase(Locale.ROOT))) {
        return true;
      }
    }
    return false;
  }

  private List<String> parseRecipients(String rawValue, String field) {
    if (!StringUtils.hasText(rawValue)) {
      return List.of();
    }

    try {
      InternetAddress[] addresses = InternetAddress.parse(rawValue, true);
      List<String> parsed = new ArrayList<>();
      Set<String> seen = new LinkedHashSet<>();
      for (InternetAddress address : addresses) {
        if (address == null) {
          continue;
        }
        String normalized = normalizeEmail(address.getAddress());
        if (!StringUtils.hasText(normalized) || !seen.add(normalized)) {
          continue;
        }
        parsed.add(normalized);
      }
      return List.copyOf(parsed);
    } catch (Exception exception) {
      throw new ApiBadRequestException("Invalid recipient in " + field + ".");
    }
  }

  private List<String> parseHeaderRecipients(String rawValue) {
    if (!StringUtils.hasText(rawValue)) {
      return List.of();
    }

    try {
      InternetAddress[] addresses = InternetAddress.parse(rawValue, false);
      List<String> parsed = new ArrayList<>();
      Set<String> seen = new LinkedHashSet<>();
      for (InternetAddress address : addresses) {
        if (address == null) {
          continue;
        }
        String normalized = normalizeEmail(address.getAddress());
        if (!StringUtils.hasText(normalized) || !seen.add(normalized)) {
          continue;
        }
        parsed.add(normalized);
      }
      return List.copyOf(parsed);
    } catch (Exception exception) {
      return List.of();
    }
  }

  private String normalizeSubject(String provided, boolean required, String baseSubject, SendMode mode) {
    if (StringUtils.hasText(provided)) {
      return provided.trim();
    }

    if (mode == SendMode.NEW) {
      if (required) {
        throw new ApiBadRequestException("subject is required for new email.");
      }
      return "(no subject)";
    }

    String original = StringUtils.hasText(baseSubject) ? baseSubject.trim() : "(no subject)";
    if (mode == SendMode.REPLY || mode == SendMode.REPLY_ALL) {
      if (original.toLowerCase(Locale.ROOT).startsWith("re:")) {
        return original;
      }
      return "Re: " + original;
    }
    if (original.toLowerCase(Locale.ROOT).startsWith("fwd:") || original.toLowerCase(Locale.ROOT).startsWith("fw:")) {
      return original;
    }
    return "Fwd: " + original;
  }

  private String buildReferences(String existingReferences, String messageIdHeader) {
    if (!StringUtils.hasText(messageIdHeader)) {
      return normalizeNullable(existingReferences);
    }
    String normalizedMessageId = normalizeMessageIdNullable(messageIdHeader);
    if (!StringUtils.hasText(existingReferences)) {
      return normalizedMessageId;
    }
    String trimmed = existingReferences.trim();
    if (trimmed.contains(normalizedMessageId)) {
      return trimmed;
    }
    return trimmed + " " + normalizedMessageId;
  }

  private String buildSnippet(String bodyText) {
    if (!StringUtils.hasText(bodyText)) {
      return "";
    }
    String normalized = bodyText.replace('\r', ' ').replace('\n', ' ').trim().replaceAll("\\s+", " ");
    if (normalized.length() <= 120) {
      return normalized;
    }
    return normalized.substring(0, 120);
  }

  private String deriveDomain(String email) {
    if (!StringUtils.hasText(email) || !email.contains("@")) {
      return "unknown.invalid";
    }
    return email.substring(email.indexOf('@') + 1).toLowerCase(Locale.ROOT);
  }

  private String localPart(String email) {
    if (!StringUtils.hasText(email) || !email.contains("@")) {
      return "mailpilot";
    }
    return email.substring(0, email.indexOf('@'));
  }

  private String normalizeEmail(String raw) {
    if (!StringUtils.hasText(raw)) {
      return null;
    }
    String trimmed = raw.trim().toLowerCase(Locale.ROOT);
    return trimmed.isBlank() ? null : trimmed;
  }

  private String normalizeNullable(String value) {
    if (!StringUtils.hasText(value)) {
      return null;
    }
    String trimmed = value.trim();
    return trimmed.isEmpty() ? null : trimmed;
  }

  private String normalizeMessageIdNullable(String value) {
    if (!StringUtils.hasText(value)) {
      return null;
    }
    String trimmed = value.trim();
    if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
      return trimmed;
    }
    return "<" + trimmed.replaceAll("[<>]", "") + ">";
  }

  private String firstNonBlank(String... values) {
    for (String value : values) {
      if (StringUtils.hasText(value)) {
        return value.trim();
      }
    }
    return null;
  }

  private enum SendMode {
    NEW,
    REPLY,
    REPLY_ALL,
    FORWARD,
    ;

    private static SendMode fromInput(String value) {
      if (!StringUtils.hasText(value)) {
        throw new ApiBadRequestException("mode is required.");
      }
      try {
        return SendMode.valueOf(value.trim().toUpperCase(Locale.ROOT));
      } catch (IllegalArgumentException exception) {
        throw new ApiBadRequestException("mode must be one of NEW, REPLY, REPLY_ALL, FORWARD.");
      }
    }
  }

  public record MailSendCommand(
    UUID accountId,
    String to,
    String cc,
    String bcc,
    String subject,
    String bodyText,
    String bodyHtml,
    UUID replyToMessageDbId,
    String mode,
    List<MailAttachmentInput> attachments
  ) {}

  public record MailAttachmentInput(String filename, String mimeType, byte[] bytes) {}

  public record SendResult(
    String status,
    String providerMessageId,
    String providerThreadId,
    OffsetDateTime sentAt
  ) {}

  private record AccountRow(
    UUID id,
    String provider,
    String email,
    String displayName,
    String scope,
    String refreshTokenEncrypted
  ) {}

  private record OriginalMessageRow(
    UUID id,
    UUID accountId,
    UUID threadId,
    String providerMessageId,
    String messageRfc822Id,
    String subject,
    String senderEmail,
    String providerThreadId
  ) {}

  private record OriginalContext(
    UUID messageId,
    UUID threadId,
    String providerThreadId,
    String subject,
    String senderEmail,
    String messageRfc822Id,
    String referencesHeader,
    List<String> originalToRecipients,
    List<String> originalCcRecipients
  ) {}

  private record ComposePlan(
    SendMode mode,
    List<String> to,
    List<String> cc,
    List<String> bcc,
    String subject,
    String bodyText,
    String bodyHtml,
    String inReplyTo,
    String references,
    String providerThreadId,
    UUID localThreadId,
    List<MimeAttachment> attachments
  ) {}

  private record ReplyAllRecipients(List<String> to, List<String> cc) {}
}
