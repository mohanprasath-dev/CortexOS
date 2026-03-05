/**
 * CortexOS – Session Memory
 *
 * Maintains an in-memory action log for each active session.
 * Stores all user inputs, Gemini responses, tool calls, and tool results
 * as structured entries. Used for:
 *
 * 1. Rendering the action trace in the frontend UI
 * 2. Providing context to Gemini for multi-step reasoning
 * 3. Debugging and observability
 *
 * Memory is session-scoped and purged when the session ends.
 * No persistent storage is used — this is intentional to keep the system
 * stateless and compliant with privacy requirements.
 */

import { logger } from './logger';

// ── Types ────────────────────────────────────────────────────────────────────

export type ActionEntryType =
  | 'user_audio'
  | 'user_text'
  | 'screen_capture'
  | 'gemini_response'
  | 'tool_call'
  | 'tool_result'
  | 'tool_error'
  | 'system_event';

export interface ActionEntry {
  type: ActionEntryType;
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

interface SessionStats {
  totalEntries: number;
  toolCalls: number;
  toolErrors: number;
  userInputs: number;
  geminiResponses: number;
  sessionDurationMs: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_ENTRIES = 500;
const CONTEXT_WINDOW_SIZE = 20;

// ── Session Memory ───────────────────────────────────────────────────────────

export class SessionMemory {
  private sessionId: string;
  private entries: ActionEntry[] = [];
  private createdAt: number;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.createdAt = Date.now();
    logger.info(`Session memory initialized: ${sessionId}`);
  }

  /**
   * Add a new entry to the session log.
   * Automatically trims old entries when the buffer exceeds MAX_ENTRIES.
   */
  addEntry(entry: ActionEntry): void {
    this.entries.push(entry);

    // Prune oldest entries if buffer is full (keep recent half)
    if (this.entries.length > MAX_ENTRIES) {
      const pruneCount = Math.floor(MAX_ENTRIES / 4);
      this.entries = this.entries.slice(pruneCount);
      logger.info(`Session memory pruned: ${this.sessionId}, removed ${pruneCount} oldest entries`);
    }
  }

  /**
   * Get the complete action history.
   */
  getHistory(): ActionEntry[] {
    return [...this.entries];
  }

  /**
   * Get recent entries within a context window.
   * Used for providing recent context to Gemini.
   */
  getRecentContext(windowSize: number = CONTEXT_WINDOW_SIZE): ActionEntry[] {
    return this.entries.slice(-windowSize);
  }

  /**
   * Get entries filtered by type.
   */
  getByType(type: ActionEntryType): ActionEntry[] {
    return this.entries.filter((e) => e.type === type);
  }

  /**
   * Get the last N tool call/result pairs for context.
   */
  getRecentToolActivity(count: number = 5): ActionEntry[] {
    return this.entries
      .filter((e) => e.type === 'tool_call' || e.type === 'tool_result' || e.type === 'tool_error')
      .slice(-count * 2);
  }

  /**
   * Build a condensed context string for Gemini.
   * Summarizes recent actions into a text block suitable for injection.
   */
  buildContextSummary(): string {
    const recent = this.getRecentContext(10);
    if (recent.length === 0) return 'No previous actions in this session.';

    const lines = recent.map((entry) => {
      const time = new Date(entry.timestamp).toLocaleTimeString();
      switch (entry.type) {
        case 'user_text':
          return `[${time}] User: ${entry.content}`;
        case 'gemini_response':
          return `[${time}] Assistant: ${entry.content.substring(0, 200)}`;
        case 'tool_call':
          return `[${time}] Tool Call: ${entry.content}`;
        case 'tool_result':
          return `[${time}] Tool Result: ${entry.content.substring(0, 200)}`;
        case 'tool_error':
          return `[${time}] Tool Error: ${entry.content}`;
        default:
          return `[${time}] ${entry.type}: ${entry.content.substring(0, 100)}`;
      }
    });

    return lines.join('\n');
  }

  /**
   * Get session statistics.
   */
  getStats(): SessionStats {
    return {
      totalEntries: this.entries.length,
      toolCalls: this.entries.filter((e) => e.type === 'tool_call').length,
      toolErrors: this.entries.filter((e) => e.type === 'tool_error').length,
      userInputs: this.entries.filter((e) => e.type === 'user_text' || e.type === 'user_audio').length,
      geminiResponses: this.entries.filter((e) => e.type === 'gemini_response').length,
      sessionDurationMs: Date.now() - this.createdAt,
    };
  }

  /**
   * Clear all entries (for testing or reset).
   */
  clear(): void {
    this.entries = [];
    logger.info(`Session memory cleared: ${this.sessionId}`);
  }
}
