import { useEffect, useState } from 'react';
import { useVeltraStore } from '../store/store';

/**
 * Post-drag prompt: after drawing a PVC → Pod/Deployment/ReplicaSet connection the
 * user picks the volume name (spec.volumes[].name) before the claim reference is
 * written into the target's Pod spec.
 */
export default function PvcLinkModal() {
    const pending = useVeltraStore((s) => s.pendingPvcLink);
    const confirmPvcLink = useVeltraStore((s) => s.confirmPvcLink);
    const cancelPvcLink = useVeltraStore((s) => s.cancelPvcLink);

    const [volumeName, setVolumeName] = useState('');
    const [lastLinkKey, setLastLinkKey] = useState('');

    // Reset the form when a different link is pending (render-time adjustment,
    // matching the NameField pattern in Canvas)
    const linkKey = pending ? `${pending.pvc.name}->${pending.target.name}` : '';
    if (lastLinkKey !== linkKey) {
        setLastLinkKey(linkKey);
        setVolumeName(pending ? pending.pvc.name : '');
    }

    useEffect(() => {
        if (!pending) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') cancelPvcLink();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [pending, cancelPvcLink]);

    if (!pending) return null;

    const trimmed = volumeName.trim();

    return (
        <div className="modal-overlay" onClick={cancelPvcLink}>
            <div
                className="modal modal--compact"
                role="dialog"
                aria-modal="true"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="modal-header">
                    <span className="modal-header__title">Mount PersistentVolumeClaim</span>
                    <button
                        type="button"
                        className="modal-header__close"
                        onClick={cancelPvcLink}
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
                            {pending.pvc.name} → {pending.target.kind} {pending.target.name}
                            <span className="modal-field__hint">
                                Writes spec.volumes[].persistentVolumeClaim.claimName into the
                                {pending.target.kind === 'Pod'
                                    ? ' Pod'
                                    : ' Pod template of the ' + pending.target.kind}{' '}
                                — it renders as a &quot;mounts&quot; edge on the canvas.
                            </span>
                        </label>
                    </div>

                    <div className="modal-field">
                        <label className="modal-field__label">
                            Volume name
                            <span className="modal-field__hint">
                                The name of the volume entry in spec.volumes[] that claims
                                this PVC.
                            </span>
                        </label>
                        <input
                            className="modal-field__input"
                            value={volumeName}
                            onChange={(e) => setVolumeName(e.target.value)}
                            placeholder={pending.pvc.name}
                            autoFocus
                        />
                    </div>
                </div>

                <div className="modal-footer">
                    <button
                        type="button"
                        className="modal-btn modal-btn--secondary"
                        onClick={cancelPvcLink}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="modal-btn modal-btn--primary"
                        style={{ '--btn-color': '#ec4899' } as React.CSSProperties}
                        onClick={() => confirmPvcLink(trimmed)}
                        disabled={!trimmed}
                        title={trimmed ? 'Write the claim reference' : 'Volume name is required'}
                    >
                        Mount
                    </button>
                </div>
            </div>
        </div>
    );
}
