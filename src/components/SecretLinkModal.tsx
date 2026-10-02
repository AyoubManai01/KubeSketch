import { useEffect, useState } from 'react';
import { useVeltraStore } from '../store/store';
import type { SecretMechanism } from '../utils/linkResources';

const MECHANISM_LABELS: Array<{ value: SecretMechanism; label: string; hint: string }> = [
    {
        value: 'envFrom',
        label: 'envFrom (inject all keys as env vars)',
        hint: 'Writes spec.containers[0].envFrom[].secretRef.',
    },
    {
        value: 'volumes',
        label: 'volumes (mount as files)',
        hint: 'Writes spec.volumes[].secret.secretName (with an optional volume name).',
    },
    {
        value: 'envKey',
        label: 'env (single key)',
        hint: 'Writes spec.containers[0].env[].valueFrom.secretKeyRef.',
    },
];

/**
 * Post-drag prompt: after drawing a Secret → workload connection the user picks
 * how the Secret is consumed (envFrom / volumes / env-key) before the reference
 * is written into the workload's Pod spec.
 */
export default function SecretLinkModal() {
    const pending = useVeltraStore((s) => s.pendingSecretLink);
    const nodes = useVeltraStore((s) => s.nodes);
    const confirmSecretLink = useVeltraStore((s) => s.confirmSecretLink);
    const cancelSecretLink = useVeltraStore((s) => s.cancelSecretLink);

    const [mechanism, setMechanism] = useState<SecretMechanism>('envFrom');
    const [key, setKey] = useState('');
    const [volumeName, setVolumeName] = useState('');
    const [lastLinkKey, setLastLinkKey] = useState('');

    // Reset the form when a different link is pending (render-time adjustment,
    // matching the NameField pattern in Canvas)
    const linkKey = pending ? `${pending.secret.name}->${pending.target.name}` : '';
    if (lastLinkKey !== linkKey) {
        setLastLinkKey(linkKey);
        setMechanism('envFrom');
        setKey('');
        setVolumeName(pending ? pending.secret.name : '');
    }

    useEffect(() => {
        if (!pending) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') cancelSecretLink();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [pending, cancelSecretLink]);

    if (!pending) return null;

    const secretNode = nodes.find((n) => n.data.kind === 'Secret' && n.data.name === pending.secret.name);
    const dataKeys = Object.keys((secretNode?.data.resource.data ?? {}) as Record<string, unknown>);
    const needsKey = mechanism === 'envKey';
    const confirmDisabled = needsKey && !key;

    const activeMechanism = MECHANISM_LABELS.find((m) => m.value === mechanism);

    return (
        <div className="modal-overlay" onClick={cancelSecretLink}>
            <div
                className="modal modal--compact"
                role="dialog"
                aria-modal="true"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="modal-header">
                    <span className="modal-header__title">Link Secret</span>
                    <button
                        type="button"
                        className="modal-header__close"
                        onClick={cancelSecretLink}
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
                            {pending.secret.name} → {pending.target.kind} {pending.target.name}
                            <span className="modal-field__hint">
                                Choose how the Secret is consumed; the reference is
                                written into the {pending.target.kind}&apos;s Pod spec
                                {pending.target.kind === 'Pod'
                                    ? ''
                                    : ' template (its Pods get it automatically)'}
                                .
                            </span>
                        </label>
                    </div>

                    <div className="modal-field">
                        <label className="modal-field__label">Reference mechanism</label>
                        <select
                            className="modal-field__input modal-field__input--select"
                            value={mechanism}
                            onChange={(e) => setMechanism(e.target.value as SecretMechanism)}
                        >
                            {MECHANISM_LABELS.map((m) => (
                                <option key={m.value} value={m.value}>
                                    {m.label}
                                </option>
                            ))}
                        </select>
                        {activeMechanism && (
                            <span className="modal-field__hint">{activeMechanism.hint}</span>
                        )}
                    </div>

                    {needsKey && (
                        <div className="modal-field">
                            <label className="modal-field__label">
                                Data key
                                <span className="modal-field__hint">
                                    The Secret key injected as an env var.
                                </span>
                            </label>
                            <select
                                className="modal-field__input modal-field__input--select"
                                value={key}
                                onChange={(e) => setKey(e.target.value)}
                            >
                                <option value="">(select a key)</option>
                                {dataKeys.map((k) => (
                                    <option key={k} value={k}>
                                        {k}
                                    </option>
                                ))}
                            </select>
                            {dataKeys.length === 0 && (
                                <span className="modal-field__error">
                                    This Secret has no data keys; add some first or pick
                                    envFrom / volumes.
                                </span>
                            )}
                        </div>
                    )}

                    {mechanism === 'volumes' && (
                        <div className="modal-field">
                            <label className="modal-field__label">
                                Volume name
                                <span className="modal-field__hint">
                                    The volume name inside the Pod (defaults to the Secret name).
                                </span>
                            </label>
                            <input
                                className="modal-field__input"
                                value={volumeName}
                                onChange={(e) => setVolumeName(e.target.value)}
                                placeholder={pending.secret.name}
                            />
                        </div>
                    )}
                </div>

                <div className="modal-footer">
                    <button
                        type="button"
                        className="modal-btn modal-btn--secondary"
                        onClick={cancelSecretLink}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="modal-btn modal-btn--primary"
                        style={{ '--btn-color': '#dc2626' } as React.CSSProperties}
                        onClick={() =>
                            confirmSecretLink(
                                mechanism,
                                needsKey ? key : undefined,
                                mechanism === 'volumes' ? volumeName : undefined
                            )
                        }
                        disabled={confirmDisabled}
                        title={confirmDisabled ? 'Select a data key first' : 'Write the reference'}
                    >
                        Link
                    </button>
                </div>
            </div>
        </div>
    );
}
