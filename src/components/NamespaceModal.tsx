import { useEffect, useMemo, useRef, useState } from 'react';
import { useVeltraStore } from '../store/store';
import { isClusterScoped } from '../utils/k8sScope';
import { DEFAULT_CLUSTER_RECT, effectiveNsLayout } from '../utils/teachingFrame';

interface Props {
    onClose: () => void;
}

/**
 * Prompt for creating a new namespace rectangle (namespace editing mode). A modal
 * like the resource creation prompts — inline validation for empty/duplicate
 * names, and a default-size rectangle dropped below the cluster on confirm.
 */
export default function NamespaceModal({ onClose }: Props) {
    const nodes = useVeltraStore((s) => s.nodes);
    const nsLayout = useVeltraStore((s) => s.nsLayout);
    const addNamespace = useVeltraStore((s) => s.addNamespace);

    const [name, setName] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    // Namespaces that already exist: persisted rectangles AND namespaces
    // discovered from the live graph (YAML-authored, never edited).
    const layout = useMemo(() => effectiveNsLayout(nsLayout, nodes), [nsLayout, nodes]);

    const error = useMemo(() => {
        const trimmed = name.trim();
        if (!trimmed) return 'Namespace name cannot be empty.';
        const exists =
            layout.namespaces.some((ns) => ns.name === trimmed) ||
            nodes.some(
                (n) =>
                    !n.data.synthetic &&
                    !isClusterScoped(n.data.kind) &&
                    (n.data.namespace ?? 'default') === trimmed
            );
        return exists ? `Namespace “${trimmed}” already exists on the canvas.` : '';
    }, [name, layout, nodes]);

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
        addNamespace(trimmed, {
            x: cluster.x + 20,
            y: cluster.y + cluster.height + 40,
            width: 320,
            height: 240,
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
                    <span className="modal-header__title">New Namespace</span>
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
                            Namespace name
                            <span className="modal-field__hint">
                                An empty rectangle is added below the cluster — drag
                                resources onto it to assign them.
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
                            placeholder="my-namespace"
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
                        style={{ '--btn-color': '#8b5cf6' } as React.CSSProperties}
                        onClick={handleCreate}
                        disabled={!!error}
                        title={error ? 'Choose a valid namespace name' : 'Create the namespace'}
                    >
                        Create
                    </button>
                </div>
            </div>
        </div>
    );
}
