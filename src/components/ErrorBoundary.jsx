/**
 * ErrorBoundary — catches unhandled render/lifecycle errors in the component
 * tree below it and displays a fallback UI instead of a blank screen.
 *
 * React error boundaries must be class components (no hooks equivalent as of
 * React 19) because they rely on the two lifecycle methods that only exist on
 * classes: getDerivedStateFromError (updates state on error) and
 * componentDidCatch (receives error + diagnostic info for logging).
 *
 * Usage:
 *   <ErrorBoundary>
 *     <App />
 *   </ErrorBoundary>
 */
import { Component } from 'react';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    // hasError drives the conditional render; error holds the caught value for display
    this.state = { hasError: false, error: null };
  }

  /**
   * React calls this static method during render when a descendant throws.
   * The returned object is merged into state before the next render, allowing
   * the boundary to switch to its fallback UI in the same pass.
   */
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  /**
   * Called after the error is committed to the DOM.  Ideal for logging to an
   * external service (Sentry, Datadog, etc.).  `info.componentStack` contains
   * the React component stack trace at the time of the crash.
   */
  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Uncaught error:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          background: '#0a0a0f',
          color: '#e03060',
          fontFamily: 'monospace',
          gap: '1rem',
          padding: '2rem',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '2rem', fontWeight: 700 }}>GAME CRASHED</div>
          <div style={{ color: '#777', fontSize: '0.85rem', maxWidth: 360 }}>
            {this.state.error?.message ?? 'An unexpected error occurred.'}
          </div>
          <button
            style={{
              marginTop: '1rem',
              padding: '0.5rem 1.5rem',
              background: 'transparent',
              border: '1px solid #e03060',
              color: '#e03060',
              fontFamily: 'monospace',
              fontSize: '0.9rem',
              cursor: 'pointer',
              borderRadius: 4,
            }}
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Try Again
          </button>
        </div>
      );
    }

    // No error — render children normally
    return this.props.children;
  }
}
