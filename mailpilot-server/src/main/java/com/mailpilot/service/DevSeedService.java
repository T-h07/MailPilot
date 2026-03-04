package com.mailpilot.service;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Random;
import java.util.UUID;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Profile("dev")
public class DevSeedService {

  private static final int DEFAULT_SEED_MESSAGES = 2500;

  private static final List<SeedAccount> SEED_ACCOUNTS = List.of(
    new SeedAccount(
      UUID.fromString("2d387131-a3a9-4c36-b9df-9a72f7269f4c"),
      "work.pilot@mailpilot.dev",
      "Work Pilot"
    ),
    new SeedAccount(
      UUID.fromString("cf2939f3-d179-4a2a-ad8b-b5ad6e2fd560"),
      "growth.pilot@mailpilot.dev",
      "Growth Pilot"
    ),
    new SeedAccount(
      UUID.fromString("f70a6dd4-ec89-41a1-a5f5-9ef22f4f4f9a"),
      "network.pilot@mailpilot.dev",
      "Network Pilot"
    )
  );

  private static final List<SeedTag> SEED_TAGS = List.of(
    new SeedTag(UUID.fromString("c6f2692d-e2cb-4e42-b7fd-e79ec9a55107"), "Important"),
    new SeedTag(UUID.fromString("f838dd77-b484-4c95-bdc4-d3293e4bcf81"), "ToRead"),
    new SeedTag(UUID.fromString("0c7d4f74-3815-4f2a-b94e-72baf4dcc910"), "Finance"),
    new SeedTag(UUID.fromString("fc51a85c-e563-4042-b2b9-52218ac75d5c"), "FollowUp"),
    new SeedTag(UUID.fromString("9ff165e9-88cf-4323-8308-d73398e222f9"), "Ops"),
    new SeedTag(UUID.fromString("5ffaf5e3-7087-4227-ac9a-6674f6f1ee31"), "Hiring")
  );

  private static final List<DefaultViewTemplate> DEFAULT_VIEWS = List.of(
    new DefaultViewTemplate(
      "Work",
      5,
      10,
      "briefcase",
      "ALL",
      List.of("company.com"),
      List.of("boss@company.com"),
      List.of("invoice", "meeting"),
      true
    ),
    new DefaultViewTemplate(
      "LinkedIn",
      3,
      20,
      "network",
      "ALL",
      List.of("linkedin.com", "lnkd.in"),
      List.of(),
      List.of("connection", "recruiter"),
      false
    ),
    new DefaultViewTemplate(
      "Gaming",
      2,
      30,
      "gamepad-2",
      "ALL",
      List.of("steampowered.com", "epicgames.com"),
      List.of(),
      List.of("patch", "season"),
      false
    ),
    new DefaultViewTemplate(
      "Marketing",
      2,
      40,
      "megaphone",
      "ALL",
      List.of("mailchimp.com", "canva.com"),
      List.of(),
      List.of("campaign", "audience"),
      false
    )
  );

  private static final String[] FIRST_NAMES = {
    "Ava",
    "Noah",
    "Maya",
    "Ethan",
    "Lena",
    "Arjun",
    "Zoe",
    "Mateo",
    "Nora",
    "Leo",
    "Iris",
    "Kai"
  };

  private static final String[] LAST_NAMES = {
    "Patel",
    "Miller",
    "Sanchez",
    "Kim",
    "Fischer",
    "Brown",
    "Chen",
    "Carter",
    "Ahmed",
    "Ivanov",
    "Silva",
    "Singh"
  };

  private static final String[] DOMAINS = {
    "company.com",
    "partnersuite.com",
    "vendorhq.com",
    "linkedin.com",
    "lnkd.in",
    "steampowered.com",
    "epicgames.com",
    "discord.com",
    "riotgames.com",
    "mailchimp.com",
    "hubspot.com",
    "marketo.com",
    "campaignhq.com",
    "github.com",
    "notion.so",
    "calendar.app"
  };

  private static final String[] SUBJECTS = {
    "Weekly status update",
    "Invoice review request",
    "Quick sync for roadmap",
    "Campaign performance recap",
    "Connection follow-up",
    "Patch notes discussion",
    "Hiring pipeline update",
    "Launch checklist approval",
    "Meeting notes and next steps",
    "Proposal feedback needed",
    "SLA alert for customer queue",
    "Q4 planning prep"
  };

  private static final String[] SNIPPETS = {
    "Can you take a look and confirm by EOD?",
    "Sharing context before we lock this in.",
    "Need a final call on scope and ownership.",
    "Dropping this here for quick visibility.",
    "This thread has a few action items to triage.",
    "Please confirm if we should proceed with the current plan.",
    "There are open points around timeline and budget.",
    "I added a short summary to keep this moving."
  };

  private static final String[] BODY_PARAGRAPHS = {
    "This is seeded MailPilot content intended for desktop integration testing.",
    "The primary goal is to exercise list virtualization, preview rendering, and followup filters.",
    "Seeded messages are deterministic enough for repeatable debugging across local machines.",
    "Body cache intentionally varies so the UI can show both cached and fallback states."
  };

  private static final String[] FILENAMES = {
    "timeline.pdf",
    "requirements.docx",
    "campaign-results.csv",
    "budget-review.xlsx",
    "design-brief.pdf",
    "notes.txt",
    "deployment-checklist.md"
  };

  private static final String[] MIME_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/csv",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain",
    "text/markdown"
  };

  private final JdbcTemplate jdbcTemplate;

  public DevSeedService(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  @Transactional
  public SeedResult seedMailboxData() {
    Integer existingMessages = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM messages", Integer.class);
    if (existingMessages != null && existingMessages > 0) {
      boolean seededViews = seedDefaultViewsIfMissing();
      String message = seededViews
        ? "Seed skipped for mailbox data; default views seeded"
        : "Seed skipped: mailbox already contains data";
      return new SeedResult("ok", message, existingMessages);
    }

    Random random = new Random(9062026L);
    OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);

    upsertAccounts();
    upsertSenderRules();
    upsertTags();

    Map<UUID, List<SeedThread>> threadsByAccount = createThreads(random, now);
    List<SeedMessage> messages = createMessages(random, now, threadsByAccount, DEFAULT_SEED_MESSAGES);

    updateThreadLastMessage(messages);
    insertFollowups(random, now, messages);
    insertAttachments(random, messages);
    insertMessageTags(random, messages);
    seedDefaultViewsIfMissing();

    return new SeedResult("ok", "Seeded mailbox data", messages.size());
  }

  private boolean seedDefaultViewsIfMissing() {
    Integer existingViews = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM views", Integer.class);
    if (existingViews != null && existingViews > 0) {
      return false;
    }

    for (DefaultViewTemplate template : DEFAULT_VIEWS) {
      UUID viewId = UUID.randomUUID();
      jdbcTemplate.update(
        """
        INSERT INTO views (
          id,
          name,
          priority,
          sort_order,
          icon,
          accounts_scope,
          unread_only,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, now(), now())
        """,
        viewId,
        template.name(),
        template.priority(),
        template.sortOrder(),
        template.icon(),
        template.scopeType(),
        template.unreadOnly()
      );

      insertViewRules(viewId, "DOMAIN", template.senderDomains());
      insertViewRules(viewId, "SENDER_EMAIL", template.senderEmails());
      insertViewRules(viewId, "KEYWORD", template.keywords());
    }

    return true;
  }

  private void insertViewRules(UUID viewId, String ruleType, List<String> ruleValues) {
    if (ruleValues.isEmpty()) {
      return;
    }

    jdbcTemplate.batchUpdate(
      """
      INSERT INTO view_rules (id, view_id, rule_type, rule_value)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (view_id, rule_type, rule_value) DO NOTHING
      """,
      ruleValues,
      100,
      (preparedStatement, ruleValue) -> {
        preparedStatement.setObject(1, UUID.randomUUID());
        preparedStatement.setObject(2, viewId);
        preparedStatement.setString(3, ruleType);
        preparedStatement.setString(4, ruleValue);
      }
    );
  }

  private void upsertAccounts() {
    jdbcTemplate.batchUpdate(
      """
      INSERT INTO accounts (id, provider, email, display_name, status)
      VALUES (?, 'GMAIL', ?, ?, 'CONNECTED')
      ON CONFLICT (provider, email)
      DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = now()
      """,
      SEED_ACCOUNTS,
      50,
      (preparedStatement, account) -> {
        preparedStatement.setObject(1, account.id());
        preparedStatement.setString(2, account.email());
        preparedStatement.setString(3, account.displayName());
      }
    );
  }

  private void upsertSenderRules() {
    jdbcTemplate.update(
      """
      INSERT INTO sender_rules (match_type, match_value, label, accent)
      VALUES ('EMAIL', 'ceo@company.com', 'BOSS', 'gold')
      ON CONFLICT (match_type, match_value) DO NOTHING
      """
    );
    jdbcTemplate.update(
      """
      INSERT INTO sender_rules (match_type, match_value, label, accent)
      VALUES ('DOMAIN', 'qa.company.com', 'QA', 'purple')
      ON CONFLICT (match_type, match_value) DO NOTHING
      """
    );
  }

  private void upsertTags() {
    jdbcTemplate.batchUpdate(
      """
      INSERT INTO tags (id, name)
      VALUES (?, ?)
      ON CONFLICT (name) DO NOTHING
      """,
      SEED_TAGS,
      50,
      (preparedStatement, tag) -> {
        preparedStatement.setObject(1, tag.id());
        preparedStatement.setString(2, tag.name());
      }
    );
  }

  private Map<UUID, List<SeedThread>> createThreads(Random random, OffsetDateTime now) {
    List<SeedThread> threads = new ArrayList<>();
    for (SeedAccount account : SEED_ACCOUNTS) {
      String accountKey = account.email().replace("@", "-").replace('.', '-');
      for (int index = 0; index < 150; index++) {
        threads.add(
          new SeedThread(
            UUID.randomUUID(),
            account.id(),
            accountKey + "-thread-" + index,
            pick(SUBJECTS, random),
            now.minusDays(random.nextInt(40)).minusHours(random.nextInt(20))
          )
        );
      }
    }

    jdbcTemplate.batchUpdate(
      """
      INSERT INTO threads (id, account_id, provider_thread_id, subject, last_message_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (account_id, provider_thread_id) DO NOTHING
      """,
      threads,
      200,
      (preparedStatement, thread) -> {
        preparedStatement.setObject(1, thread.id());
        preparedStatement.setObject(2, thread.accountId());
        preparedStatement.setString(3, thread.providerThreadId());
        preparedStatement.setString(4, thread.subject());
        preparedStatement.setObject(5, thread.lastMessageAt());
      }
    );

    return threads.stream().collect(java.util.stream.Collectors.groupingBy(SeedThread::accountId));
  }

  private List<SeedMessage> createMessages(
    Random random,
    OffsetDateTime now,
    Map<UUID, List<SeedThread>> threadsByAccount,
    int count
  ) {
    List<SeedMessage> messages = new ArrayList<>(count);
    for (int index = 0; index < count; index++) {
      SeedAccount account = SEED_ACCOUNTS.get(random.nextInt(SEED_ACCOUNTS.size()));
      List<SeedThread> accountThreads = threadsByAccount.get(account.id());
      SeedThread thread = accountThreads.get(random.nextInt(accountThreads.size()));

      String firstName = pick(FIRST_NAMES, random);
      String lastName = pick(LAST_NAMES, random);
      String senderDomain = pick(DOMAINS, random).toLowerCase(Locale.ROOT);
      String senderEmail = (firstName + "." + lastName).toLowerCase(Locale.ROOT) + "@" + senderDomain;
      String senderName = firstName + " " + lastName;

      String subject = pick(SUBJECTS, random) + (random.nextDouble() < 0.22 ? " · follow-up" : "");
      String snippet = pick(SNIPPETS, random);
      OffsetDateTime receivedAt = now
        .minusDays(random.nextInt(45))
        .minusHours(random.nextInt(24))
        .minusMinutes(random.nextInt(60));

      boolean isUnread = random.nextDouble() < 0.2;
      boolean hasAttachments = random.nextDouble() < 0.22;
      String bodyCache = random.nextDouble() < 0.66
        ? pick(BODY_PARAGRAPHS, random) + "\n\n" + pick(BODY_PARAGRAPHS, random)
        : null;

      messages.add(
        new SeedMessage(
          UUID.randomUUID(),
          account.id(),
          thread.id(),
          "seed-msg-" + index,
          senderName,
          senderEmail,
          senderDomain,
          subject,
          snippet,
          receivedAt,
          isUnread,
          hasAttachments,
          bodyCache,
          bodyCache == null ? null : "text/plain"
        )
      );
    }

    jdbcTemplate.batchUpdate(
      """
      INSERT INTO messages (
        id,
        account_id,
        thread_id,
        provider_message_id,
        sender_name,
        sender_email,
        sender_domain,
        subject,
        snippet,
        received_at,
        is_read,
        has_attachments,
        body_cache,
        body_cache_mime,
        body_cached_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      """,
      messages,
      250,
      (preparedStatement, message) -> {
        preparedStatement.setObject(1, message.id());
        preparedStatement.setObject(2, message.accountId());
        preparedStatement.setObject(3, message.threadId());
        preparedStatement.setString(4, message.providerMessageId());
        preparedStatement.setString(5, message.senderName());
        preparedStatement.setString(6, message.senderEmail());
        preparedStatement.setString(7, message.senderDomain());
        preparedStatement.setString(8, message.subject());
        preparedStatement.setString(9, message.snippet());
        preparedStatement.setObject(10, message.receivedAt());
        preparedStatement.setBoolean(11, !message.isUnread());
        preparedStatement.setBoolean(12, message.hasAttachments());
        preparedStatement.setString(13, message.bodyCache());
        preparedStatement.setString(14, message.bodyCacheMime());
        preparedStatement.setObject(15, message.bodyCache() == null ? null : message.receivedAt());
      }
    );

    return messages;
  }

  private void updateThreadLastMessage(List<SeedMessage> messages) {
    Map<UUID, OffsetDateTime> maxByThread = new java.util.HashMap<>();
    for (SeedMessage message : messages) {
      OffsetDateTime existing = maxByThread.get(message.threadId());
      if (existing == null || message.receivedAt().isAfter(existing)) {
        maxByThread.put(message.threadId(), message.receivedAt());
      }
    }

    List<Map.Entry<UUID, OffsetDateTime>> entries = new ArrayList<>(maxByThread.entrySet());
    jdbcTemplate.batchUpdate(
      "UPDATE threads SET last_message_at = ? WHERE id = ?",
      entries,
      200,
      (preparedStatement, entry) -> {
        preparedStatement.setObject(1, entry.getValue());
        preparedStatement.setObject(2, entry.getKey());
      }
    );
  }

  private void insertFollowups(Random random, OffsetDateTime now, List<SeedMessage> messages) {
    List<SeedFollowup> followups = new ArrayList<>();
    for (SeedMessage message : messages) {
      if (random.nextDouble() >= 0.18) {
        continue;
      }

      boolean open = random.nextDouble() < 0.82;
      String status = open ? "OPEN" : "DONE";
      boolean needsReply = open && random.nextDouble() < 0.45;

      OffsetDateTime dueAt = null;
      if (open && random.nextDouble() < 0.58) {
        double bucket = random.nextDouble();
        if (bucket < 0.33) {
          dueAt = now.minusHours(1 + random.nextInt(48));
        } else if (bucket < 0.66) {
          dueAt = now
            .withHour(9 + random.nextInt(8))
            .withMinute(random.nextInt(60))
            .withSecond(0)
            .withNano(0);
        } else {
          dueAt = now.plusHours(6 + random.nextInt(96));
        }
      }

      OffsetDateTime snoozedUntil = open && random.nextDouble() < 0.12
        ? now.plusHours(2 + random.nextInt(72))
        : null;

      followups.add(new SeedFollowup(message.id(), status, needsReply, dueAt, snoozedUntil));
    }

    if (followups.isEmpty()) {
      return;
    }

    jdbcTemplate.batchUpdate(
      """
      INSERT INTO followups (message_id, status, needs_reply, due_at, snoozed_until)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (message_id)
      DO UPDATE SET
        status = EXCLUDED.status,
        needs_reply = EXCLUDED.needs_reply,
        due_at = EXCLUDED.due_at,
        snoozed_until = EXCLUDED.snoozed_until,
        updated_at = now()
      """,
      followups,
      200,
      (preparedStatement, followup) -> {
        preparedStatement.setObject(1, followup.messageId());
        preparedStatement.setString(2, followup.status());
        preparedStatement.setBoolean(3, followup.needsReply());
        preparedStatement.setObject(4, followup.dueAt());
        preparedStatement.setObject(5, followup.snoozedUntil());
      }
    );
  }

  private void insertAttachments(Random random, List<SeedMessage> messages) {
    List<SeedAttachment> attachments = new ArrayList<>();
    for (SeedMessage message : messages) {
      if (!message.hasAttachments()) {
        continue;
      }
      int count = 1 + random.nextInt(3);
      for (int index = 0; index < count; index++) {
        attachments.add(
          new SeedAttachment(
            UUID.randomUUID(),
            message.id(),
            "seed-att-" + message.id() + "-" + index,
            pick(FILENAMES, random),
            pick(MIME_TYPES, random),
            40_000L + random.nextInt(3_800_000)
          )
        );
      }
    }

    if (attachments.isEmpty()) {
      return;
    }

    jdbcTemplate.batchUpdate(
      """
      INSERT INTO attachments (
        id,
        message_id,
        provider_attachment_id,
        filename,
        mime_type,
        size_bytes
      )
      VALUES (?, ?, ?, ?, ?, ?)
      """,
      attachments,
      300,
      (preparedStatement, attachment) -> {
        preparedStatement.setObject(1, attachment.id());
        preparedStatement.setObject(2, attachment.messageId());
        preparedStatement.setString(3, attachment.providerAttachmentId());
        preparedStatement.setString(4, attachment.filename());
        preparedStatement.setString(5, attachment.mimeType());
        preparedStatement.setLong(6, attachment.sizeBytes());
      }
    );
  }

  private void insertMessageTags(Random random, List<SeedMessage> messages) {
    List<SeedMessageTag> messageTags = new ArrayList<>();
    for (SeedMessage message : messages) {
      int tagCount = random.nextDouble() < 0.42 ? 1 + random.nextInt(3) : 0;
      if (tagCount == 0) {
        continue;
      }
      java.util.Set<UUID> selectedTagIds = new java.util.LinkedHashSet<>();
      while (selectedTagIds.size() < tagCount) {
        selectedTagIds.add(SEED_TAGS.get(random.nextInt(SEED_TAGS.size())).id());
      }
      for (UUID tagId : selectedTagIds) {
        messageTags.add(new SeedMessageTag(message.id(), tagId));
      }
    }

    if (messageTags.isEmpty()) {
      return;
    }

    jdbcTemplate.batchUpdate(
      """
      INSERT INTO message_tags (message_id, tag_id)
      VALUES (?, ?)
      ON CONFLICT (message_id, tag_id) DO NOTHING
      """,
      messageTags,
      400,
      (preparedStatement, messageTag) -> {
        preparedStatement.setObject(1, messageTag.messageId());
        preparedStatement.setObject(2, messageTag.tagId());
      }
    );
  }

  private String pick(String[] values, Random random) {
    return values[random.nextInt(values.length)];
  }

  public record SeedResult(String status, String message, int messages) {}

  private record SeedAccount(UUID id, String email, String displayName) {}

  private record SeedTag(UUID id, String name) {}

  private record SeedThread(
    UUID id,
    UUID accountId,
    String providerThreadId,
    String subject,
    OffsetDateTime lastMessageAt
  ) {}

  private record SeedMessage(
    UUID id,
    UUID accountId,
    UUID threadId,
    String providerMessageId,
    String senderName,
    String senderEmail,
    String senderDomain,
    String subject,
    String snippet,
    OffsetDateTime receivedAt,
    boolean isUnread,
    boolean hasAttachments,
    String bodyCache,
    String bodyCacheMime
  ) {}

  private record SeedFollowup(
    UUID messageId,
    String status,
    boolean needsReply,
    OffsetDateTime dueAt,
    OffsetDateTime snoozedUntil
  ) {}

  private record SeedAttachment(
    UUID id,
    UUID messageId,
    String providerAttachmentId,
    String filename,
    String mimeType,
    long sizeBytes
  ) {}

  private record SeedMessageTag(UUID messageId, UUID tagId) {}

  private record DefaultViewTemplate(
    String name,
    int priority,
    int sortOrder,
    String icon,
    String scopeType,
    List<String> senderDomains,
    List<String> senderEmails,
    List<String> keywords,
    boolean unreadOnly
  ) {}
}
