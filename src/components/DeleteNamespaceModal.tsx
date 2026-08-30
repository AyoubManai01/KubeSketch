import { useEffect, useRef } from 'react';

interface Props {
    name: string;
    count: number;
    onConfirm: () => void;
    onCancel: () => void;
}

/**
 * Confirmation prompt before cascade-deleting a non-empty namespace (namespace
 * editing mode). Mirrors the NamespaceModal style — a modal, never a native
 * alert — because the deletion removes every resource living in the namespace.
 */
export default function DeleteNamespaceModal({ name, count, onConfirm, onCancel }: Props) {
    const confirmRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        confirmRef.current?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onCancel();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onCancel]);

    return (
        <div className="modal-overlay" onClick={onCancel}>
            <div
                className="modal modal--compact"
                role="dialog"
                aria-modal="true"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="modal-header">
                    <span className="modal-header__title">Delete Namespace</span>
                    <button
                        type="button"
                        className="modal-header__close"
                        onClick={onCancel}
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
                    <p className="modal-field__label">
                        Delete namespace “{name}”?
                        <span className="modal-field__hint">
                            {count} resource{count > 1 ? 's' : ''} inside it will be permanently
                            deleted. This cannot be undone.
                        </span>
                    </p>
                </div>

                <div className="modal-footer">
                    <button
                        type="button"
                        className="modal-btn modal-btn--secondary"
                        onClick={onCancel}
                    >
                        Cancel
                    </button>
                    <button
                        ref={confirmRef}
                        type="button"
                        className="modal-btn modal-btn--primary"
                        style={{ '--btn-color': '#ef4444' } as React.CSSProperties}
                        onClick={onConfirm}
                        title={`Delete namespace “${name}” and its resources`}
                    >
                        Delete
                    </button>
                </div>
            </div>
        </div>
    );
}