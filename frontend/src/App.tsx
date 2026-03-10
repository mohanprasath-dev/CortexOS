/**
 * CortexOS – Main Application Component (Rebuilt)
 *
 * 3-panel layout: CommandPanel (left) | BrowserView (center) | ActionTrace (right)
 * Manages WebSocket connection, microphone streaming, and all agent state.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { StatusBar } from './components/StatusBar';
import { CommandPanel } from './components/CommandPanel';
import { BrowserView } from './components/BrowserView';
import { ActionTrace, TraceEntry } from './components/ActionTrace';
import { createWebSocketClient, WebSocketClient, ServerMessage } from './websocket';
import { MicrophoneStreamer } from './mic';

// ── Types ────────────────────────────────────────────────────────────────────

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

// ── Error Toast Component ────────────────────────────────────────────────────

const ErrorToast: React.FC<{ message: string; onDismiss: () => void }> = ({ message, onDismiss }) => {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 5000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div className="error-toast" onClick={onDismiss}>
      ⚠ {message}
    </div>
  );
};

// ── App Component ────────────────────────────────────────────────────────────

const App: React.FC = () => {
  // Connection state
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [sessionId, setSessionId] = useState<string | null>(null);

  // UI state
  const [traces, setTraces] = useState<TraceEntry[]>([]);
  const [geminiText, setGeminiText] = useState<string>('');
  const [textInput, setTextInput] = useState<string>('');
  const [micActive, setMicActive] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [errorToast, setErrorToast] = useState<string | null>(null);

  // Browser view state
  const [browserFrame, setBrowserFrame] = useState<string | null>(null);
  const [browserUrl, setBrowserUrl] = useState<string>('about:blank');

  // Refs
  const wsClientRef = useRef<WebSocketClient | null>(null);
  const micRef = useRef<MicrophoneStreamer | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  // ── Add trace entry helper ─────────────────────────────────────────────

  const addTrace = useCallback((entry: Omit<TraceEntry, 'id' | 'timestamp'>) => {
    setTraces((prev) => [
      ...prev,
      {
        ...entry,
        id: `trace_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        timestamp: new Date().toISOString(),
      },
    ]);
  }, []);

  // ── Audio playback ─────────────────────────────────────────────────────

  const playAudioResponse = useCallback((base64Audio?: string) => {
    if (!base64Audio) return;
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext({ sampleRate: 24000 });
      }
      const audioCtx = audioContextRef.current;
      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const pcm16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(pcm16.length);
      for (let i = 0; i < pcm16.length; i++) {
        float32[i] = pcm16[i] / 32768;
      }
      const buffer = audioCtx.createBuffer(1, float32.length, 24000);
      buffer.getChannelData(0).set(float32);
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(audioCtx.destination);
      source.start();
    } catch (err) {
      console.error('Audio playback error:', err);
    }
  }, []);

  // ── WebSocket message handler ──────────────────────────────────────────

  const handleServerMessage = useCallback(
    (message: ServerMessage) => {
      switch (message.type) {
        case 'session_started':
          setSessionId(message.sessionId || null);
          addTrace({ type: 'system', content: `Session started: ${message.sessionId}` });
          break;

        case 'gemini_text':
          setGeminiText((prev) => prev + (message.text || ''));
          addTrace({ type: 'response', content: message.text || '' });
          break;

        case 'gemini_audio':
          playAudioResponse(message.audio);
          break;

        case 'tool_call':
          addTrace({
            type: 'tool_call',
            content: `${message.tool}(${JSON.stringify(message.args)})`,
            toolName: message.tool,
            toolStatus: 'executing',
          });
          break;

        case 'tool_result':
          addTrace({
            type: 'tool_result',
            content: JSON.stringify(message.result, null, 2),
            toolName: message.tool,
            toolStatus: message.status as 'completed' | 'failed',
          });
          break;

        case 'browser_frame':
          if (message.frame) {
            setBrowserFrame(message.frame);
          }
          break;

        case 'browser_url':
          if (message.url) {
            setBrowserUrl(message.url);
          }
          break;

        case 'agent_thinking':
          setIsThinking(!!message.thinking);
          break;

        case 'error':
          addTrace({ type: 'error', content: message.error || 'Unknown error' });
          setErrorToast(message.error || 'Unknown error');
          break;
      }
    },
    [addTrace, playAudioResponse]
  );

  // ── Connect / Disconnect ───────────────────────────────────────────────

  const connect = useCallback(() => {
    setStatus('connecting');
    setGeminiText('');
    setTraces([]);
    setBrowserFrame(null);
    setBrowserUrl('about:blank');
    setIsThinking(false);
    addTrace({ type: 'system', content: 'Connecting to CortexOS backend…' });

    const wsProto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${wsProto}://${window.location.host}/ws`;
    const client = createWebSocketClient(wsUrl);

    client.onOpen = () => {
      setStatus('connected');
      addTrace({ type: 'system', content: 'Connected to backend' });
    };

    client.onMessage = handleServerMessage;

    client.onClose = () => {
      setStatus('disconnected');
      setMicActive(false);
      setIsThinking(false);
      addTrace({ type: 'system', content: 'Disconnected from backend' });
    };

    client.onError = (err) => {
      setStatus('error');
      addTrace({ type: 'error', content: `Connection error: ${err}` });
      setErrorToast(`Connection failed: ${err}`);
    };

    client.connect();
    wsClientRef.current = client;
  }, [addTrace, handleServerMessage]);

  const disconnect = useCallback(() => {
    micRef.current?.stop();
    wsClientRef.current?.disconnect();
    setMicActive(false);
    setStatus('disconnected');
    setBrowserFrame(null);
    setIsThinking(false);
  }, []);

  // ── Microphone toggle ──────────────────────────────────────────────────

  const toggleMic = useCallback(async () => {
    if (micActive) {
      micRef.current?.stop();
      setMicActive(false);
      addTrace({ type: 'system', content: 'Microphone stopped' });
      return;
    }

    try {
      const mic = new MicrophoneStreamer((audioChunk: string) => {
        wsClientRef.current?.send({ type: 'audio_chunk', data: audioChunk });
      });
      await mic.start();
      micRef.current = mic;
      setMicActive(true);
      addTrace({ type: 'system', content: 'Microphone streaming started (16kHz PCM16)' });
    } catch (err) {
      addTrace({ type: 'error', content: `Microphone error: ${err}` });
      setErrorToast(`Microphone error: ${err}`);
    }
  }, [micActive, addTrace]);

  // ── Send text ──────────────────────────────────────────────────────────

  const sendText = useCallback(() => {
    if (!textInput.trim() || !wsClientRef.current) return;
    wsClientRef.current.send({ type: 'text_input', data: textInput.trim() });
    addTrace({ type: 'user', content: textInput.trim() });
    setGeminiText('');
    setTextInput('');
  }, [textInput, addTrace]);

  // ── Demo handler ———————————————————————————————————————————————————————

  const handleDemo = useCallback((command: string) => {
    if (!wsClientRef.current) {
      setTextInput(command);
      return;
    }
    wsClientRef.current.send({ type: 'text_input', data: command });
    addTrace({ type: 'user', content: `[DEMO] ${command}` });
    setGeminiText('');
  }, [addTrace]);

  // ── Cleanup on unmount ─────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      micRef.current?.stop();
      wsClientRef.current?.disconnect();
      audioContextRef.current?.close();
    };
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="cortex-app">
      <StatusBar
        status={status}
        sessionId={sessionId}
        demoMode={false}
        onConnect={connect}
        onDisconnect={disconnect}
      />

      <div className="cortex-main">
        <CommandPanel
          status={status}
          textInput={textInput}
          onTextChange={setTextInput}
          onSend={sendText}
          micActive={micActive}
          onToggleMic={toggleMic}
          isThinking={isThinking}
          onDemo={handleDemo}
          geminiText={geminiText}
        />

        <div className="panel-center">
          <BrowserView
            frame={browserFrame}
            currentUrl={browserUrl}
            isConnected={status === 'connected'}
            isConnecting={status === 'connecting'}
          />
        </div>

        <div className="panel-right">
          <ActionTrace entries={traces} />
        </div>
      </div>

      {/* Error Toast */}
      {errorToast && (
        <ErrorToast
          message={errorToast}
          onDismiss={() => setErrorToast(null)}
        />
      )}
    </div>
  );
};

export default App;
