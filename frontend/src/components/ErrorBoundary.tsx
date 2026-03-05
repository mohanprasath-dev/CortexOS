/**
 * CortexOS – React Error Boundary
 *
 * Catches unhandled render-time exceptions anywhere in the component tree,
 * displays a professional fallback UI, and provides a "Retry" button
 * that remounts the tree.
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    backgroundColor: '#0a0a14',
    color: '#e0e0ff',
    fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    padding: '32px',
    textAlign: 'center',
  },
  icon: {
    fontSize: '48px',
    marginBottom: '16px',
  },
  title: {
    fontSize: '22px',
    fontWeight: 700,
    marginBottom: '8px',
    color: '#ef4444',
  },
  message: {
    fontSize: '14px',
    color: '#8b8ba0',
    maxWidth: '480px',
    lineHeight: '1.6',
    marginBottom: '24px',
  },
  errorDetail: {
    fontFamily: "'JetBrains Mono', 'Cascadia Code', monospace",
    fontSize: '12px',
    color: '#6b7280',
    backgroundColor: '#1a1a2e',
    padding: '12px 16px',
    borderRadius: '8px',
    maxWidth: '560px',
    overflowX: 'auto',
    marginBottom: '24px',
    textAlign: 'left' as const,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
  },
  button: {
    padding: '10px 24px',
    fontSize: '14px',
    fontWeight: 600,
    color: '#fff',
    backgroundColor: '#6366f1',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
};

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[CortexOS ErrorBoundary]', error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div style={styles.container}>
          <div style={styles.icon}>⚠️</div>
          <div style={styles.title}>CortexOS encountered an error</div>
          <div style={styles.message}>
            Something went wrong while rendering the interface.
            This is usually a transient issue – click Retry to restart the UI.
          </div>
          {this.state.error && (
            <div style={styles.errorDetail}>
              {this.state.error.message}
            </div>
          )}
          <button style={styles.button} onClick={this.handleRetry}>
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
