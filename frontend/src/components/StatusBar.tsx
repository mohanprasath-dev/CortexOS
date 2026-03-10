/**
 * CortexOS – StatusBar Component
 *
 * Header bar (48px) with CortexOS logo, connection status pill with
 * animated pulse dot, session ID, and connect/disconnect button.
 */

import React from 'react';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface StatusBarProps {
    status: ConnectionStatus;
    sessionId: string | null;
    demoMode: boolean;
    onConnect: () => void;
    onDisconnect: () => void;
}

export const StatusBar: React.FC<StatusBarProps> = ({
    status,
    sessionId,
    demoMode,
    onConnect,
    onDisconnect,
}) => {
    return (
        <header className="cortex-header">
            <div className="cortex-header__left">
                <div className="cortex-header__logo">
                    <span className="cortex-header__logo-icon">⬡</span>
                    <span className="cortex-header__logo-text">CortexOS</span>
                </div>
                {demoMode && (
                    <span style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '10px',
                        fontWeight: 600,
                        padding: '2px 8px',
                        borderRadius: 'var(--radius-pill)',
                        background: 'rgba(210, 153, 34, 0.15)',
                        border: '1px solid rgba(210, 153, 34, 0.3)',
                        color: 'var(--accent-warning)',
                        letterSpacing: '0.5px',
                    }}>
                        DEMO
                    </span>
                )}
            </div>

            <div className="cortex-header__right">
                <div className={`status-pill status-pill--${status}`}>
                    <span className={`status-dot status-dot--${status}`} />
                    {status.toUpperCase()}
                    {sessionId && (
                        <span className="session-id">#{sessionId.substring(0, 8)}</span>
                    )}
                </div>

                {(status === 'disconnected' || status === 'error') && (
                    <button className="btn btn--primary" onClick={onConnect}>
                        Connect
                    </button>
                )}
                {status === 'connected' && (
                    <button className="btn btn--danger" onClick={onDisconnect}>
                        Disconnect
                    </button>
                )}
                {status === 'connecting' && (
                    <button className="btn" disabled>
                        Connecting…
                    </button>
                )}
            </div>
        </header>
    );
};
