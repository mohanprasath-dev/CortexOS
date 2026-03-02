/**
 * CortexOS – Microphone Streamer
 *
 * Captures live audio from the user's microphone using the Web Audio API,
 * processes it into 16kHz PCM16 mono format suitable for the Gemini Live API,
 * and streams base64-encoded audio chunks to the backend via WebSocket.
 *
 * Audio processing pipeline:
 * 1. getUserMedia captures raw microphone audio (browser default sample rate)
 * 2. AudioWorklet or ScriptProcessor downsamples to 16kHz
 * 3. Float32 samples are converted to PCM16 (Int16)
 * 4. PCM16 buffer is base64-encoded
 * 5. Chunks are sent via the provided callback
 */

// Target sample rate for Gemini Live API
const TARGET_SAMPLE_RATE = 16000;

// Buffer size for audio processing (in samples at target rate)
const BUFFER_SIZE = 4096;

export class MicrophoneStreamer {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private onChunk: (base64Audio: string) => void;
  private active = false;

  constructor(onChunk: (base64Audio: string) => void) {
    this.onChunk = onChunk;
  }

  /**
   * Request microphone access and begin streaming audio chunks.
   */
  async start(): Promise<void> {
    if (this.active) {
      console.warn('MicrophoneStreamer already active');
      return;
    }

    // Request microphone access with optimal constraints
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: { ideal: TARGET_SAMPLE_RATE },
      },
      video: false,
    });

    // Create audio context at OS sample rate (we'll downsample manually)
    this.audioContext = new AudioContext();
    const nativeSampleRate = this.audioContext.sampleRate;

    // Create audio source from microphone stream
    this.source = this.audioContext.createMediaStreamSource(this.stream);

    // Use ScriptProcessorNode for broad compatibility
    // (AudioWorklet would be preferred for production but requires more setup)
    this.processor = this.audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);

    // Downsample ratio
    const downsampleRatio = nativeSampleRate / TARGET_SAMPLE_RATE;

    this.processor.onaudioprocess = (event: AudioProcessingEvent) => {
      if (!this.active) return;

      const inputData = event.inputBuffer.getChannelData(0);

      // Downsample from native rate to 16kHz
      const outputLength = Math.floor(inputData.length / downsampleRatio);
      const pcm16 = new Int16Array(outputLength);

      for (let i = 0; i < outputLength; i++) {
        const sourceIndex = Math.floor(i * downsampleRatio);
        // Clamp and convert Float32 [-1, 1] to Int16 [-32768, 32767]
        const sample = Math.max(-1, Math.min(1, inputData[sourceIndex]));
        pcm16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      }

      // Convert Int16Array to base64
      const base64 = this.int16ArrayToBase64(pcm16);
      this.onChunk(base64);
    };

    // Connect: source → processor → destination (required for ScriptProcessor to work)
    this.source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);

    this.active = true;
    console.log(
      `MicrophoneStreamer started: native=${nativeSampleRate}Hz, target=${TARGET_SAMPLE_RATE}Hz, ratio=${downsampleRatio.toFixed(2)}`
    );
  }

  /**
   * Stop microphone streaming and release all resources.
   */
  stop(): void {
    this.active = false;

    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }

    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }

    if (this.audioContext) {
      this.audioContext.close().catch(console.error);
      this.audioContext = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    console.log('MicrophoneStreamer stopped');
  }

  /**
   * Check if the streamer is currently active.
   */
  isActive(): boolean {
    return this.active;
  }

  // ── Private Helpers ──────────────────────────────────────────────────────

  /**
   * Convert an Int16Array to a base64-encoded string.
   */
  private int16ArrayToBase64(data: Int16Array): string {
    const bytes = new Uint8Array(data.buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}
