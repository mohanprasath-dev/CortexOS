/**
 * CortexOS – WebSocket Client
 *
 * Manages the WebSocket connection between the frontend and the CortexOS backend.
 * Handles connection lifecycle, automatic reconnection with exponential backoff,
 * message serialization/deserialization, and connection state tracking.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface ServerMessage {
  type: string;
  sessionId?: string;
  text?: string;
  audio?: string;
  tool?: string;
  args?: Record<string, unknown>;
  result?: Record<string, unknown>;
  status?: string;
  error?: string;
  timestamp?: number;
  // New: browser frame relay
  frame?: string;
  url?: string;
  thinking?: boolean;
  enabled?: boolean;
}

export interface ClientMessage {
  type: string;
  data?: string;
  url?: string;
}

export interface WebSocketClient {
  connect: () => void;
  disconnect: () => void;
  send: (message: ClientMessage) => void;
  isConnected: () => boolean;
  onOpen: (() => void) | null;
  onClose: (() => void) | null;
  onMessage: ((message: ServerMessage) => void) | null;
  onError: ((error: string) => void) | null;
}

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 16000;
const HEARTBEAT_INTERVAL_MS = 30000;

// ── Factory ──────────────────────────────────────────────────────────────────

export function createWebSocketClient(url: string): WebSocketClient {
  let ws: WebSocket | null = null;
  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let intentionalClose = false;

  const client: WebSocketClient = {
    onOpen: null,
    onClose: null,
    onMessage: null,
    onError: null,

    connect() {
      intentionalClose = false;
      reconnectAttempts = 0;
      openConnection();
    },

    disconnect() {
      intentionalClose = true;
      cleanup();
      if (ws) {
        ws.close(1000, 'Client disconnect');
        ws = null;
      }
    },

    send(message: ClientMessage) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      } else {
        console.warn('WebSocket not connected, message dropped:', message.type);
      }
    },

    isConnected() {
      return ws !== null && ws.readyState === WebSocket.OPEN;
    },
  };

  function openConnection() {
    try {
      ws = new WebSocket(url);

      ws.onopen = () => {
        console.log('WebSocket connected to:', url);
        reconnectAttempts = 0;
        startHeartbeat();
        client.onOpen?.();
      };

      ws.onmessage = (event: MessageEvent) => {
        try {
          const message: ServerMessage = JSON.parse(event.data as string);
          client.onMessage?.(message);
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };

      ws.onclose = (event: CloseEvent) => {
        console.log(`WebSocket closed: code=${event.code}, reason=${event.reason}`);
        cleanup();
        client.onClose?.();

        if (!intentionalClose && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          scheduleReconnect();
        }
      };

      ws.onerror = (event: Event) => {
        console.error('WebSocket error:', event);
        client.onError?.('WebSocket connection error');
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown connection error';
      console.error('Failed to create WebSocket:', errorMsg);
      client.onError?.(errorMsg);
    }
  }

  function scheduleReconnect() {
    reconnectAttempts++;
    const delay = Math.min(
      BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts - 1),
      MAX_RECONNECT_DELAY_MS
    );
    console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);

    reconnectTimer = setTimeout(() => {
      openConnection();
    }, delay);
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        // Send a lightweight ping message
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function cleanup() {
    stopHeartbeat();
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  return client;
}
