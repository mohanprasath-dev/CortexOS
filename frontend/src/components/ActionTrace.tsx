/**
 * CortexOS – Action Trace Component (Restyled)
 *
 * Compact scrolling log of all agent actions with color-coded left borders,
 * slide-in animations, timestamps in monospace, and count badge.
 */

import React, { useEffect, useRef } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

export interface TraceEntry {
  id: string;
  type: 'system' | 'user' | 'response' | 'tool_call' | 'tool_result' | 'error';
  content: string;
  timestamp: string;
  toolName?: string;
  toolStatus?: 'executing' | 'completed' | 'failed';
}

interface ActionTraceProps {
  entries: TraceEntry[];
}

// ── Config ───────────────────────────────────────────────────────────────────

const typeConfig: Record<
  TraceEntry['type'],
  { label: string; color: string }
> = {
  system: { label: 'SYS', color: 'var(--text-muted)' },
  user: { label: 'USER', color: 'var(--accent-primary)' },
  response: { label: 'AI', color: 'var(--accent-purple)' },
  tool_call: { label: 'TOOL', color: 'var(--accent-warning)' },
  tool_result: { label: 'RESULT', color: 'var(--accent-success)' },
  error: { label: 'ERR', color: 'var(--accent-danger)' },
};

// ── Component ────────────────────────────────────────────────────────────────

export const ActionTrace: React.FC<ActionTraceProps> = ({ entries }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  const formatTime = (timestamp: string): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="trace-header">
        <span className="trace-header__title">Action Trace</span>
        <span className="trace-header__count">{entries.length}</span>
      </div>

      <div ref={scrollRef} className="trace-scroll">
        {entries.length === 0 ? (
          <div className="trace-empty">
            <span className="trace-empty__icon">⬡</span>
            <span style={{ fontSize: '12px' }}>No actions yet</span>
            <span style={{ fontSize: '11px' }}>Connect to see agent activity</span>
          </div>
        ) : (
          entries.map((entry) => {
            const config = typeConfig[entry.type];
            return (
              <div
                key={entry.id}
                className={`trace-entry trace-entry--${entry.type}`}
              >
                <span className="trace-entry__time">
                  {formatTime(entry.timestamp)}
                </span>
                <div className="trace-entry__body">
                  <span
                    className="trace-entry__label"
                    style={{
                      color: config.color,
                      background: `color-mix(in srgb, ${config.color} 15%, transparent)`,
                    }}
                  >
                    {config.label}
                  </span>
                  {entry.toolName && (
                    <span style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '10px',
                      color: 'var(--text-secondary)',
                      marginLeft: '6px',
                    }}>
                      {entry.toolName}
                    </span>
                  )}
                  {entry.toolStatus && (
                    <span className={`trace-status trace-status--${entry.toolStatus}`}>
                      {entry.toolStatus.toUpperCase()}
                    </span>
                  )}
                  <div className="trace-entry__content">
                    {entry.content.length > 200
                      ? entry.content.substring(0, 200) + '…'
                      : entry.content}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
