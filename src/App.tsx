import { useCallback, useRef, useState } from 'react';
import YamlEditor from './components/YamlEditor';
import Canvas from './components/Canvas';
import { useVeltraStore, DEFAULT_YAML } from './store/store';

const SPLIT_KEY = 'veltra_panel_split';
const MIN_SPLIT = 20;
const MAX_SPLIT = 80;
const DEFAULT_SPLIT = 42;

function loadSplitRatio(): number {
  const saved = Number(localStorage.getItem(SPLIT_KEY));
  return Number.isFinite(saved) && saved >= MIN_SPLIT && saved <= MAX_SPLIT ? saved : DEFAULT_SPLIT;
}

/**
 * Veltra — Kubernetes Visual IDE
 * Split-screen layout: YAML editor (left) | Resource canvas (right)
 */
export default function App() {
  const isBidirectionalSync = useVeltraStore((s) => s.isBidirectionalSync);
  const setBidirectionalSync = useVeltraStore((s) => s.setBidirectionalSync);
  const setYaml = useVeltraStore((s) => s.setYaml);
  const clearAll = useVeltraStore((s) => s.clearAll);
  const resetLayout = useVeltraStore((s) => s.resetLayout);

  // User-resizable editor/canvas split — purely presentational, so it lives
  // outside the resource-model store and is persisted directly to localStorage.
  const panelsRef = useRef<HTMLDivElement>(null);
  const [splitRatio, setSplitRatio] = useState(loadSplitRatio);
  const [isResizing, setIsResizing] = useState(false);

  // Pointer capture on the splitter itself keeps drag events flowing even
  // when the cursor moves over Monaco or the React Flow canvas underneath.
  const handleSplitterPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsResizing(true);
  }, []);

  const handleSplitterPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!panelsRef.current || e.buttons === 0) return;
    const rect = panelsRef.current.getBoundingClientRect();
    const ratio = ((e.clientX - rect.left) / rect.width) * 100;
    setSplitRatio(Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, ratio)));
  }, []);

  const handleSplitterPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    setIsResizing(false);
    setSplitRatio((current) => {
      localStorage.setItem(SPLIT_KEY, String(current));
      return current;
    });
  }, []);

  // Clear YAML editor, canvas, manual edges and saved layout
  const handleClearAll = () => {
    if (window.confirm('Are you sure you want to clear the editor and canvas?')) {
      clearAll();
    }
  };

  // Restore default demo YAML
  const handleLoadSample = () => {
    setYaml(DEFAULT_YAML);
  };

  // Reset node custom layout positions back to automatic grid alignment
  const handleResetLayout = () => {
    resetLayout();
  };

  return (
    <div className="app">
      <div className="app-brand-watermark" aria-hidden="true" />
      
      {/* Top navbar/toolbar */}
      <header className="toolbar">
        <div className="toolbar__left">
          <div className="toolbar__brand">
            <img className="toolbar__logo" src="/Logo-nobg.png" alt="Veltra logo" />
            <span className="toolbar__name">Veltra</span>
          </div>
          <span className="toolbar__tagline">
            Kubernetes Visual IDE
          </span>
        </div>

        {/* Global Toolbar Quick Actions */}
        <div className="toolbar__center">
          <button 
            type="button" 
            className="toolbar-btn" 
            onClick={handleLoadSample}
            title="Load the default demo Kubernetes manifest"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
            Load Sample
          </button>
          <button 
            type="button" 
            className="toolbar-btn" 
            onClick={handleResetLayout}
            title="Reset canvas nodes to auto-layout positions"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12a9 9 0 019-9 9.75 9.75 0 016.74 2.74L21 8" />
              <path d="M16 3h5v5" />
              <path d="M21 12a9 9 0 01-9 9 9.75 9.75 0 01-6.74-2.74L3 16" />
              <path d="M8 21H3v-5" />
            </svg>
            Reset Layout
          </button>
          <button 
            type="button" 
            className="toolbar-btn toolbar-btn--danger" 
            onClick={handleClearAll}
            title="Clear the current manifest"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
            Clear All
          </button>
        </div>

        <div className="toolbar__right">
          <label className="toolbar-toggle" title="Sync canvas edits instantly back to YAML">
            <input
              type="checkbox"
              checked={isBidirectionalSync}
              onChange={(e) => setBidirectionalSync(e.target.checked)}
            />
            <span className="toggle-switch"></span>
            <span className="toggle-label">Bidirectional Sync</span>
          </label>
        </div>
      </header>

      {/* Split-screen panels */}
      <main className={`panels ${isResizing ? 'panels--resizing' : ''}`} ref={panelsRef}>
        <YamlEditor style={{ width: `${splitRatio}%` }} />
        <div
          className="panel-splitter"
          onPointerDown={handleSplitterPointerDown}
          onPointerMove={handleSplitterPointerMove}
          onPointerUp={handleSplitterPointerUp}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize editor and canvas panels"
        />
        <Canvas />
      </main>
    </div>
  );
}
