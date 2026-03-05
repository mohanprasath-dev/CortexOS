/**
 * CortexOS – Gemini Live API Client (Vertex AI)
 *
 * Manages a persistent streaming WebSocket connection to the Gemini 2.0 Flash
 * Live API via Vertex AI (us-central1-aiplatform.googleapis.com).
 * Uses Google Application Default Credentials (ADC) / service-account OAuth2
 * Bearer tokens — NO API keys.
 *
 * Protocol (BidiGenerateContent):
 *   Client → Gemini: setup, audio chunks, image frames, text turns, tool results
 *   Gemini → Client: setupComplete, text parts, audio parts, tool-call requests,
 *                     turnComplete
 *
 * Token lifecycle: tokens are fetched once on connect(). Since WebSocket
 * headers cannot be updated after the connection is established, token
 * refresh is not possible mid-session. Sessions are therefore capped at
 * the OAuth2 token lifetime (~60 minutes). Callers should reconnect for
 * longer-running sessions.
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { GoogleAuth } from 'google-auth-library';
import { logger } from './logger';
import { TOOL_DECLARATIONS } from './toolSchema';
import { describeCloseCode } from './configValidator';

// ── Types ────────────────────────────────────────────────────────────────────

interface GeminiServerMessage {
  serverContent?: {
    modelTurn?: {
      parts?: Array<{
        text?: string;
        inlineData?: { mimeType: string; data: string };
        functionCall?: { name: string; args: Record<string, unknown> };
      }>;
    };
    turnComplete?: boolean;
  };
  toolCall?: {
    functionCalls: Array<{
      id: string;
      name: string;
      args: Record<string, unknown>;
    }>;
  };
  setupComplete?: Record<string, unknown>;
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

// ── System Prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are CortexOS, an autonomous multimodal workspace agent.

You can SEE the user's browser screen (via periodic screenshots) and HEAR the user (via live microphone).

Your capabilities:
1. Navigate to URLs in the browser
2. Click on elements using CSS selectors
3. Type text into form fields
4. Extract text content from the page
5. Summarize documents and content
6. Create calendar events

RULES:
- Always use structured tool calls to perform actions. Never describe actions in text alone.
- When you see the screen, analyze what's visible and decide the next action.
- Explain your reasoning briefly before executing actions.
- After executing an action, wait for the result before proceeding.
- NEVER provide medical, legal, or financial advice.
- NEVER attempt to access files outside the browser sandbox.
- If unsure about a selector, use the extract tool first to understand page structure.
- Be concise and action-oriented.
- Report errors clearly and suggest alternatives.

You are operating inside a sandboxed Playwright browser instance. All actions are safe and contained.`;

// ── Gemini Live Client (Vertex AI) ──────────────────────────────────────────

export class GeminiLiveClient extends EventEmitter {
  private sessionId: string;
  private ws: WebSocket | null = null;
  private connected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private pendingToolCallIds: Map<string, string> = new Map();

  // Vertex AI configuration – NO API keys
  private projectId: string;
  private location: string;
  private modelName: string;

  // OAuth2 token management
  private auth: GoogleAuth;
  private accessToken: string | null = null;

  constructor(sessionId: string) {
    super();
    this.sessionId = sessionId;

    this.projectId = process.env.PROJECT_ID || '';
    this.location = process.env.LOCATION || 'us-central1';
    this.modelName = process.env.GEMINI_MODEL_NAME || 'gemini-2.0-flash-live';

    if (!this.projectId) {
      throw new Error('PROJECT_ID environment variable is required for Vertex AI');
    }

    if (!this.modelName) {
      throw new Error('GEMINI_MODEL_NAME environment variable is required');
    }

    // Guard: reject any API key usage at construction time
    if (process.env.GEMINI_API_KEY || process.env.API_KEY || process.env.GOOGLE_API_KEY) {
      throw new Error(
        'API key variables detected. CortexOS requires Vertex AI with OAuth2. ' +
        'Remove GEMINI_API_KEY / API_KEY / GOOGLE_API_KEY from environment.'
      );
    }

    logger.info(
      `GeminiLiveClient config: session=${sessionId}, project=${this.projectId}, ` +
      `location=${this.location}, model=${this.modelName}`
    );

    // GoogleAuth automatically uses GOOGLE_APPLICATION_CREDENTIALS or
    // Application Default Credentials (metadata server on Cloud Run).
    this.auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /**
   * Obtain an OAuth2 Bearer token and establish the Vertex AI WebSocket.
   */
  async connect(): Promise<void> {
    const t0 = Date.now();

    // Obtain a fresh access token
    this.accessToken = await this.fetchAccessToken();

    const wsUrl = this.buildWebSocketUrl();
    logger.info(
      `Connecting to Gemini Live (Vertex AI): session=${this.sessionId}, ` +
      `project=${this.projectId}, location=${this.location}, model=${this.modelName}`
    );

    return new Promise<void>((resolve, reject) => {
      let settled = false;

      const settle = (action: 'resolve' | 'reject', value?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(connectionTimeout);
        if (action === 'resolve') resolve();
        else reject(value);
      };

      this.ws = new WebSocket(wsUrl, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });

      const connectionTimeout = setTimeout(() => {
        if (!this.connected) {
          settle('reject', new Error('Gemini connection timeout after 15 s'));
          this.ws?.close();
        }
      }, 15_000);

      this.ws.on('open', () => {
        logger.info(
          `WebSocket opened to Vertex AI: session=${this.sessionId}, ` +
          `latency=${Date.now() - t0}ms`
        );
        this.sendSetupMessage();
      });

      this.ws.on('message', (data: Buffer) => {
        try {
          const message: GeminiServerMessage = JSON.parse(data.toString());

          if (message.error) {
            logger.error(
              `Gemini API error: session=${this.sessionId}, ` +
              `code=${message.error.code}, msg=${message.error.message}`
            );
            settle('reject', new Error(`Gemini error: ${message.error.message}`));
            return;
          }

          this.handleServerMessage(message, () => settle('resolve'), connectionTimeout);
        } catch (err) {
          logger.error(`Failed to parse Gemini message: session=${this.sessionId}`, err);
        }
      });

      this.ws.on('error', (err) => {
        logger.error(`Gemini WebSocket error: session=${this.sessionId}`, err);
        settle('reject', err instanceof Error ? err : new Error(String(err)));
        this.emit('error', err);
      });

      this.ws.on('close', (code, reason) => {
        const reasonStr = reason.toString();
        const codeDesc = describeCloseCode(code);
        logger.info(
          `Gemini WebSocket closed: session=${this.sessionId}, ` +
          `code=${code} (${codeDesc}), reason=${reasonStr}`
        );

        // Log actionable diagnostics for common failure codes
        if (code === 1008) {
          logger.error(
            `WS 1008 Policy Violation: session=${this.sessionId}. ` +
            'Common causes: invalid model name, expired/invalid OAuth2 token, ' +
            `or malformed setup message. Current model: ${this.modelName}`
          );
        } else if (code === 1006) {
          logger.error(
            `WS 1006 Abnormal Closure: session=${this.sessionId}. ` +
            'Connection dropped without close frame. Check network connectivity ' +
            'and Vertex AI service status.'
          );
        } else if (code === 1011) {
          logger.error(
            `WS 1011 Internal Error: session=${this.sessionId}. ` +
            'Server-side failure at Vertex AI. Retry may succeed.'
          );
        }

        const wasConnected = this.connected;
        this.connected = false;

        if (!wasConnected && code !== 1000) {
          settle('reject', new Error(`WebSocket closed: ${code} – ${codeDesc} – ${reasonStr}`));
        }

        // Reconnect attempts use independent promises (no double-rejection)
        if (this.reconnectAttempts < this.maxReconnectAttempts && code !== 1000) {
          this.reconnectAttempts++;
          const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 8000);
          logger.info(
            `Attempting reconnect in ${delay}ms: session=${this.sessionId}, ` +
            `attempt=${this.reconnectAttempts}/${this.maxReconnectAttempts}`
          );
          setTimeout(() => this.connect().catch((e) => this.emit('error', e)), delay);
        } else if (code !== 1000) {
          this.emit('fatal_close', { code, reason: codeDesc });
        }
      });
    });
  }

  /**
   * Send audio data to Gemini (base64-encoded PCM16 audio).
   */
  async sendAudio(base64Audio: string): Promise<void> {
    if (!this.connected || !this.ws) return;

    const message = {
      realtimeInput: {
        mediaChunks: [
          {
            mimeType: 'audio/pcm;rate=16000',
            data: base64Audio,
          },
        ],
      },
    };

    this.sendRaw(JSON.stringify(message));
  }

  /**
   * Send an image frame to Gemini (base64-encoded JPEG).
   */
  async sendImage(base64Image: string): Promise<void> {
    if (!this.connected || !this.ws) return;

    const message = {
      realtimeInput: {
        mediaChunks: [
          {
            mimeType: 'image/jpeg',
            data: base64Image,
          },
        ],
      },
    };

    this.sendRaw(JSON.stringify(message));
  }

  /**
   * Send a text prompt to Gemini.
   */
  async sendText(text: string): Promise<void> {
    if (!this.connected || !this.ws) return;

    const message = {
      clientContent: {
        turns: [
          {
            role: 'user',
            parts: [{ text }],
          },
        ],
        turnComplete: true,
      },
    };

    this.sendRaw(JSON.stringify(message));
    logger.info(`Text sent to Gemini: session=${this.sessionId}, length=${text.length}`);
  }

  /**
   * Send tool execution result back to Gemini.
   */
  async sendToolResult(toolName: string, result: Record<string, unknown>): Promise<void> {
    if (!this.connected || !this.ws) return;

    const functionCallId = this.pendingToolCallIds.get(toolName) || `fc_${Date.now()}`;
    this.pendingToolCallIds.delete(toolName);

    const message = {
      toolResponse: {
        functionResponses: [
          {
            id: functionCallId,
            name: toolName,
            response: result,
          },
        ],
      },
    };

    this.sendRaw(JSON.stringify(message));
    logger.info(`Tool result sent to Gemini: session=${this.sessionId}, tool=${toolName}`);
  }

  /**
   * Check if the client is currently connected to Gemini.
   */
  isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Disconnect from the Gemini Live API and stop all timers.
   */
  async disconnect(): Promise<void> {
    this.maxReconnectAttempts = 0;
    this.connected = false;

    if (this.ws) {
      this.ws.close(1000, 'Session ended');
      this.ws = null;
    }
    logger.info(`Gemini client disconnected: session=${this.sessionId}`);
  }

  // ── Private: Setup & Message Handling ──────────────────────────────────

  /**
   * Send the initial BidiGenerateContent setup message.
   * Uses the full Vertex AI resource path and enables both TEXT + AUDIO modalities.
   */
  private sendSetupMessage(): void {
    const modelPath =
      `projects/${this.projectId}/locations/${this.location}` +
      `/publishers/google/models/${this.modelName}`;

    const setup = {
      setup: {
        model: modelPath,
        generationConfig: {
          responseModalities: ['TEXT', 'AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: 'Aoede',
              },
            },
          },
        },
        systemInstruction: {
          parts: [{ text: SYSTEM_PROMPT }],
        },
        tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
      },
    };

    this.sendRaw(JSON.stringify(setup));
    logger.info(`Setup message sent (Vertex AI): session=${this.sessionId}, model=${modelPath}`);
  }

  /**
   * Handle messages received from the Gemini Live API.
   */
  private handleServerMessage(
    message: GeminiServerMessage,
    onSetupComplete?: (value: void) => void,
    connectionTimeout?: ReturnType<typeof setTimeout>
  ): void {
    // Setup acknowledgment
    if (message.setupComplete) {
      this.connected = true;
      this.reconnectAttempts = 0;
      logger.info(`Gemini setup complete: session=${this.sessionId}`);
      if (connectionTimeout) clearTimeout(connectionTimeout);
      if (onSetupComplete) onSetupComplete();
      return;
    }

    // Tool calls from Gemini
    if (message.toolCall?.functionCalls) {
      for (const fc of message.toolCall.functionCalls) {
        this.pendingToolCallIds.set(fc.name, fc.id);
        this.emit('tool_call', { name: fc.name, args: fc.args });
      }
      return;
    }

    // Model content response (text, audio, inline function calls)
    if (message.serverContent?.modelTurn?.parts) {
      for (const part of message.serverContent.modelTurn.parts) {
        if (part.text) {
          this.emit('text', part.text);
        }
        if (part.inlineData?.mimeType?.startsWith('audio/')) {
          this.emit('audio', part.inlineData.data);
        }
        if (part.functionCall) {
          this.pendingToolCallIds.set(part.functionCall.name, `fc_${Date.now()}`);
          this.emit('tool_call', {
            name: part.functionCall.name,
            args: part.functionCall.args,
          });
        }
      }
    }

    // Turn complete indicator
    if (message.serverContent?.turnComplete) {
      this.emit('turn_complete');
    }
  }

  // ── Private: OAuth2 Token Management ───────────────────────────────────

  /**
   * Fetch an OAuth2 access token using ADC / service account.
   */
  private async fetchAccessToken(): Promise<string> {
    const t0 = Date.now();
    const client = await this.auth.getClient();
    const tokenResponse = await client.getAccessToken();
    const token = tokenResponse.token;

    if (!token) {
      throw new Error(
        'Failed to obtain access token. Ensure GOOGLE_APPLICATION_CREDENTIALS ' +
        'is set or that you are running on a GCP environment with ADC.'
      );
    }

    logger.info(`OAuth2 token acquired: session=${this.sessionId}, latency=${Date.now() - t0}ms`);
    return token;
  }

  // ── Private: Helpers ───────────────────────────────────────────────────

  private sendRaw(data: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  /**
   * Build the Vertex AI BidiGenerateContent WebSocket URL.
   * Format: wss://{LOCATION}-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent
   */
  private buildWebSocketUrl(): string {
    return (
      `wss://${this.location}-aiplatform.googleapis.com/ws/` +
      `google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent`
    );
  }
}
