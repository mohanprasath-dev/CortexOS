/**
 * CortexOS – Screen Capture Streamer
 *
 * Captures periodic screenshots of a browser tab or screen using the
 * Screen Capture API (getDisplayMedia). Images are compressed and resized
 * to JPEG before being sent to the backend for Gemini vision analysis.
 *
 * Capture pipeline:
 * 1. getDisplayMedia prompts user to select a screen/tab
 * 2. Video frames are captured onto a hidden canvas
 * 3. Canvas is exported as compressed JPEG
 * 4. Base64-encoded JPEG is sent via callback
 * 5. Repeats every CAPTURE_INTERVAL_MS
 *
 * Performance:
 * - Frames are resized to max 1024px width
 * - JPEG quality set to 60% to reduce bandwidth
 * - Capture interval is 2.5s to balance freshness vs. cost
 */

const CAPTURE_INTERVAL_MS = 2500;
const MAX_CAPTURE_WIDTH = 1024;
const JPEG_QUALITY = 0.6;

export class ScreenCaptureStreamer {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private onFrame: (base64Jpeg: string) => void;
  private active = false;

  constructor(onFrame: (base64Jpeg: string) => void) {
    this.onFrame = onFrame;
  }

  /**
   * Prompt the user to select a screen/tab and begin periodic capture.
   */
  async start(): Promise<void> {
    if (this.active) {
      console.warn('ScreenCaptureStreamer already active');
      return;
    }

    // Request screen capture permission
    this.stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 1 }, // Low framerate since we capture periodically
      },
      audio: false,
    });

    // Handle user stopping the share via browser UI
    this.stream.getVideoTracks()[0].addEventListener('ended', () => {
      console.log('Screen share ended by user');
      this.stop();
    });

    // Create a hidden video element to receive the stream
    this.video = document.createElement('video');
    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play();

    // Create a canvas for frame extraction
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');

    if (!this.ctx) {
      throw new Error('Failed to create canvas 2D context');
    }

    this.active = true;

    // Start periodic capture
    this.intervalId = setInterval(() => {
      this.captureFrame();
    }, CAPTURE_INTERVAL_MS);

    // Capture first frame immediately
    this.captureFrame();

    console.log(`ScreenCaptureStreamer started: interval=${CAPTURE_INTERVAL_MS}ms, quality=${JPEG_QUALITY}`);
  }

  /**
   * Stop capturing and release all resources.
   */
  stop(): void {
    this.active = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }

    this.canvas = null;
    this.ctx = null;

    console.log('ScreenCaptureStreamer stopped');
  }

  /**
   * Check if the streamer is currently active.
   */
  isActive(): boolean {
    return this.active;
  }

  // ── Private Helpers ──────────────────────────────────────────────────────

  /**
   * Capture a single frame from the video stream, resize, compress,
   * and send via callback.
   */
  private captureFrame(): void {
    if (!this.active || !this.video || !this.canvas || !this.ctx) return;

    const videoWidth = this.video.videoWidth;
    const videoHeight = this.video.videoHeight;

    if (videoWidth === 0 || videoHeight === 0) return;

    // Calculate resize dimensions (maintain aspect ratio)
    let targetWidth = videoWidth;
    let targetHeight = videoHeight;

    if (targetWidth > MAX_CAPTURE_WIDTH) {
      const scale = MAX_CAPTURE_WIDTH / targetWidth;
      targetWidth = MAX_CAPTURE_WIDTH;
      targetHeight = Math.round(videoHeight * scale);
    }

    // Set canvas size
    this.canvas.width = targetWidth;
    this.canvas.height = targetHeight;

    // Draw video frame onto canvas
    this.ctx.drawImage(this.video, 0, 0, targetWidth, targetHeight);

    // Export as JPEG and extract base64 payload (strip data URL prefix)
    const dataUrl = this.canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    const base64 = dataUrl.split(',')[1];

    if (base64) {
      this.onFrame(base64);
    }
  }
}
