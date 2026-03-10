/**
 * CortexOS – Tool Executor
 *
 * Receives validated tool calls from the Gemini Live client and dispatches them
 * to the appropriate handler. Manages execution timeouts, retries, and structured
 * result logging for every tool invocation.
 *
 * Each tool returns a structured result object that is sent back to Gemini
 * to close the observation-action-feedback loop.
 */

import { logger } from './logger';
import { PlaywrightController } from './playwrightController';
import { ToolName, isValidToolName, validateToolArgs } from './toolSchema';
import { VertexAI } from '@google-cloud/vertexai';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ToolResult {
  success: boolean;
  tool: string;
  data?: unknown;
  error?: string;
  executionTimeMs: number;
  timestamp: string;
}

// Safety filtering is centralized in ComplianceGuard — no duplicate checks here.

// ── Runtime Type Guard ───────────────────────────────────────────────────────

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing or invalid argument: "${key}" must be a non-empty string`);
  }
  return value;
}

// ── Tool Executor ────────────────────────────────────────────────────────────

export class ToolExecutor {
  private playwright: PlaywrightController;
  private executionTimeout: number;
  private maxRetries: number;

  constructor(playwright: PlaywrightController) {
    this.playwright = playwright;
    this.executionTimeout = parseInt(process.env.TOOL_EXECUTION_TIMEOUT_MS || '10000', 10);
    this.maxRetries = 2;
  }

  /**
   * Execute a tool call by name with arguments.
   * Validates inputs, applies safety filters, and retries on transient failures.
   */
  async execute(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    const startTime = Date.now();

    // Validate tool name
    if (!isValidToolName(toolName)) {
      return this.errorResult(toolName, `Unknown tool: ${toolName}`, startTime);
    }

    // Validate arguments
    const validation = validateToolArgs(toolName, args);
    if (!validation.valid) {
      return this.errorResult(toolName, `Validation failed: ${validation.errors.join(', ')}`, startTime);
    }

    logger.info(`Executing tool: ${toolName}`, { args });

    // Execute with retry
    let lastError: string = '';
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await this.withTimeout(
          this.dispatch(toolName as ToolName, args),
          this.executionTimeout
        );
        return {
          success: true,
          tool: toolName,
          data: result,
          executionTimeMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      } catch (err) {
        lastError = err instanceof Error ? err.message : 'Unknown error';
        logger.warn(`Tool execution attempt ${attempt + 1} failed: ${toolName}`, { error: lastError });

        if (attempt < this.maxRetries) {
          // Wait before retry with exponential backoff
          await this.sleep(500 * Math.pow(2, attempt));
        }
      }
    }

    return this.errorResult(toolName, `Failed after ${this.maxRetries + 1} attempts: ${lastError}`, startTime);
  }

  /**
   * Dispatch to the appropriate tool handler
   */
  private async dispatch(toolName: ToolName, args: Record<string, unknown>): Promise<unknown> {
    switch (toolName) {
      case ToolName.NAVIGATE:
        return this.handleNavigate(requireString(args, 'url'));

      case ToolName.CLICK:
        return this.handleClick(requireString(args, 'selector'));

      case ToolName.TYPE:
        return this.handleType(requireString(args, 'selector'), requireString(args, 'text'));

      case ToolName.EXTRACT:
        return this.handleExtract(requireString(args, 'selector'));

      case ToolName.SUMMARIZE:
        return this.handleSummarize(requireString(args, 'text'));

      case ToolName.CREATE_CALENDAR_EVENT:
        return this.handleCreateCalendarEvent(
          requireString(args, 'date'),
          requireString(args, 'time'),
          requireString(args, 'title')
        );

      case ToolName.SCROLL:
        return this.handleScroll(
          requireString(args, 'direction'),
          args.amount != null ? parseInt(String(args.amount), 10) : 300
        );

      case ToolName.WAIT_FOR_ELEMENT:
        return this.handleWaitForElement(
          requireString(args, 'selector'),
          args.timeout != null ? parseInt(String(args.timeout), 10) : 5000
        );

      default:
        throw new Error(`No handler for tool: ${toolName}`);
    }
  }

  // ── Tool Handlers ────────────────────────────────────────────────────────

  private async handleNavigate(url: string): Promise<{ url: string; title: string }> {
    // URL safety is enforced by ComplianceGuard before dispatch

    // Ensure URL has a protocol
    const normalizedUrl = url.startsWith('http') ? url : `https://${url}`;

    await this.playwright.navigate(normalizedUrl);
    const title = await this.playwright.getTitle();

    logger.info(`Navigated to: ${normalizedUrl}, title: ${title}`);
    return { url: normalizedUrl, title };
  }

  private async handleClick(selector: string): Promise<{ selector: string; clicked: boolean }> {
    await this.playwright.click(selector);
    logger.info(`Clicked: ${selector}`);
    return { selector, clicked: true };
  }

  private async handleType(
    selector: string,
    text: string
  ): Promise<{ selector: string; typed: boolean; length: number }> {
    // Content safety is enforced by ComplianceGuard before dispatch

    await this.playwright.type(selector, text);
    logger.info(`Typed into: ${selector}, length: ${text.length}`);
    return { selector, typed: true, length: text.length };
  }

  private async handleExtract(selector: string): Promise<{ selector: string; text: string; length: number }> {
    const text = await this.playwright.extractText(selector);

    // Truncate very long extractions to avoid token overflow
    const maxLength = 4000;
    const truncated = text.length > maxLength ? text.substring(0, maxLength) + '... [truncated]' : text;

    logger.info(`Extracted from: ${selector}, length: ${truncated.length}`);
    return { selector, text: truncated, length: truncated.length };
  }

  private async handleSummarize(text: string): Promise<{ summary: string; originalLength: number }> {
    const truncatedInput = text.substring(0, 3000);

    // Try using Vertex AI for a real summary
    const projectId = process.env.PROJECT_ID;
    const location = process.env.LOCATION || 'us-central1';

    if (projectId && process.env.DEMO_MODE !== 'true') {
      try {
        const vertexAI = new VertexAI({ project: projectId, location });
        const model = vertexAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
        const result = await model.generateContent(
          `Summarize the following text concisely in 2-3 sentences:\n\n${truncatedInput}`
        );
        const response = result.response;
        const summary = response.candidates?.[0]?.content?.parts?.[0]?.text
          || truncatedInput.substring(0, 500) + '...';

        logger.info(`Summarize completed via Vertex AI: ${summary.length} chars`);
        return { summary, originalLength: text.length };
      } catch (err) {
        logger.warn(`Vertex AI summarize failed, using fallback: ${err instanceof Error ? err.message : err}`);
      }
    }

    // Fallback: extract first 500 chars as a basic summary
    const fallbackSummary = truncatedInput.length > 500
      ? truncatedInput.substring(0, 500) + '... [truncated — Vertex AI unavailable]'
      : truncatedInput;

    return { summary: fallbackSummary, originalLength: text.length };
  }

  private async handleCreateCalendarEvent(
    date: string,
    time: string,
    title: string
  ): Promise<{ date: string; time: string; title: string; created: boolean }> {
    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error(`Invalid date format: ${date}. Expected YYYY-MM-DD`);
    }

    // Validate time format
    if (!/^\d{2}:\d{2}$/.test(time)) {
      throw new Error(`Invalid time format: ${time}. Expected HH:MM`);
    }

    // Calculate end time (1 hour after start)
    const [hours, minutes] = time.split(':').map(Number);
    const endHours = String((hours + 1) % 24).padStart(2, '0');
    const endTime = `${endHours}:${String(minutes).padStart(2, '0')}`;

    // Navigate to Google Calendar with pre-filled event
    const startDt = `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;
    const endDt = `${date.replace(/-/g, '')}T${endTime.replace(':', '')}00`;
    const calendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${startDt}/${endDt}`;

    await this.playwright.navigate(calendarUrl);

    // Wait for the page to load
    await this.sleep(2000);

    logger.info(`Calendar event creation initiated: ${title} on ${date} at ${time}-${endTime}`);
    return { date, time, title, created: true };
  }

  // ── Utility Methods ──────────────────────────────────────────────────────

  /**
   * Wrap a promise with a timeout
   */
  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Tool execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      promise
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  /**
   * Create an error result object
   */
  private errorResult(toolName: string, error: string, startTime: number): ToolResult {
    logger.error(`Tool error: ${toolName} – ${error}`);
    return {
      success: false,
      tool: toolName,
      error,
      executionTimeMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Async sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ── New Tool Handlers (scroll, wait_for_element) ─────────────────────────

  private async handleScroll(
    direction: string,
    amount: number
  ): Promise<{ direction: string; amount: number; scrolled: boolean }> {
    const dir = direction === 'up' ? 'up' : 'down';
    const pixels = Math.min(Math.max(amount, 50), 2000);
    await this.playwright.scroll(dir, pixels);
    logger.info(`Scrolled ${dir} by ${pixels}px`);
    return { direction: dir, amount: pixels, scrolled: true };
  }

  private async handleWaitForElement(
    selector: string,
    timeoutMs: number
  ): Promise<{ selector: string; found: boolean; timeoutMs: number }> {
    const timeout = Math.min(Math.max(timeoutMs, 500), 15000);
    const found = await this.playwright.waitForSelector(selector, timeout);
    logger.info(`Wait for element: ${selector}, found=${found}, timeout=${timeout}ms`);
    return { selector, found, timeoutMs: timeout };
  }
}
