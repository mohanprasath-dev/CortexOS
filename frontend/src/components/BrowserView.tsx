/**
 * CortexOS – BrowserView Component
 *
 * Live browser panel showing Playwright screenshots with CSS cross-fade,
 * URL bar overlay, loading skeleton, and disconnected placeholder.
 */

import React, { useRef, useEffect } from 'react';

interface BrowserViewProps {
    frame: string | null;
    currentUrl: string;
    isConnected: boolean;
    isConnecting: boolean;
}

export const BrowserView: React.FC<BrowserViewProps> = ({
    frame,
    currentUrl,
    isConnected,
    isConnecting,
}) => {
    const imgRef = useRef<HTMLImageElement>(null);
    const prevFrameRef = useRef<string | null>(null);

    // Cross-fade effect
    useEffect(() => {
        if (frame && frame !== prevFrameRef.current && imgRef.current) {
            imgRef.current.style.opacity = '0.7';
            requestAnimationFrame(() => {
                if (imgRef.current) {
                    imgRef.current.style.opacity = '1';
                }
            });
            prevFrameRef.current = frame;
        }
    }, [frame]);

    return (
        <div className="browser-view">
            {/* URL Bar */}
            {isConnected && (
                <div className="browser-url-bar">
                    <span className="browser-url-bar__icon">●</span>
                    <span className="browser-url-bar__url">
                        {currentUrl === 'about:blank' ? 'No page loaded' : currentUrl}
                    </span>
                </div>
            )}

            {/* Frame Container */}
            <div className="browser-frame-container">
                {/* Connecting overlay */}
                {isConnecting && (
                    <div className="connecting-overlay">
                        <div className="connecting-spinner" />
                        <span className="connecting-text">Initializing Gemini Live…</span>
                    </div>
                )}

                {/* Live frame */}
                {isConnected && frame && (
                    <img
                        ref={imgRef}
                        className="browser-frame"
                        src={`data:image/jpeg;base64,${frame}`}
                        alt="Live browser view"
                    />
                )}

                {/* Loading skeleton when connected but no frame yet */}
                {isConnected && !frame && !isConnecting && (
                    <div style={{ width: '80%', height: '60%' }}>
                        <div className="skeleton" style={{ width: '100%', height: '100%' }} />
                    </div>
                )}

                {/* Placeholder when disconnected */}
                {!isConnected && !isConnecting && (
                    <div className="browser-placeholder">
                        <span className="browser-placeholder__icon">⬡</span>
                        <span className="browser-placeholder__text">CortexOS Browser View</span>
                        <span className="browser-placeholder__sub">
                            Connect to see the agent's browser in real time
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
};
