/**
 * CortexOS Backend Server
 *
 * Main entry point for the real-time multimodal autonomous workspace agent.
 * Handles HTTP API endpoints, WebSocket connections for streaming audio/video,
 * and orchestrates the Gemini Live API interaction pipeline.
 */

import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import { logger } from './logger';
import { GeminiLiveClient } from './geminiLiveClient';
import { MockGeminiClient } from './mockGeminiClient';
import { ToolExecutor } from './toolExecutor';
import { PlaywrightController } from './playwrightController';
import { SessionMemory } from './sessionMemory';
import { ScreenshotRelay } from './screenshotRelay';
import { validateConfigOrDie, ValidatedConfig } from './configValidator';
import { ComplianceGuard } from './complianceGuard';

dotenv.config();

// ── Startup Config Validation ─────────────────────────────────────────────────

let validatedConfig: ValidatedConfig;
try {
  validatedConfig = validateConfigOrDie();
} catch (err) {
  console.error('FATAL: Config validation failed. Server cannot start.');
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

// ── Global Error Handlers ─────────────────────────────────────────────────────

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', { promise, reason });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  // Allow graceful shutdown on next tick
  setTimeout(() => process.exit(1), 1000);
});

// ── Configuration ────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '8080', 10);
const SCREEN_CAPTURE_INTERVAL = parseInt(process.env.SCREEN_CAPTURE_INTERVAL_MS || '2500', 10);
const MAX_ACTIONS_PER_MINUTE = parseInt(process.env.MAX_ACTIONS_PER_MINUTE || '30', 10);
const IS_DEMO_MODE = process.env.DEMO_MODE === 'true';

if (IS_DEMO_MODE) {
  logger.info('═══ DEMO MODE ENABLED ═══ Using MockGeminiClient instead of Vertex AI');
}

// ── Express App ──────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve frontend static files in production
const frontendPath = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendPath));

// Health check endpoint for Cloud Run
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.1.0',
    config: {
      model: validatedConfig.modelName,
      location: validatedConfig.location,
      project: validatedConfig.projectId,
    },
  });
});

// Compliance status endpoint
app.get('/api/compliance', (_req, res) => {
  res.json({
    authMethod: 'Vertex AI OAuth2 (ADC)',
    apiKeys: 'NONE',
    model: validatedConfig.modelName,
    sandbox: 'Playwright headless Chromium',
    blockedCategories: ['medical', 'legal', 'financial', 'PII'],
    activeSessions: activeSessions.size,
  });
});

// Session status endpoint
app.get('/api/session/:sessionId', (req, res) => {
  const session = activeSessions.get(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json({
    sessionId: req.params.sessionId,
    connected: true,
    actionCount: session.memory.getHistory().length,
    createdAt: session.createdAt,
    demoMode: IS_DEMO_MODE,
  });
});

// Action history endpoint
app.get('/api/session/:sessionId/history', (req, res) => {
  const session = activeSessions.get(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json({ history: session.memory.getHistory() });
});

// Screenshot endpoint – returns latest Playwright screenshot as JPEG
app.get('/api/session/:sessionId/screenshot', (req, res) => {
  const session = activeSessions.get(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  const buffer = session.screenshotRelay.getLatestFrameBuffer();
  if (!buffer) {
    res.status(204).send();
    return;
  }
  res.set('Content-Type', 'image/jpeg');
  res.set('Cache-Control', 'no-cache');
  res.send(buffer);
});

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// ── HTTP Server ──────────────────────────────────────────────────────────────

const httpServer = http.createServer(app);

// ── Active Sessions ──────────────────────────────────────────────────────────

interface ActiveSession {
  ws: WebSocket;
  gemini: GeminiLiveClient | MockGeminiClient;
  toolExecutor: ToolExecutor;
  playwright: PlaywrightController;
  memory: SessionMemory;
  compliance: ComplianceGuard;
  screenshotRelay: ScreenshotRelay;
  createdAt: string;
  captureInterval: ReturnType<typeof setInterval> | null;
  actionTimestamps: number[];
  demoMode: boolean;
}

const activeSessions = new Map<string, ActiveSession>();

// ── Rate Limiter ─────────────────────────────────────────────────────────────

function isRateLimited(session: ActiveSession): boolean {
  const now = Date.now();
  const windowStart = now - 60_000;
  session.actionTimestamps = session.actionTimestamps.filter((t) => t > windowStart);
  return session.actionTimestamps.length >= MAX_ACTIONS_PER_MINUTE;
}

function recordAction(session: ActiveSession): void {
  session.actionTimestamps.push(Date.now());
}

// ── WebSocket Server ─────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

wss.on('listening', () => {
  logger.info(`WebSocket server listening on port ${PORT} at /ws`);
});

wss.on('connection', async (ws: WebSocket) => {
  const sessionId = uuidv4();
  logger.info(`New WebSocket connection: session=${sessionId}`);

  let playwrightCtrl: PlaywrightController | null = null;
  let geminiClient: GeminiLiveClient | MockGeminiClient | null = null;

  try {
    // Initialize Playwright browser
    playwrightCtrl = new PlaywrightController();
    await playwrightCtrl.initialize();
    logger.info(`Playwright browser initialized for session=${sessionId}`);

    // Initialize Gemini client (real or mock based on DEMO_MODE)
    if (IS_DEMO_MODE) {
      geminiClient = new MockGeminiClient(sessionId);
      await geminiClient.connect();
      logger.info(`MockGeminiClient connected for session=${sessionId} (DEMO_MODE)`);
    } else {
      const realClient = new GeminiLiveClient(sessionId);
      await realClient.connect();
      geminiClient = realClient;
      logger.info(`Gemini Live client connected for session=${sessionId}`);
    }

    // Initialize tool executor with Playwright
    const toolExecutor = new ToolExecutor(playwrightCtrl);
    const memory = new SessionMemory(sessionId);
    const compliance = new ComplianceGuard(false);
    const screenshotRelay = new ScreenshotRelay();
    compliance.logStartupReport();

    const session: ActiveSession = {
      ws,
      gemini: geminiClient,
      toolExecutor,
      playwright: playwrightCtrl,
      memory,
      compliance,
      screenshotRelay,
      createdAt: new Date().toISOString(),
      captureInterval: null,
      actionTimestamps: [],
      demoMode: IS_DEMO_MODE,
    };

    activeSessions.set(sessionId, session);

    // Send session ID to client
    sendToClient(ws, { type: 'session_started', sessionId });

    // ── Set up Gemini response handlers ───────────────────────────────────

    geminiClient.on('text', (text: string) => {
      logger.info(`Gemini text response: session=${sessionId}, length=${text.length}`);
      memory.addEntry({
        type: 'gemini_response',
        content: text,
        timestamp: new Date().toISOString(),
      });
      sendToClient(ws, { type: 'gemini_text', text });
    });

    geminiClient.on('audio', (audioData: string) => {
      sendToClient(ws, { type: 'gemini_audio', audio: audioData });
    });

    geminiClient.on('tool_call', async (toolCall: { name: string; args: Record<string, unknown> }) => {
      const toolT0 = Date.now();
      logger.info(`Tool call received: session=${sessionId}, tool=${toolCall.name}`);

      if (isRateLimited(session)) {
        const errorMsg = 'Rate limit exceeded: too many actions per minute';
        logger.warn(`${errorMsg}: session=${sessionId}`);
        sendToClient(ws, { type: 'error', error: errorMsg });
        await geminiClient!.sendToolResult(toolCall.name, { error: errorMsg }).catch(() => { });
        return;
      }

      // Compliance check — block disallowed actions
      const complianceResult = session.compliance.checkToolCall(toolCall.name, toolCall.args);
      if (!complianceResult.allowed) {
        const errorMsg = `Compliance blocked: ${complianceResult.reason}`;
        logger.warn(`${errorMsg}: session=${sessionId}`);
        sendToClient(ws, { type: 'error', error: errorMsg });
        sendToClient(ws, {
          type: 'tool_result',
          tool: toolCall.name,
          result: { error: errorMsg },
          status: 'blocked',
        });
        await geminiClient!.sendToolResult(toolCall.name, { error: errorMsg }).catch(() => { });
        return;
      }

      recordAction(session);

      // Send tool call trace to frontend
      sendToClient(ws, { type: 'agent_thinking', thinking: true });
      sendToClient(ws, {
        type: 'tool_call',
        tool: toolCall.name,
        args: toolCall.args,
        status: 'executing',
      });

      memory.addEntry({
        type: 'tool_call',
        content: JSON.stringify(toolCall),
        timestamp: new Date().toISOString(),
      });

      try {
        const result = await toolExecutor.execute(toolCall.name, toolCall.args);

        const toolLatency = Date.now() - toolT0;
        logger.info(`Tool execution completed: session=${sessionId}, tool=${toolCall.name}, latency=${toolLatency}ms`);

        memory.addEntry({
          type: 'tool_result',
          content: JSON.stringify(result),
          timestamp: new Date().toISOString(),
        });

        // Send result to Gemini for continued reasoning
        await geminiClient!.sendToolResult(toolCall.name, result as unknown as Record<string, unknown>);

        // Send trace update to frontend
        sendToClient(ws, {
          type: 'tool_result',
          tool: toolCall.name,
          result,
          status: 'completed',
        });
        sendToClient(ws, { type: 'agent_thinking', thinking: false });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown tool execution error';
        const toolLatency = Date.now() - toolT0;
        logger.error(`Tool execution failed: session=${sessionId}, tool=${toolCall.name}, error=${errorMessage}, latency=${toolLatency}ms`);

        memory.addEntry({
          type: 'tool_error',
          content: errorMessage,
          timestamp: new Date().toISOString(),
        });

        sendToClient(ws, {
          type: 'tool_result',
          tool: toolCall.name,
          result: { error: errorMessage },
          status: 'failed',
        });

        // Inform Gemini of the failure so it can retry or adapt
        await geminiClient!.sendToolResult(toolCall.name, { error: errorMessage }).catch(() => { });
        sendToClient(ws, { type: 'agent_thinking', thinking: false });
      }
    });

    geminiClient.on('error', (error: Error) => {
      logger.error(`Gemini error: session=${sessionId}, error=${error.message}`);
      sendToClient(ws, { type: 'error', error: error.message });
    });

    geminiClient.on('fatal_close', (info: { code: number; reason: string }) => {
      logger.error(
        `Gemini fatal close: session=${sessionId}, code=${info.code}, reason=${info.reason}`
      );
      sendToClient(ws, {
        type: 'error',
        error: `Gemini connection permanently lost: ${info.reason} (code ${info.code}). ` +
          'Check model name, credentials, and project configuration.',
      });
    });

    // ── Start periodic screen capture ──────────────────────────────────────

    session.captureInterval = setInterval(async () => {
      try {
        if (ws.readyState !== WebSocket.OPEN) return;
        const screenshot = await playwrightCtrl!.captureScreenshot();
        if (screenshot) {
          const currentUrl = playwrightCtrl!.getCurrentUrl();

          // Store in relay for HTTP endpoint and deduplication
          session.screenshotRelay.updateFrame(screenshot, currentUrl);

          // Send to Gemini for vision analysis
          await geminiClient!.sendImage(screenshot);

          // Relay to frontend for live browser view
          sendToClient(ws, { type: 'browser_frame', frame: screenshot });
          sendToClient(ws, { type: 'browser_url', url: currentUrl });
        }
      } catch (err) {
        logger.error(`Screen capture error: session=${sessionId}`, err);
      }
    }, SCREEN_CAPTURE_INTERVAL);

    // ── Handle incoming WebSocket messages from frontend ─────────────────

    ws.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        await handleClientMessage(sessionId, message);
      } catch (err) {
        // If JSON parsing fails, treat as raw audio data
        if (geminiClient && geminiClient.isConnected()) {
          await geminiClient.sendAudio(data.toString('base64'));
        }
      }
    });

    // ── Handle WebSocket close ────────────────────────────────────────────

    ws.on('close', async () => {
      logger.info(`WebSocket closed: session=${sessionId}`);
      await cleanupSession(sessionId);
    });

    ws.on('error', async (err) => {
      logger.error(`WebSocket error: session=${sessionId}`, err);
      await cleanupSession(sessionId);
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Session initialization failed';
    logger.error(`Session init error: ${errMsg}`);
    sendToClient(ws, { type: 'error', error: errMsg });

    // Cleanup partial initialization
    if (playwrightCtrl) await playwrightCtrl.close().catch(() => { });
    if (geminiClient) await geminiClient.disconnect().catch(() => { });
    ws.close();
  }
});

// ── Client Message Handler ───────────────────────────────────────────────────

async function handleClientMessage(
  sessionId: string,
  message: { type: string; data?: string; url?: string }
): Promise<void> {
  const session = activeSessions.get(sessionId);
  if (!session) {
    logger.warn(`Message for unknown session: ${sessionId}`);
    return;
  }

  switch (message.type) {
    case 'audio_chunk': {
      // Forward audio data to Gemini Live — counts as user input
      if (message.data && session.gemini.isConnected()) {
        session.compliance.resetActionCounter();
        await session.gemini.sendAudio(message.data);
      }
      break;
    }

    case 'screen_frame': {
      // Forward screen capture frame to Gemini
      if (message.data && session.gemini.isConnected()) {
        await session.gemini.sendImage(message.data);
      }
      break;
    }

    case 'navigate': {
      // Direct navigation command
      if (message.url) {
        session.compliance.resetActionCounter();
        const result = await session.toolExecutor.execute('navigate', { url: message.url });
        sendToClient(session.ws, { type: 'tool_result', tool: 'navigate', result, status: 'completed' });
      }
      break;
    }

    case 'text_input': {
      // Text prompt sent to Gemini — counts as user input
      if (message.data) {
        session.compliance.resetActionCounter();
        session.memory.addEntry({
          type: 'user_text',
          content: message.data,
          timestamp: new Date().toISOString(),
        });
        await session.gemini.sendText(message.data);
      }
      break;
    }

    case 'set_demo_mode': {
      // Toggle demo mode — restricts allowed domains
      const enabled = !!message.data;
      session.demoMode = enabled;
      session.compliance.setDemoMode(enabled);
      sendToClient(session.ws, { type: 'demo_mode', enabled });
      logger.info(`Demo mode ${enabled ? 'enabled' : 'disabled'}: session=${sessionId}`);
      break;
    }

    default:
      logger.warn(`Unknown message type: ${message.type}, session=${sessionId}`);
  }
}

// ── Utility: Send message to WebSocket client ────────────────────────────────

function sendToClient(ws: WebSocket, payload: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) {
    // Backpressure guard: if the send buffer is > 1 MB, skip non-critical messages
    if (ws.bufferedAmount > 1_048_576 && payload.type !== 'error' && payload.type !== 'session_started') {
      logger.warn('WebSocket backpressure – dropping non-critical message', { type: payload.type });
      return;
    }
    ws.send(JSON.stringify(payload));
  }
}

// ── Session Cleanup ──────────────────────────────────────────────────────────

async function cleanupSession(sessionId: string): Promise<void> {
  const session = activeSessions.get(sessionId);
  if (!session) return;

  logger.info(`Cleaning up session: ${sessionId}`);

  if (session.captureInterval) {
    clearInterval(session.captureInterval);
  }

  try {
    await session.gemini.disconnect();
  } catch (err) {
    logger.error(`Error disconnecting Gemini: session=${sessionId}`, err);
  }

  try {
    await session.playwright.close();
  } catch (err) {
    logger.error(`Error closing Playwright: session=${sessionId}`, err);
  }

  activeSessions.delete(sessionId);
  logger.info(`Session cleaned up: ${sessionId}`);
}

// ── Graceful Shutdown ────────────────────────────────────────────────────────

async function shutdown(): Promise<void> {
  logger.info('Shutting down CortexOS...');

  const cleanupPromises = Array.from(activeSessions.keys()).map((id) => cleanupSession(id));
  await Promise.allSettled(cleanupPromises);

  wss.close(() => {
    logger.info('WebSocket server closed');
  });

  httpServer.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ── Start Servers ────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  logger.info(`CortexOS server running on port ${PORT} (HTTP + WebSocket at /ws)`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

export { app, httpServer, wss };
