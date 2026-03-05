import { API_BASE } from "@/api/client";

export type BadgeUpdateEvent = {
  inbox: number;
  viewsTotal: number;
  views: Record<string, number>;
};

export type SyncStatusEvent = {
  accountId: string;
  email: string;
  state: "RUNNING" | "IDLE" | "ERROR";
  processed: number | null;
  total: number | null;
  message: string | null;
};

export type NewMailEvent = {
  accountId: string;
  email: string;
  messageId: string;
  senderEmail: string;
  senderName: string | null;
  subject: string | null;
  receivedAt: string;
  viewMatches: string[];
};

export type HeartbeatEvent = {
  time: string;
};

type EventMap = {
  badge_update: BadgeUpdateEvent;
  sync_status: SyncStatusEvent;
  new_mail: NewMailEvent;
  heartbeat: HeartbeatEvent;
};

type EventName = keyof EventMap;
type EventHandler<K extends EventName> = (payload: EventMap[K]) => void;
type ConnectionHandler = (connected: boolean) => void;

const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 10000;

class MailPilotSseClient {
  private readonly url: string;
  private readonly listeners: {
    [K in EventName]: Set<EventHandler<K>>;
  };
  private readonly connectionHandlers = new Set<ConnectionHandler>();

  private eventSource: EventSource | null = null;
  private reconnectTimer: number | null = null;
  private reconnectDelayMs = RETRY_MIN_MS;
  private started = false;
  private connected = false;

  constructor(url: string) {
    this.url = url;
    this.listeners = {
      badge_update: new Set(),
      sync_status: new Set(),
      new_mail: new Set(),
      heartbeat: new Set(),
    };
  }

  start() {
    if (this.started) {
      return;
    }
    this.started = true;
    this.connect();
  }

  stop() {
    this.started = false;
    this.setConnected(false);
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  on<K extends EventName>(eventName: K, handler: EventHandler<K>) {
    this.listeners[eventName].add(handler);
    return () => {
      this.listeners[eventName].delete(handler);
    };
  }

  onConnectionChange(handler: ConnectionHandler) {
    this.connectionHandlers.add(handler);
    handler(this.connected);
    return () => {
      this.connectionHandlers.delete(handler);
    };
  }

  private connect() {
    if (!this.started || this.eventSource !== null) {
      return;
    }

    const source = new EventSource(this.url);
    this.eventSource = source;

    source.onopen = () => {
      this.reconnectDelayMs = RETRY_MIN_MS;
      this.setConnected(true);
    };

    source.onerror = () => {
      this.setConnected(false);
      if (this.eventSource) {
        this.eventSource.close();
        this.eventSource = null;
      }
      if (!this.started || this.reconnectTimer !== null) {
        return;
      }

      const waitMs = this.reconnectDelayMs;
      this.reconnectDelayMs = Math.min(this.reconnectDelayMs + 1000, RETRY_MAX_MS);
      this.reconnectTimer = window.setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, waitMs);
    };

    this.attachJsonListener(source, "badge_update");
    this.attachJsonListener(source, "sync_status");
    this.attachJsonListener(source, "new_mail");
    this.attachJsonListener(source, "heartbeat");
  }

  private attachJsonListener<K extends EventName>(source: EventSource, eventName: K) {
    source.addEventListener(eventName, (event) => {
      if (!(event instanceof MessageEvent)) {
        return;
      }

      let payload: EventMap[K];
      try {
        payload = JSON.parse(event.data) as EventMap[K];
      } catch {
        return;
      }

      for (const handler of this.listeners[eventName]) {
        handler(payload);
      }
    });
  }

  private setConnected(nextConnected: boolean) {
    if (this.connected === nextConnected) {
      return;
    }
    this.connected = nextConnected;
    for (const handler of this.connectionHandlers) {
      handler(nextConnected);
    }
  }
}

export const sseClient = new MailPilotSseClient(`${API_BASE}/api/events/stream`);

