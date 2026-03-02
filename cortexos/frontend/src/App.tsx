/**
 * CortexOS – Main Application Component
 *
 * Orchestrates the real-time multimodal workspace agent UI.
 * Manages WebSocket connection, microphone streaming, screen capture,
 * and renders the action trace panel alongside the agent controls.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ActionTrace, TraceEntry } from './components/ActionTrace';
import { createWebSocketClient, WebSocketClient, ServerMessage } from './websocket';
import { MicrophoneStreamer } from './mic';
import { ScreenCaptureStreamer } from './screenCapture';

// ── Styles ───────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    backgroundColor: '#0a0a0f',
    color: '#e0e0e0',
    fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 24px',
    borderBottom: '1px solid #1a1a2e',
    background: 'linear-gradient(135deg, #0d0d1a 0%, #1a1a2e 100%)',
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  logoText: {
    fontSize: '20px',
    fontWeight: 700,
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  statusBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '4px 12px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: 500,
  },
  statusDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
  },
  main: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  controlPanel: {
    display: 'flex',
    flexDirection: 'column',
    width: '50%',
    borderRight: '1px solid #1a1a2e',
    padding: '20px',
    gap: '16px',
    overflowY: 'auto',
  },
  tracePanel: {
    display: 'flex',
    flexDirection: 'column',
    width: '50%',
    overflow: 'hidden',
  },
  section: {
    padding: '16px',
    borderRadius: '8px',
    border: '1px solid #1a1a2e',
    backgroundColor: '#0f0f1a',
  },
  sectionTitle: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#8b8ba0',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    marginBottom: '12px',
  },
  buttonGroup: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap' as const,
  },
  button: {
    padding: '10px 20px',
    borderRadius: '6px',
    border: 'none',
    fontWeight: 600,
    fontSize: '13px',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  primaryButton: {
    backgroundColor: '#6366f1',
    color: '#fff',
  },
  dangerButton: {
    backgroundColor: '#ef4444',
    color: '#fff',
  },
  secondaryButton: {
    backgroundColor: '#1e1e3a',
    color: '#c0c0d0',
    border: '1px solid #2a2a4a',
  },
  disabledButton: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  textInput: {
    width: '100%',
    padding: '12px 16px',
    borderRadius: '6px',
    border: '1px solid #2a2a4a',
    backgroundColor: '#0d0d1a',
    color: '#e0e0e0',
    fontSize: '14px',
    outline: 'none',
    resize: 'none' as const,
  },
  responseArea: {
    padding: '16px',
    borderRadius: '6px',
    backgroundColor: '#0d0d1a',
    border: '1px solid #1a1a2e',
    maxHeight: '200px',
    overflowY: 'auto' as const,
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '13px',
    lineHeight: '1.6',
    whiteSpace: 'pre-wrap' as const,
  },
  inputRow: {
    display: 'flex',
    gap: '8px',
  },
};

// ── App Component ────────────────────────────────────────────────────────────

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

const App: React.FC = () => {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [traces, setTraces] = useState<TraceEntry[]>([]);
  const [geminiText, setGeminiText] = useState<string>('');
  const [textInput, setTextInput] = useState<string>('');
  const [micActive, setMicActive] = useState(false);
  const [screenActive, setScreenActive] = useState(false);
  const [captureCount, setCaptureCount] = useState(0);
  const [demoMode, setDemoMode] = useState(false);
  const [traceCollapsed, setTraceCollapsed] = useState(false);

  const wsClientRef = useRef<WebSocketClient | null>(null);
  const micRef = useRef<MicrophoneStreamer | null>(null);
  const screenRef = useRef<ScreenCaptureStreamer | null>(null);

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
          // Audio response — play through AudioContext
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

        case 'screen_capture':
          setCaptureCount((c) => c + 1);
          break;

        case 'error':
          addTrace({ type: 'error', content: message.error || 'Unknown error' });
          break;
      }
    },
    [addTrace]
  );

  // ── Audio playback for Gemini audio responses ──────────────────────────

  const audioContextRef = useRef<AudioContext | null>(null);

  const playAudioResponse = (base64Audio?: string) => {
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
      // PCM16 to Float32
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
  };

  // ── Connect / Disconnect ───────────────────────────────────────────────

  const connect = useCallback(() => {
    setStatus('connecting');
    setGeminiText('');
    setTraces([]);
    setCaptureCount(0);
    addTrace({ type: 'system', content: 'Connecting to CortexOS backend...' });

    const wsUrl = `ws://${window.location.hostname}:8081`;
    const client = createWebSocketClient(wsUrl);

    client.onOpen = () => {
      setStatus('connected');
      addTrace({ type: 'system', content: 'Connected to backend' });
    };

    client.onMessage = handleServerMessage;

    client.onClose = () => {
      setStatus('disconnected');
      setMicActive(false);
      setScreenActive(false);
      addTrace({ type: 'system', content: 'Disconnected from backend' });
    };

    client.onError = (err) => {
      setStatus('error');
      addTrace({ type: 'error', content: `Connection error: ${err}` });
    };

    client.connect();
    wsClientRef.current = client;
  }, [addTrace, handleServerMessage]);

  const disconnect = useCallback(() => {
    micRef.current?.stop();
    screenRef.current?.stop();
    wsClientRef.current?.disconnect();
    setMicActive(false);
    setScreenActive(false);
    setStatus('disconnected');
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
    }
  }, [micActive, addTrace]);

  // ── Screen capture toggle ──────────────────────────────────────────────

  const toggleScreen = useCallback(async () => {
    if (screenActive) {
      screenRef.current?.stop();
      setScreenActive(false);
      addTrace({ type: 'system', content: 'Screen capture stopped' });
      return;
    }

    try {
      const screen = new ScreenCaptureStreamer((frame: string) => {
        wsClientRef.current?.send({ type: 'screen_frame', data: frame });
      });
      await screen.start();
      screenRef.current = screen;
      setScreenActive(true);
      addTrace({ type: 'system', content: 'Screen capture streaming started' });
    } catch (err) {
      addTrace({ type: 'error', content: `Screen capture error: ${err}` });
    }
  }, [screenActive, addTrace]);

  // ── Send text input ────────────────────────────────────────────────────

  const sendText = useCallback(() => {
    if (!textInput.trim() || !wsClientRef.current) return;
    wsClientRef.current.send({ type: 'text_input', data: textInput.trim() });
    addTrace({ type: 'user', content: textInput.trim() });
    setGeminiText('');
    setTextInput('');
  }, [textInput, addTrace]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendText();
      }
    },
    [sendText]
  );

  // ── Cleanup on unmount ─────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      micRef.current?.stop();
      screenRef.current?.stop();
      wsClientRef.current?.disconnect();
      audioContextRef.current?.close();
    };
  }, []);

  // ── Status badge color ─────────────────────────────────────────────────

  const statusColors: Record<ConnectionStatus, string> = {
    disconnected: '#6b7280',
    connecting: '#f59e0b',
    connected: '#10b981',
    error: '#ef4444',
  };

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.logo}>
          <span style={{ fontSize: '24px' }}>&#x1F9E0;</span>
          <span style={styles.logoText}>CortexOS</span>
          <span style={{ fontSize: '12px', color: '#6b7280' }}>v1.0 – Autonomous Workspace Agent</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Demo Mode Toggle */}
          <button
            onClick={() => setDemoMode((prev) => !prev)}
            style={{
              padding: '4px 12px',
              borderRadius: '20px',
              fontSize: '11px',
              fontWeight: 600,
              border: demoMode ? '1px solid #10b981' : '1px solid #4a4a6a',
              backgroundColor: demoMode ? '#10b98120' : 'transparent',
              color: demoMode ? '#10b981' : '#6b7280',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {demoMode ? '● DEMO MODE ON' : '○ Demo Mode'}
          </button>
          <div
            style={{
              ...styles.statusBadge,
              backgroundColor: `${statusColors[status]}15`,
              border: `1px solid ${statusColors[status]}40`,
              color: statusColors[status],
            }}
          >
            <div style={{ ...styles.statusDot, backgroundColor: statusColors[status] }} />
            {status.toUpperCase()}
            {sessionId && <span style={{ color: '#6b7280', marginLeft: '8px' }}>#{sessionId.substring(0, 8)}</span>}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div style={styles.main}>
        {/* Left: Controls */}
        <div style={{ ...styles.controlPanel, width: traceCollapsed ? 'calc(100% - 40px)' : '50%' }}>
          {/* Connection */}
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Connection</div>
            <div style={styles.buttonGroup}>
              {status === 'disconnected' || status === 'error' ? (
                <button
                  style={{ ...styles.button, ...styles.primaryButton }}
                  onClick={connect}
                >
                  Connect to CortexOS
                </button>
              ) : status === 'connected' ? (
                <button
                  style={{ ...styles.button, ...styles.dangerButton }}
                  onClick={disconnect}
                >
                  Disconnect
                </button>
              ) : (
                <button style={{ ...styles.button, ...styles.secondaryButton, ...styles.disabledButton }} disabled>
                  Connecting...
                </button>
              )}
            </div>
          </div>

          {/* Streaming Controls */}
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Real-Time Streams</div>
            <div style={styles.buttonGroup}>
              <button
                style={{
                  ...styles.button,
                  ...(micActive ? styles.dangerButton : styles.secondaryButton),
                  ...(status !== 'connected' ? styles.disabledButton : {}),
                }}
                onClick={toggleMic}
                disabled={status !== 'connected'}
              >
                {micActive ? '⏹ Stop Mic' : '🎤 Start Mic'}
              </button>
              <button
                style={{
                  ...styles.button,
                  ...(screenActive ? styles.dangerButton : styles.secondaryButton),
                  ...(status !== 'connected' ? styles.disabledButton : {}),
                }}
                onClick={toggleScreen}
                disabled={status !== 'connected'}
              >
                {screenActive ? '⏹ Stop Capture' : '🖥 Start Screen Capture'}
              </button>
            </div>
            {(micActive || screenActive) && (
              <div style={{ marginTop: '8px', fontSize: '12px', color: '#6b7280' }}>
                {micActive && <span>🎤 Mic active &nbsp;</span>}
                {screenActive && <span>🖥 Captures: {captureCount}</span>}
              </div>
            )}
          </div>

          {/* Text Input */}
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Text Command</div>
            <div style={styles.inputRow}>
              <textarea
                style={styles.textInput}
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a command... (e.g., 'Navigate to google.com and search for AI agents')"
                rows={2}
                disabled={status !== 'connected'}
              />
              <button
                style={{
                  ...styles.button,
                  ...styles.primaryButton,
                  ...(status !== 'connected' || !textInput.trim() ? styles.disabledButton : {}),
                  alignSelf: 'flex-end',
                }}
                onClick={sendText}
                disabled={status !== 'connected' || !textInput.trim()}
              >
                Send
              </button>
            </div>
          </div>

          {/* Gemini Response */}
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Agent Response</div>
            <div style={styles.responseArea}>
              {geminiText || <span style={{ color: '#4a4a6a' }}>Waiting for agent response...</span>}
            </div>
          </div>

          {/* Demo Flows */}
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Demo Scenarios{demoMode && <span style={{ color: '#10b981', marginLeft: '8px', textTransform: 'none' as 'none', letterSpacing: 0 }}>(auto-send enabled)</span>}</div>
            <div style={styles.buttonGroup}>
              <button
                style={{
                  ...styles.button,
                  ...styles.secondaryButton,
                  ...(status !== 'connected' ? styles.disabledButton : {}),
                }}
                onClick={() => {
                  const cmd = 'Fix the error shown in the terminal.';
                  if (demoMode && wsClientRef.current) {
                    wsClientRef.current.send({ type: 'text_input', data: cmd });
                    addTrace({ type: 'user', content: `[DEMO] ${cmd}` });
                    setGeminiText('');
                  } else {
                    setTextInput(cmd);
                  }
                }}
                disabled={status !== 'connected'}
              >
                🔧 Developer Fix
              </button>
              <button
                style={{
                  ...styles.button,
                  ...styles.secondaryButton,
                  ...(status !== 'connected' ? styles.disabledButton : {}),
                }}
                onClick={() => {
                  const cmd = 'Summarize this document and email it.';
                  if (demoMode && wsClientRef.current) {
                    wsClientRef.current.send({ type: 'text_input', data: cmd });
                    addTrace({ type: 'user', content: `[DEMO] ${cmd}` });
                    setGeminiText('');
                  } else {
                    setTextInput(cmd);
                  }
                }}
                disabled={status !== 'connected'}
              >
                📄 Summarize & Email
              </button>
              <button
                style={{
                  ...styles.button,
                  ...styles.secondaryButton,
                  ...(status !== 'connected' ? styles.disabledButton : {}),
                }}
                onClick={() => {
                  const cmd = 'Create a meeting tomorrow at 4 PM titled "Team Standup".';
                  if (demoMode && wsClientRef.current) {
                    wsClientRef.current.send({ type: 'text_input', data: cmd });
                    addTrace({ type: 'user', content: `[DEMO] ${cmd}` });
                    setGeminiText('');
                  } else {
                    setTextInput(cmd);
                  }
                }}
                disabled={status !== 'connected'}
              >
                📅 Schedule Meeting
              </button>
            </div>
          </div>
        </div>

        {/* Right: Action Trace (collapsible) */}
        {!traceCollapsed && (
          <div style={styles.tracePanel}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '4px 12px 0' }}>
              <button
                onClick={() => setTraceCollapsed(true)}
                style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '18px' }}
                title="Collapse trace panel"
              >
                ✕
              </button>
            </div>
            <ActionTrace entries={traces} />
          </div>
        )}
        {traceCollapsed && (
          <div
            style={{
              width: '40px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderLeft: '1px solid #1a1a2e',
              cursor: 'pointer',
              writingMode: 'vertical-rl',
              fontSize: '11px',
              fontWeight: 600,
              color: '#6b7280',
              letterSpacing: '1px',
              textTransform: 'uppercase',
            }}
            onClick={() => setTraceCollapsed(false)}
            title="Expand trace panel"
          >
            ACTION TRACE ▸
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
