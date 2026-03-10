/**
 * CortexOS – Mock Gemini Client (Demo Mode)
 *
 * Drop-in replacement for GeminiLiveClient when DEMO_MODE=true.
 * Emits a scripted sequence of events to simulate a realistic agent session
 * without requiring GCP credentials or a live Gemini API connection.
 *
 * Implements the same EventEmitter interface as GeminiLiveClient:
 *   Events emitted: 'text', 'audio', 'tool_call', 'error', 'turn_complete', 'fatal_close'
 *   Methods: connect(), disconnect(), isConnected(), sendText(), sendAudio(), sendImage(), sendToolResult()
 */

import { EventEmitter } from 'events';
import { logger } from './logger';

// ── Demo Sequence ────────────────────────────────────────────────────────────

interface DemoStep {
    delay: number;
    action: (client: MockGeminiClient) => void;
}

const DEMO_SEQUENCE: DemoStep[] = [
    {
        delay: 2000,
        action: (client) => {
            client.emit('text', "I can see the browser is ready. Let me navigate to example.com to demonstrate my capabilities.");
        },
    },
    {
        delay: 1500,
        action: (client) => {
            client.emit('tool_call', { name: 'navigate', args: { url: 'https://example.com' } });
        },
    },
    {
        delay: 3000,
        action: (client) => {
            client.emit('text', "I've navigated to example.com. Let me extract the page content.");
        },
    },
    {
        delay: 1000,
        action: (client) => {
            client.emit('tool_call', { name: 'extract', args: { selector: 'body' } });
        },
    },
    {
        delay: 2500,
        action: (client) => {
            client.emit('text',
                "I've extracted the page content. Here's a summary: Example.com is a simple " +
                "demonstration website maintained by IANA for illustrative examples in documentation. " +
                "The page contains basic information about the domain's purpose as a reserved domain."
            );
        },
    },
    {
        delay: 1000,
        action: (client) => {
            client.emit('turn_complete');
        },
    },
];

// ── Mock Gemini Client ───────────────────────────────────────────────────────

export class MockGeminiClient extends EventEmitter {
    private sessionId: string;
    private connected = false;
    private timers: ReturnType<typeof setTimeout>[] = [];
    private loopTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(sessionId: string) {
        super();
        this.sessionId = sessionId;
        logger.info(`MockGeminiClient created: session=${sessionId} (DEMO_MODE)`);
    }

    // ── Public API (matches GeminiLiveClient interface) ───────────────────

    async connect(): Promise<void> {
        this.connected = true;
        logger.info(`MockGeminiClient connected: session=${this.sessionId}`);
        // Simulate setup delay
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
    }

    async disconnect(): Promise<void> {
        this.connected = false;
        this.clearTimers();
        logger.info(`MockGeminiClient disconnected: session=${this.sessionId}`);
    }

    isConnected(): boolean {
        return this.connected;
    }

    async sendAudio(_base64Audio: string): Promise<void> {
        // No-op in demo mode — simulate acknowledgment
        if (!this.connected) return;
        logger.debug(`MockGeminiClient: audio received (ignored in demo mode)`);
    }

    async sendImage(_base64Image: string): Promise<void> {
        // No-op in demo mode
        if (!this.connected) return;
    }

    async sendText(text: string): Promise<void> {
        if (!this.connected) return;
        logger.info(`MockGeminiClient: text received: "${text.substring(0, 50)}..."`);

        // Simulate Gemini processing delay then run demo sequence
        this.clearTimers();
        this.runDemoSequence();
    }

    async sendToolResult(toolName: string, _result: Record<string, unknown>): Promise<void> {
        if (!this.connected) return;
        logger.info(`MockGeminiClient: tool result received for ${toolName}`);
    }

    // ── Private Helpers ────────────────────────────────────────────────────

    private runDemoSequence(): void {
        let cumulativeDelay = 0;

        for (const step of DEMO_SEQUENCE) {
            cumulativeDelay += step.delay;
            const timer = setTimeout(() => {
                if (this.connected) {
                    step.action(this);
                }
            }, cumulativeDelay);
            this.timers.push(timer);
        }

        // Schedule repeat after the sequence completes
        const totalDuration = cumulativeDelay + 15000;
        this.loopTimer = setTimeout(() => {
            if (this.connected) {
                this.runDemoSequence();
            }
        }, totalDuration);
    }

    private clearTimers(): void {
        for (const timer of this.timers) {
            clearTimeout(timer);
        }
        this.timers = [];
        if (this.loopTimer) {
            clearTimeout(this.loopTimer);
            this.loopTimer = null;
        }
    }
}
