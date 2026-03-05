/**
 * CortexOS – Microphone Streamer (AudioWorklet)
 *
 * Captures live audio from the user's microphone using the Web Audio API,
 * processes it into 16kHz PCM16 mono format suitable for the Gemini Live API,
 * and streams base64-encoded audio chunks to the backend via WebSocket.
 *
 * Uses AudioWorkletNode (replacing the deprecated ScriptProcessorNode)
 * for reliable, main-thread-unblocking audio processing.
 *
 * Audio processing pipeline:
 * 1. getUserMedia captures raw microphone audio (browser default sample rate)
 * 2. AudioWorklet downsamples to 16kHz
 * 3. Float32 samples are converted to PCM16 (Int16)
 * 4. PCM16 buffer is base64-encoded
 * 5. Chunks are sent via the provided callback
 */

// Target sample rate for Gemini Live API
const TARGET_SAMPLE_RATE = 16000;

// AudioWorklet processor code (inlined as a Blob URL)
const WORKLET_CODE = `
class PCM16Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._bufferSize = 4096;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0];
    for (let i = 0; i < channelData.length; i++) {
      this._buffer.push(channelData[i]);
    }

    if (this._buffer.length >= this._bufferSize) {
      const chunk = this._buffer.splice(0, this._bufferSize);
      this.port.postMessage({ type: 'audio', data: new Float32Array(chunk) });
    }

    return true;
  }
}

registerProcessor('pcm16-processor', PCM16Processor);
`;

export class MicrophoneStreamer {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
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

    // Create audio context at OS sample rate (we'll downsample in the worklet message handler)
    this.audioContext = new AudioContext();
    const nativeSampleRate = this.audioContext.sampleRate;

    // Register the AudioWorklet processor from an inline Blob
    const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
    const workletUrl = URL.createObjectURL(blob);
    await this.audioContext.audioWorklet.addModule(workletUrl);
    URL.revokeObjectURL(workletUrl);

    // Create audio source from microphone stream
    this.source = this.audioContext.createMediaStreamSource(this.stream);

    // Create AudioWorkletNode
    this.workletNode = new AudioWorkletNode(this.audioContext, 'pcm16-processor');

    // Downsample ratio
    const downsampleRatio = nativeSampleRate / TARGET_SAMPLE_RATE;

    this.workletNode.port.onmessage = (event: MessageEvent) => {
      if (!this.active) return;

      const inputData: Float32Array = event.data.data;

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

    // Connect: source → workletNode
    this.source.connect(this.workletNode);
    // AudioWorkletNode does not need to be connected to destination for processing

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

    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
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
