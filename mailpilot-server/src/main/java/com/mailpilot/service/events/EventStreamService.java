package com.mailpilot.service.events;

import com.mailpilot.service.BadgeService;
import com.mailpilot.service.sync.GmailSyncCoordinator;
import java.io.IOException;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@Service
public class EventStreamService {

  private static final Logger LOGGER = LoggerFactory.getLogger(EventStreamService.class);

  private final BadgeService badgeService;
  private final GmailSyncCoordinator gmailSyncCoordinator;
  private final ScheduledExecutorService heartbeatExecutor = Executors.newSingleThreadScheduledExecutor();
  private final Set<SseEmitter> emitters = ConcurrentHashMap.newKeySet();
  private final AutoCloseable eventSubscription;

  public EventStreamService(
    BadgeService badgeService,
    GmailSyncCoordinator gmailSyncCoordinator,
    AppEventBus appEventBus
  ) {
    this.badgeService = badgeService;
    this.gmailSyncCoordinator = gmailSyncCoordinator;
    this.eventSubscription = appEventBus.subscribe(this::broadcastEvent);

    heartbeatExecutor.scheduleAtFixedRate(this::broadcastHeartbeat, 25, 25, TimeUnit.SECONDS);
  }

  public SseEmitter openStream() {
    SseEmitter emitter = new SseEmitter(0L);
    registerEmitter(emitter);

    sendToEmitter(emitter, "badge_update", badgeService.computeBadgeSummary());
    sendSyncSnapshot(emitter, gmailSyncCoordinator.listStatus());

    return emitter;
  }

  @PreDestroy
  public void shutdown() {
    heartbeatExecutor.shutdownNow();
    try {
      eventSubscription.close();
    } catch (Exception ignored) {}

    for (SseEmitter emitter : emitters) {
      emitter.complete();
    }
    emitters.clear();
  }

  private void sendSyncSnapshot(
    SseEmitter emitter,
    List<GmailSyncCoordinator.SyncStatusView> statusViews
  ) {
    for (GmailSyncCoordinator.SyncStatusView status : statusViews) {
      AppEventBus.SyncStatusPayload payload = new AppEventBus.SyncStatusPayload(
        status.accountId(),
        status.email(),
        status.status(),
        null,
        null,
        status.lastError()
      );
      sendToEmitter(emitter, "sync_status", payload);
    }
  }

  private void registerEmitter(SseEmitter emitter) {
    emitters.add(emitter);
    emitter.onCompletion(() -> emitters.remove(emitter));
    emitter.onTimeout(() -> emitters.remove(emitter));
    emitter.onError((error) -> emitters.remove(emitter));
  }

  private void broadcastEvent(AppEventBus.AppEvent event) {
    if (event == null || event.eventName() == null) {
      return;
    }
    broadcast(event.eventName(), event.payload());
  }

  private void broadcastHeartbeat() {
    broadcast(
      "heartbeat",
      new HeartbeatPayload(OffsetDateTime.now(ZoneOffset.UTC))
    );
  }

  private void broadcast(String eventName, Object payload) {
    if (emitters.isEmpty()) {
      return;
    }

    for (SseEmitter emitter : List.copyOf(emitters)) {
      sendToEmitter(emitter, eventName, payload);
    }
  }

  private void sendToEmitter(SseEmitter emitter, String eventName, Object payload) {
    try {
      emitter.send(SseEmitter.event().name(eventName).data(payload));
    } catch (IOException exception) {
      emitters.remove(emitter);
      emitter.completeWithError(exception);
      LOGGER.debug("SSE emitter send failed for event {}: {}", eventName, exception.getMessage());
    }
  }

  private record HeartbeatPayload(OffsetDateTime time) {}
}
