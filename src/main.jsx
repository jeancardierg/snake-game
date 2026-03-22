import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { ErrorBoundary } from './components/ErrorBoundary.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* ErrorBoundary wraps the whole app so any uncaught render error
        shows a graceful fallback instead of a blank screen. */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
