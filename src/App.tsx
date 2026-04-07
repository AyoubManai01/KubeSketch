import YamlEditor from './components/YamlEditor';
import Canvas from './components/Canvas';
import { useVeltraStore } from './store/store';

/**
 * Veltra — Kubernetes Visual IDE
 * Split-screen layout: YAML editor (left) | Resource canvas (right)
 */
export default function App() {
  const isBidirectionalSync = useVeltraStore((s) => s.isBidirectionalSync);
  const setBidirectionalSync = useVeltraStore((s) => s.setBidirectionalSync);

  return (
    <div className="app">
      {/* Top toolbar */}
      <header className="toolbar">
        <div className="toolbar__brand">
          <span className="toolbar__logo">⎈</span>
          <span className="toolbar__name">Veltra</span>
        </div>
        <span className="toolbar__tagline">
          Kubernetes Visual IDE
        </span>
        <label className="toolbar-toggle">
          <input
            type="checkbox"
            checked={isBidirectionalSync}
            onChange={(e) => setBidirectionalSync(e.target.checked)}
          />
          <span>Bidirectional Sync</span>
        </label>
      </header>

      {/* Split-screen panels */}
      <main className="panels">
        <YamlEditor />
        <Canvas />
      </main>
    </div>
  );
}
