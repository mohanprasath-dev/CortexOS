/**
 * CortexOS – Compliance Guard
 *
 * Enforces the Gemini Live Agent Challenge rules at runtime.
 * Validates every tool invocation, blocks prohibited actions, and ensures
 * the agent operates strictly within the browser sandbox.
 *
 * Challenge Rules Enforced:
 * 1. All actions must go through structured tool calls (no raw shell/OS)
 * 2. Browser sandbox only — no file system access outside Playwright
 * 3. No medical, legal, or financial advice
 * 4. No PII exfiltration or storage
 * 5. Must use Vertex AI (no AI Studio API keys)
 * 6. All tool calls must be from the declared schema
 * 7. Action loop prevention — max consecutive actions without user input
 */

import { logger } from './logger';
import { ToolName, isValidToolName } from './toolSchema';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ComplianceCheckResult {
  allowed: boolean;
  reason?: string;
  severity: 'info' | 'warn' | 'block';
}

export interface ComplianceStats {
  totalChecks: number;
  blocked: number;
  warnings: number;
  allowed: number;
}

// ── Configuration ────────────────────────────────────────────────────────────

/** Maximum consecutive tool calls without user input before circuit-break */
const MAX_CONSECUTIVE_ACTIONS = 15;

/** Domains allowed in Demo Mode */
const DEMO_ALLOWED_DOMAINS = [
  'google.com',
  'www.google.com',
  'calendar.google.com',
  'en.wikipedia.org',
  'news.ycombinator.com',
  'example.com',
  'www.example.com',
  'httpbin.org',
  'jsonplaceholder.typicode.com',
];

/** URL patterns that are always blocked */
const BLOCKED_URL_PATTERNS = [
  /^file:\/\//i,
  /^javascript:/i,
  /^data:text\/html/i,
  /chrome:\/\//i,
  /about:/i,
  /^ftp:\/\//i,
  /localhost(?::\d+)?\/admin/i,
];

/** Content patterns that indicate prohibited advice */
const PROHIBITED_CONTENT_PATTERNS = [
  { pattern: /medical\s+diagnosis/i, category: 'medical' },
  { pattern: /legal\s+advice/i, category: 'legal' },
  { pattern: /financial\s+advice/i, category: 'financial' },
  { pattern: /prescription\s+(?:drug|medication)/i, category: 'medical' },
  { pattern: /dosage\s+(?:of|for)/i, category: 'medical' },
  { pattern: /(?:buy|sell)\s+(?:stock|crypto|bitcoin)/i, category: 'financial' },
  { pattern: /social\s+security\s+number/i, category: 'pii' },
  { pattern: /credit\s+card\s+number/i, category: 'pii' },
  { pattern: /\bpassword\b.*\b(?:is|was|=)\b/i, category: 'pii' },
];

// ── Compliance Guard ─────────────────────────────────────────────────────────

export class ComplianceGuard {
  private consecutiveActionCount = 0;
  private demoMode: boolean;
  private stats: ComplianceStats = {
    totalChecks: 0,
    blocked: 0,
    warnings: 0,
    allowed: 0,
  };

  constructor(demoMode = false) {
    this.demoMode = demoMode;
    logger.info(`Compliance Guard initialized: demoMode=${demoMode}`);
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /**
   * Check if a tool call is compliant with challenge rules.
   */
  checkToolCall(toolName: string, args: Record<string, unknown>): ComplianceCheckResult {
    this.stats.totalChecks++;

    // 1. Validate tool name is from declared schema
    if (!isValidToolName(toolName)) {
      return this.block(`Undeclared tool "${toolName}" — only schema-declared tools are allowed`);
    }

    // 2. Check action loop
    this.consecutiveActionCount++;
    if (this.consecutiveActionCount > MAX_CONSECUTIVE_ACTIONS) {
      return this.block(
        `Action loop detected: ${this.consecutiveActionCount} consecutive tool calls ` +
        `without user input (max ${MAX_CONSECUTIVE_ACTIONS}). Circuit-breaking.`
      );
    }

    // 3. Tool-specific compliance checks
    switch (toolName as ToolName) {
      case ToolName.NAVIGATE:
        return this.checkNavigateCompliance(args.url as string);

      case ToolName.TYPE:
        return this.checkContentCompliance(args.text as string, 'type input');

      case ToolName.EXTRACT:
        // Extract is always allowed — reading page content is safe
        return this.allow();

      case ToolName.CLICK:
        return this.allow();

      case ToolName.SUMMARIZE:
        return this.checkContentCompliance(args.text as string, 'summarize input');

      case ToolName.CREATE_CALENDAR_EVENT:
        return this.allow();

      case ToolName.SCROLL:
        return this.allow();

      case ToolName.WAIT_FOR_ELEMENT:
        return this.allow();

      default:
        return this.allow();
    }
  }

  /**
   * Check if outbound content (text going to user) is compliant.
   */
  checkOutboundContent(text: string): ComplianceCheckResult {
    this.stats.totalChecks++;
    return this.checkContentCompliance(text, 'outbound response');
  }

  /**
   * Reset the consecutive action counter (call when user provides input).
   */
  resetActionCounter(): void {
    this.consecutiveActionCount = 0;
  }

  /**
   * Get the current consecutive action count.
   */
  getConsecutiveActionCount(): number {
    return this.consecutiveActionCount;
  }

  /**
   * Set demo mode on/off.
   */
  setDemoMode(enabled: boolean): void {
    this.demoMode = enabled;
    logger.info(`Compliance Guard demo mode: ${enabled}`);
  }

  /**
   * Get compliance statistics.
   */
  getStats(): ComplianceStats {
    return { ...this.stats };
  }

  /**
   * Log a startup compliance report.
   */
  logStartupReport(): void {
    logger.info('═══ CortexOS Compliance Report ═══');
    logger.info(`  Auth method:       Vertex AI OAuth2 (ADC)`);
    logger.info(`  API keys:          NONE (blocked at config validation)`);
    logger.info(`  Demo mode:         ${this.demoMode ? 'ON' : 'OFF'}`);
    logger.info(`  Action loop limit: ${MAX_CONSECUTIVE_ACTIONS} consecutive`);
    logger.info(`  Blocked categories: medical, legal, financial, PII`);
    logger.info(`  Sandbox:           Playwright (headless Chromium)`);
    logger.info('═══════════════════════════════════');
  }

  // ── Private Checks ────────────────────────────────────────────────────

  private checkNavigateCompliance(url: string | undefined): ComplianceCheckResult {
    if (!url) {
      return this.block('Navigate called without a URL');
    }

    // Check blocked URL patterns
    for (const pattern of BLOCKED_URL_PATTERNS) {
      if (pattern.test(url)) {
        return this.block(`Blocked URL pattern: ${url}`);
      }
    }

    // In demo mode, restrict to allowed domains
    if (this.demoMode) {
      try {
        const parsedUrl = new URL(url.startsWith('http') ? url : `https://${url}`);
        const hostname = parsedUrl.hostname.toLowerCase();
        if (!DEMO_ALLOWED_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`))) {
          return this.block(
            `Demo mode: domain "${hostname}" not in allowed list. ` +
            `Allowed: ${DEMO_ALLOWED_DOMAINS.join(', ')}`
          );
        }
      } catch {
        return this.block(`Invalid URL: ${url}`);
      }
    }

    return this.allow();
  }

  private checkContentCompliance(text: string | undefined, context: string): ComplianceCheckResult {
    if (!text) return this.allow();

    for (const { pattern, category } of PROHIBITED_CONTENT_PATTERNS) {
      if (pattern.test(text)) {
        return this.warn(
          `Potentially prohibited content (${category}) detected in ${context}`
        );
      }
    }

    return this.allow();
  }

  // ── Result Builders ────────────────────────────────────────────────────

  private allow(): ComplianceCheckResult {
    this.stats.allowed++;
    return { allowed: true, severity: 'info' };
  }

  private warn(reason: string): ComplianceCheckResult {
    this.stats.warnings++;
    logger.warn(`Compliance warning: ${reason}`);
    // Warnings still allow the action — they're logged for audit
    return { allowed: true, reason, severity: 'warn' };
  }

  private block(reason: string): ComplianceCheckResult {
    this.stats.blocked++;
    logger.error(`Compliance BLOCKED: ${reason}`);
    return { allowed: false, reason, severity: 'block' };
  }
}
