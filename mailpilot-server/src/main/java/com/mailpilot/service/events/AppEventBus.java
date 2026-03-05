package com.mailpilot.service.events;

import com.mailpilot.service.BadgeService;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Service;

@Service
public class AppEventBus {

  private final Set<AppEventListener> listeners = ConcurrentHashMap.newKeySet();

  public AutoCloseable subscribe(AppEventListener listener) {
    listeners.add(listener);
    return () -> listeners.remove(listener);
  }

  public void publishBadgeUpdate(BadgeService.BadgeSummary summary) {
    publish(new AppEvent("badge_update", summary));
  }

  public void publishSyncStatus(
    UUID accountId,
    String email,
    String state,
    Integer processed,
    Integer total,
    String message
  ) {
    publish(
      new AppEvent(
        "sync_status",
        new SyncStatusPayload(accountId, email, state, processed, total, message)
      )
    );
  }

  public void publishNewMail(
    UUID accountId,
    String email,
    UUID messageId,
    String senderEmail,
    String senderName,
    String subject,
    OffsetDateTime receivedAt,
    List<UUID> viewMatches
  ) {
    List<String> matchedViewIds = viewMatches == null
      ? List.of()
      : viewMatches.stream().map(UUID::toString).toList();

    publish(
      new AppEvent(
        "new_mail",
        new NewMailPayload(
          accountId,
          email,
          messageId,
          senderEmail,
          senderName,
          subject,
          receivedAt,
          matchedViewIds
        )
      )
    );
  }

  private void publish(AppEvent event) {
    if (listeners.isEmpty()) {
      return;
    }

    for (AppEventListener listener : listeners) {
      try {
        listener.onEvent(event);
      } catch (Exception ignored) {}
    }
  }

  public interface AppEventListener {
    void onEvent(AppEvent event);
  }

  public record AppEvent(String eventName, Object payload) {}

  public record SyncStatusPayload(
    UUID accountId,
    String email,
    String state,
    Integer processed,
    Integer total,
    String message
  ) {}

  public record NewMailPayload(
    UUID accountId,
    String email,
    UUID messageId,
    String senderEmail,
    String senderName,
    String subject,
    OffsetDateTime receivedAt,
    List<String> viewMatches
  ) {}
}
