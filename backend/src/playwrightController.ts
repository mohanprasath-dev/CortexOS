/**
 * CortexOS – Playwright Browser Controller
 *
 * Manages a sandboxed Chromium browser instance via Playwright.
 * Provides methods for navigation, interaction, text extraction, and screenshot
 * capture. All browser operations are confined to this sandbox — no OS-level access.
 *
 * Screenshots are compressed and resized before being sent to Gemini to
 * maintain the <2s response latency target.
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import sharp from 'sharp';
import { logger } from './logger';

// ── Configuration ────────────────────────────────────────────────────────────

const BROWSER_HEADLESS = process.env.BROWSER_HEADLESS !== 'false';
const VIEWPORT_WIDTH = parseInt(process.env.BROWSER_VIEWPORT_WIDTH || '1280', 10);
const VIEWPORT_HEIGHT = parseInt(process.env.BROWSER_VIEWPORT_HEIGHT || '720', 10);
const CAPTURE_QUALITY = parseInt(process.env.SCREEN_CAPTURE_QUALITY || '60', 10);
const CAPTURE_MAX_WIDTH = parseInt(process.env.SCREEN_CAPTURE_MAX_WIDTH || '1024', 10);

// ── Playwright Controller ────────────────────────────────────────────────────

export class PlaywrightController {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private initialized = false;

  /**
   * Initialize the browser instance with a sandboxed context.
   * Sets viewport, disables unnecessary features, and navigates to a blank page.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('PlaywrightController already initialized');
      return;
    }

    logger.info('Launching Chromium browser...');

    this.browser = await chromium.launch({
      headless: BROWSER_HEADLESS,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-sync',
        '--no-first-run',
        '--disable-infobars',
      ],
    });

    this.context = await this.browser.newContext({
      viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 CortexOS/1.0',
      ignoreHTTPSErrors: true,
      javaScriptEnabled: true,
    });

    this.page = await this.context.newPage();

    // Set default navigation timeout
    this.page.setDefaultNavigationTimeout(15_000);
    this.page.setDefaultTimeout(10_000);

    // Navigate to a blank start page.
    // NOTE: `about:` URLs are blocked by ComplianceGuard for user-facing tool calls,
    // but this internal initialization bypasses tool dispatch intentionally.
    await this.page.goto('about:blank');

    this.initialized = true;
    logger.info(`Browser initialized: headless=${BROWSER_HEADLESS}, viewport=${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT}`);
  }

  /**
   * Navigate to a URL. Waits for the network to be mostly idle.
   */
  async navigate(url: string): Promise<void> {
    this.ensureInitialized();
    logger.info(`Navigating to: ${url}`);

    await this.page!.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 15_000,
    });

    // Additional wait for dynamic content
    await this.page!.waitForTimeout(1000);
  }

  /**
   * Click on an element identified by CSS selector.
   * Waits for the element to be visible and stable before clicking.
   */
  async click(selector: string): Promise<void> {
    this.ensureInitialized();
    logger.info(`Clicking: ${selector}`);

    // Wait for element to be visible
    await this.page!.waitForSelector(selector, { state: 'visible', timeout: 5000 });
    await this.page!.click(selector, { timeout: 5000 });

    // Wait for potential navigation or DOM changes
    await this.page!.waitForTimeout(500);
  }

  /**
   * Type text into an input field. Clears the field first.
   */
  async type(selector: string, text: string): Promise<void> {
    this.ensureInitialized();
    logger.info(`Typing into: ${selector}, text length: ${text.length}`);

    // Wait for element
    await this.page!.waitForSelector(selector, { state: 'visible', timeout: 5000 });

    // Clear existing content
    await this.page!.click(selector, { clickCount: 3 });
    await this.page!.keyboard.press('Backspace');

    // Type with realistic delay
    await this.page!.type(selector, text, { delay: 30 });
  }

  /**
   * Extract text content from an element.
   */
  async extractText(selector: string): Promise<string> {
    this.ensureInitialized();
    logger.info(`Extracting text from: ${selector}`);

    await this.page!.waitForSelector(selector, { state: 'attached', timeout: 5000 });

    const text = await this.page!.evaluate((sel: string) => {
      // eslint-disable-next-line no-undef -- runs in browser context via Playwright
      const element = (globalThis as any).document.querySelector(sel);
      return element ? element.textContent?.trim() || '' : '';
    }, selector);

    return text;
  }

  /**
   * Get the page title.
   */
  async getTitle(): Promise<string> {
    this.ensureInitialized();
    return this.page!.title();
  }

  /**
   * Get the current URL.
   */
  getCurrentUrl(): string {
    this.ensureInitialized();
    return this.page!.url();
  }

  /**
   * Capture a screenshot of the current page.
   * Returns a compressed, resized base64-encoded JPEG string.
   *
   * Image processing pipeline:
   * 1. Full-page screenshot as PNG buffer
   * 2. Resize to max width (maintain aspect ratio)
   * 3. Convert to JPEG with configurable quality
   * 4. Encode to base64
   */
  async captureScreenshot(): Promise<string | null> {
    if (!this.initialized || !this.page) return null;

    try {
      // Capture raw screenshot
      const rawBuffer = await this.page.screenshot({
        type: 'png',
        fullPage: false,
      });

      // Compress and resize using sharp
      const processedBuffer = await sharp(rawBuffer)
        .resize(CAPTURE_MAX_WIDTH, undefined, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({
          quality: CAPTURE_QUALITY,
          progressive: true,
        })
        .toBuffer();

      const base64 = processedBuffer.toString('base64');
      logger.debug(`Screenshot captured: ${(processedBuffer.length / 1024).toFixed(1)}KB`);

      return base64;
    } catch (err) {
      logger.error('Screenshot capture failed', err);
      return null;
    }
  }

  /**
   * Scroll the page by a given amount.
   */
  async scroll(direction: 'up' | 'down', amount: number = 300): Promise<void> {
    this.ensureInitialized();
    const delta = direction === 'down' ? amount : -amount;
    await this.page!.mouse.wheel(0, delta);
    await this.page!.waitForTimeout(300);
  }

  /**
   * Wait for a specific selector to appear.
   */
  async waitForSelector(selector: string, timeoutMs: number = 5000): Promise<boolean> {
    this.ensureInitialized();
    try {
      await this.page!.waitForSelector(selector, { timeout: timeoutMs });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Close the browser and release all resources.
   */
  async close(): Promise<void> {
    if (this.context) {
      await this.context.close().catch(() => { });
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close().catch(() => { });
      this.browser = null;
    }
    this.page = null;
    this.initialized = false;
    logger.info('Playwright browser closed');
  }

  // ── Private Helpers ──────────────────────────────────────────────────────

  private ensureInitialized(): void {
    if (!this.initialized || !this.page) {
      throw new Error('PlaywrightController is not initialized. Call initialize() first.');
    }
  }
}
