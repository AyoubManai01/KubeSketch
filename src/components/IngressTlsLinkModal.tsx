import { useEffect, useState } from 'react';
import { useKubeSketchStore } from '../store/store';

/**
 * Post-drag prompt: after drawing an Ingress ↔ Secret connection the user confirms
 * the TLS hosts before spec.tls[].secretName is written into the Ingress.
 * An empty hosts list means "all hosts" (wildcard).
 */
export default function IngressTlsLinkModal() {
    const pending = useKubeSketchStore((s) => s.pendingIngressTlsLink);
    const confirmIngressTlsLink = useKubeSketchStore((s) => s.confirmIngressTlsLink);
    const cancelIngressTlsLink = useKubeSketchStore((s) => s.cancelIngressTlsLink);

    const [hostsText, setHostsText] = useState('');
    const [lastLinkKey, setLastLinkKey] = useState('');

    // Reset the form when a different link is pending (render-time adjustment,
    // matching the NameField pattern in Canvas)
    const linkKey = pending ? `${pending.ingress.name}->${pending.secret.name}` : '';
    if (lastLinkKey !== linkKey) {
        setLastLinkKey(linkKey);
        setHostsText('');
    }

    useEffect(() => {
        if (!pending) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') cancelIngressTlsLink();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [pending, cancelIngressTlsLink]);

    if (!pending) return null;

    const parseHosts = () =>
        hostsText
            .split(/[\s,]+/)
            .map((h) => h.trim())
            .filter(Boolean);

    return (
        <div className="modal-overlay" onClick={cancelIngressTlsLink}>
            <div
                className="modal modal--compact"
                role="dialog"
                aria-modal="true"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="modal-header">
                    <span className="modal-header__title">Terminate TLS</span>
                    <button
                        type="button"
                        className="modal-header__close"
                        onClick={cancelIngressTlsLink}
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
                            {pending.ingress.name} → {pending.secret.name}
                            <span className="modal-field__hint">
                                Writes spec.tls[].secretName into the Ingress; it renders
                                as a &apos;tls&apos; edge on the canvas. Existing hosts for
                                this Secret are replaced.
                            </span>
                        </label>
                    </div>

                    <div className="modal-field">
                        <label className="modal-field__label">
                            TLS hosts
                            <span className="modal-field__hint">
                                One per line or comma-separated. Leave empty to terminate
                                TLS for all hosts.
                            </span>
                        </label>
                        <textarea
                            className="modal-field__input modal-field__textarea"
                            value={hostsText}
                            onChange={(e) => setHostsText(e.target.value)}
                            placeholder="app.example.com"
                            rows={3}
                        />
                    </div>
                </div>

                <div className="modal-footer">
                    <button
                        type="button"
                        className="modal-btn modal-btn--secondary"
                        onClick={cancelIngressTlsLink}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="modal-btn modal-btn--primary"
                        style={{ '--btn-color': '#eab308' } as React.CSSProperties}
                        onClick={() => confirmIngressTlsLink(parseHosts())}
                    >
                        Set TLS
                    </button>
                </div>
            </div>
        </div>
    );
}
