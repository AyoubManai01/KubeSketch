import { useEffect, useMemo, useRef, useState } from 'react';
import { useVeltraStore } from '../store/store';
import { DEFAULT_CLUSTER_RECT, effectiveNsLayout } from '../utils/teachingFrame';

interface Props {
    onClose: () => void;
}

/**
 * Prompt for creating a new physical node rectangle (namespace editing mode).
 * Mirrors the NamespaceModal: inline validation for empty/duplicate names, and a
 * default-size rectangle placed inside the cluster on confirm (growing the
 * cluster when there is no room). Nodes are canvas-only chrome — they never
 * reach the YAML manifest.
 */
export default function NodeModal({ onClose }: Props) {
    const nodes = useVeltraStore((s) => s.nodes);
    const nsLayout = useVeltraStore((s) => s.nsLayout);
    const addNode = useVeltraStore((s) => s.addNode);

    const [name, setName] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    // Nodes are never graph-derived — only persisted rectangles can clash.
    const layout = useMemo(() => effectiveNsLayout(nsLayout, nodes), [nsLayout, nodes]);

    const error = useMemo(() => {
        const trimmed = name.trim();
        if (!trimmed) return 'Node name cannot be empty.';
        const exists = layout.nodes.some((nd) => nd.name === trimmed);
        return exists ? `Node “${trimmed}” already exists on the canvas.` : '';
    }, [name, layout]);

    useEffect(() => {
        inputRef.current?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    const handleCreate = () => {
        const trimmed = name.trim();
        if (!trimmed || error) return;
        const cluster = layout.cluster ?? { ...DEFAULT_CLUSTER_RECT };
        addNode(trimmed, {
            x: cluster.x + 20,
            y: cluster.y + 20,
            width: 480,
            height: 360,
        });
        onClose();
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div
                className="modal modal--compact"
                role="dialog"
                aria-modal="true"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="modal-header">
                    <span className="modal-header__title">New Node</span>
                    <button
                        type="button"
                        className="modal-header__close"
                        onClick={onClose}
                        title="Close"
                    >
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            width="14"
                            height="14"
                        >
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>

                <div className="modal-body">
                    <div className="modal-field">
                        <label className="modal-field__label">
                            Node name
                            <span className="modal-field__hint">
                                An empty physical node rectangle is added inside the
                                cluster — drag namespace boxes onto it (or resize it
                                across them) to place them on the node. Nodes are
                                canvas-only and never part of the YAML manifest.
                            </span>
                        </label>
                        <input
                            ref={inputRef}
                            className={`modal-field__input ${error ? 'modal-field__input--invalid' : ''}`}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleCreate();
                            }}
                            placeholder="worker-1"
                        />
                        {error && <span className="modal-field__error">{error}</span>}
                    </div>
                </div>

                <div className="modal-footer">
                    <button
                        type="button"
                        className="modal-btn modal-btn--secondary"
                        onClick={onClose}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="modal-btn modal-btn--primary"
                        style={{ '--btn-color': '#f59e0b' } as React.CSSProperties}
                        onClick={handleCreate}
                        disabled={!!error}
                        title={error ? 'Choose a valid node name' : 'Create the node'}
                    >
                        Create
                    </button>
                </div>
            </div>
        </div>
    );
}