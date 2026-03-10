/**
 * CortexOS – Screenshot Relay
 *
 * Holds the latest screenshot buffer and makes it available to multiple consumers:
 * 1. Gemini Live API (for vision analysis)
 * 2. Frontend WebSocket (for live browser view)
 * 3. HTTP endpoint (for screenshot API)
 *
 * Avoids duplicating the Sharp image processing pipeline by storing
 * the processed base64 JPEG once and reading it from multiple paths.
 */

import { logger } from './logger';

export class ScreenshotRelay {
    private latestFrame: string | null = null;
    private latestUrl: string = 'about:blank';
    private frameCount = 0;

    /**
     * Store a new screenshot frame.
     */
    updateFrame(base64Jpeg: string, currentUrl: string): void {
        this.latestFrame = base64Jpeg;
        this.latestUrl = currentUrl;
        this.frameCount++;

        if (this.frameCount % 10 === 0) {
            logger.debug(`ScreenshotRelay: ${this.frameCount} frames relayed, latest URL: ${currentUrl}`);
        }
    }

    /**
     * Get the latest screenshot as base64 JPEG.
     */
    getLatestFrame(): string | null {
        return this.latestFrame;
    }

    /**
     * Get the latest browser URL.
     */
    getLatestUrl(): string {
        return this.latestUrl;
    }

    /**
     * Get the latest screenshot as a JPEG Buffer (for HTTP responses).
     */
    getLatestFrameBuffer(): Buffer | null {
        if (!this.latestFrame) return null;
        return Buffer.from(this.latestFrame, 'base64');
    }

    /**
     * Get relay statistics.
     */
    getStats(): { frameCount: number; hasFrame: boolean; currentUrl: string } {
        return {
            frameCount: this.frameCount,
            hasFrame: this.latestFrame !== null,
            currentUrl: this.latestUrl,
        };
    }
}
