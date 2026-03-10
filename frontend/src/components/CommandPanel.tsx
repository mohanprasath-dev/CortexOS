/**
 * CortexOS – CommandPanel Component
 *
 * Left panel with text command input, mic toggle with pulse animation,
 * demo scenario chips, and agent thinking indicator.
 */

import React, { useCallback } from 'react';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface CommandPanelProps {
    status: ConnectionStatus;
    textInput: string;
    onTextChange: (value: string) => void;
    onSend: () => void;
    micActive: boolean;
    onToggleMic: () => void;
    isThinking: boolean;
    onDemo: (command: string) => void;
    geminiText: string;
}

const DEMO_SCENARIOS = [
    { label: '🔧 Dev Fix', command: 'Fix the error shown in the terminal.' },
    { label: '📄 Research', command: 'Go to Wikipedia and summarize the article on Large Language Models.' },
    { label: '📅 Calendar', command: 'Create a meeting tomorrow at 4 PM called "Team Standup".' },
];

export const CommandPanel: React.FC<CommandPanelProps> = ({
    status,
    textInput,
    onTextChange,
    onSend,
    micActive,
    onToggleMic,
    isThinking,
    onDemo,
    geminiText,
}) => {
    const isDisabled = status !== 'connected';

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSend();
            }
        },
        [onSend]
    );

    return (
        <div className="panel-left">
            {/* Command Input */}
            <div className="panel-section">
                <div className="panel-section__title">Command</div>
                <div className="command-row">
                    <textarea
                        className="command-textarea"
                        value={textInput}
                        onChange={(e) => onTextChange(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Type a command…"
                        rows={3}
                        disabled={isDisabled}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <button
                            className="btn btn--primary"
                            onClick={onSend}
                            disabled={isDisabled || !textInput.trim()}
                            style={{ height: '36px', fontSize: '12px' }}
                        >
                            Send
                        </button>
                        <button
                            className={`mic-btn ${micActive ? 'mic-btn--active' : ''}`}
                            onClick={onToggleMic}
                            disabled={isDisabled}
                            title={micActive ? 'Stop microphone' : 'Start microphone'}
                        >
                            {micActive ? '⏹' : '🎤'}
                        </button>
                    </div>
                </div>
                {micActive && (
                    <div style={{
                        marginTop: '6px',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '10px',
                        color: 'var(--accent-danger)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                    }}>
                        ● Mic streaming (16kHz PCM16)
                    </div>
                )}
            </div>

            {/* Thinking Indicator */}
            {isThinking && (
                <div className="thinking-indicator">
                    <div className="thinking-dots">
                        <span></span>
                        <span></span>
                        <span></span>
                    </div>
                    Agent thinking…
                </div>
            )}

            {/* Agent Response */}
            <div className="panel-section" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div className="panel-section__title">Agent Response</div>
                <div style={{
                    flex: 1,
                    padding: '8px 10px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-base)',
                    border: '1px solid var(--border)',
                    overflow: 'auto',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '12px',
                    lineHeight: '1.6',
                    color: 'var(--text-secondary)',
                    whiteSpace: 'pre-wrap' as const,
                    wordBreak: 'break-word' as const,
                }}>
                    {geminiText || (
                        <span style={{ color: 'var(--text-muted)' }}>
                            Waiting for agent response…
                        </span>
                    )}
                </div>
            </div>

            {/* Demo Scenarios */}
            <div className="panel-section">
                <div className="panel-section__title">Demo Scenarios</div>
                <div className="demo-chips">
                    {DEMO_SCENARIOS.map((scenario) => (
                        <button
                            key={scenario.label}
                            className="demo-chip"
                            onClick={() => onDemo(scenario.command)}
                            disabled={isDisabled}
                        >
                            {scenario.label}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};
