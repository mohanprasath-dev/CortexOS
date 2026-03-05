/**
 * CortexOS – Action Trace Component
 *
 * Renders a real-time scrolling log of all agent actions, tool calls,
 * Gemini responses, and system events. Each entry is color-coded by type
 * and shows timestamps and status indicators.
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

// ── Styles ───────────────────────────────────────────────────────────────────

const typeConfig: Record<
  TraceEntry['type'],
  { icon: string; label: string; color: string; bgColor: string }
> = {
  system: { icon: '⚙️', label: 'SYSTEM', color: '#6b7280', bgColor: '#6b728010' },
  user: { icon: '👤', label: 'USER', color: '#3b82f6', bgColor: '#3b82f610' },
  response: { icon: '🤖', label: 'GEMINI', color: '#8b5cf6', bgColor: '#8b5cf610' },
  tool_call: { icon: '🔧', label: 'TOOL', color: '#f59e0b', bgColor: '#f59e0b10' },
  tool_result: { icon: '✅', label: 'RESULT', color: '#10b981', bgColor: '#10b98110' },
  error: { icon: '❌', label: 'ERROR', color: '#ef4444', bgColor: '#ef444410' },
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
  },
  header: {
    padding: '16px 20px',
    borderBottom: '1px solid #1a1a2e',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0d0d1a',
  },
  headerTitle: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#8b8ba0',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  entryCount: {
    fontSize: '11px',
    color: '#4a4a6a',
    padding: '2px 8px',
    borderRadius: '10px',
    backgroundColor: '#1a1a2e',
  },
  scrollContainer: {
    flex: 1,
    overflowY: 'auto',
    padding: '8px 12px',
  },
  entry: {
    display: 'flex',
    gap: '10px',
    padding: '10px 12px',
    marginBottom: '4px',
    borderRadius: '6px',
    fontSize: '13px',
    lineHeight: '1.5',
    transition: 'background-color 0.2s',
  },
  entryIcon: {
    flexShrink: 0,
    fontSize: '14px',
    paddingTop: '1px',
  },
  entryBody: {
    flex: 1,
    minWidth: 0,
  },
  entryHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '2px',
  },
  entryLabel: {
    fontSize: '10px',
    fontWeight: 700,
    letterSpacing: '0.8px',
    padding: '1px 6px',
    borderRadius: '3px',
  },
  entryTime: {
    fontSize: '10px',
    color: '#4a4a6a',
  },
  entryContent: {
    fontFamily: "'JetBrains Mono', 'Cascadia Code', monospace",
    fontSize: '12px',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    color: '#c0c0d0',
  },
  statusBadge: {
    fontSize: '10px',
    padding: '1px 6px',
    borderRadius: '3px',
    fontWeight: 600,
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: '#4a4a6a',
    gap: '8px',
  },
};

// ── Action Trace Component ───────────────────────────────────────────────────

export const ActionTrace: React.FC<ActionTraceProps> = ({ entries }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new entries
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

  const getStatusBadge = (entry: TraceEntry) => {
    if (!entry.toolStatus) return null;

    const statusConfig = {
      executing: { color: '#f59e0b', bg: '#f59e0b20', text: 'EXECUTING' },
      completed: { color: '#10b981', bg: '#10b98120', text: 'COMPLETED' },
      failed: { color: '#ef4444', bg: '#ef444420', text: 'FAILED' },
    };

    const cfg = statusConfig[entry.toolStatus];
    return (
      <span
        style={{
          ...styles.statusBadge,
          color: cfg.color,
          backgroundColor: cfg.bg,
        }}
      >
        {cfg.text}
      </span>
    );
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.headerTitle}>Action Trace</span>
        <span style={styles.entryCount}>{entries.length} events</span>
      </div>

      <div ref={scrollRef} style={styles.scrollContainer}>
        {entries.length === 0 ? (
          <div style={styles.emptyState}>
            <span style={{ fontSize: '32px' }}>🧠</span>
            <span style={{ fontSize: '14px' }}>No actions yet</span>
            <span style={{ fontSize: '12px' }}>Connect and start interacting to see the agent trace</span>
          </div>
        ) : (
          entries.map((entry) => {
            const config = typeConfig[entry.type];
            return (
              <div
                key={entry.id}
                style={{
                  ...styles.entry,
                  backgroundColor: config.bgColor,
                }}
              >
                <span style={styles.entryIcon}>{config.icon}</span>
                <div style={styles.entryBody}>
                  <div style={styles.entryHeader}>
                    <span
                      style={{
                        ...styles.entryLabel,
                        color: config.color,
                        backgroundColor: `${config.color}20`,
                      }}
                    >
                      {config.label}
                    </span>
                    {entry.toolName && (
                      <span style={{ fontSize: '11px', color: '#8b8ba0' }}>{entry.toolName}</span>
                    )}
                    {getStatusBadge(entry)}
                    <span style={styles.entryTime}>{formatTime(entry.timestamp)}</span>
                  </div>
                  <div style={styles.entryContent}>{entry.content}</div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
