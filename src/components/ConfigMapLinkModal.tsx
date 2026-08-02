import { useEffect, useState } from 'react';
import { useVeltraStore } from '../store/store';
import type { ConfigMapMechanism } from '../utils/linkResources';

const MECHANISM_LABELS: Array<{ value: ConfigMapMechanism; label: string; hint: string }> = [
    {
        value: 'envFrom',
        label: 'envFrom (inject all keys as env vars)',
        hint: 'Writes spec.containers[0].envFrom[].configMapRef.',
    },
    {
        value: 'volumes',
        label: 'volumes (mount as files)',
        hint: 'Writes spec.volumes[].configMap.',
    },
    {
        value: 'envKey',
        label: 'env (single key)',
        hint: 'Writes spec.containers[0].env[].valueFrom.configMapKeyRef.',
    },
];

/**
 * Post-drag prompt: after drawing a ConfigMap → workload connection the user picks
 * how the ConfigMap is consumed (envFrom / volumes / env-key) before the reference
 * is written into the workload's Pod spec.
 */
export default function ConfigMapLinkModal() {
    const pending = useVeltraStore((s) => s.pendingConfigMapLink);
    const nodes = useVeltraStore((s) => s.nodes);
    const confirmConfigMapLink = useVeltraStore((s) => s.confirmConfigMapLink);
    const cancelConfigMapLink = useVeltraStore((s) => s.cancelConfigMapLink);

    const [mechanism, setMechanism] = useState<ConfigMapMechanism>('envFrom');
    const [key, setKey] = useState('');
    const [lastLinkKey, setLastLinkKey] = useState('');

    // Reset the form when a different link is pending (render-time adjustment,
    // matching the NameField pattern in Canvas)
    const linkKey = pending ? `${pending.cm.name}->${pending.target.name}` : '';
    if (lastLinkKey !== linkKey) {
        setLastLinkKey(linkKey);
        setMechanism('envFrom');
        setKey('');
    }

    useEffect(() => {
        if (!pending) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') cancelConfigMapLink();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [pending, cancelConfigMapLink]);

    if (!pending) return null;

    const cmNode = nodes.find((n) => n.data.kind === 'ConfigMap' && n.data.name === pending.cm.name);
    const dataKeys = Object.keys((cmNode?.data.resource.data ?? {}) as Record<string, unknown>);
    const needsKey = mechanism === 'envKey';
    const confirmDisabled = needsKey && !key;

    const activeMechanism = MECHANISM_LABELS.find((m) => m.value === mechanism);

    return (
        <div className="modal-overlay" onClick={cancelConfigMapLink}>
            <div
                className="modal modal--compact"
                role="dialog"
                aria-modal="true"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="modal-header">
                    <span className="modal-header__title">Link ConfigMap</span>
                    <button
                        type="button"
                        className="modal-header__close"
                        onClick={cancelConfigMapLink}
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
                            {pending.cm.name} → {pending.target.kind} {pending.target.name}
                            <span className="modal-field__hint">
                                Choose how the ConfigMap is consumed — the reference is
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
                            onChange={(e) => setMechanism(e.target.value as ConfigMapMechanism)}
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
                                    The ConfigMap key injected as an env var.
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
                                    This ConfigMap has no data keys — add some first or pick
                                    envFrom / volumes.
                                </span>
                            )}
                        </div>
                    )}
                </div>

                <div className="modal-footer">
                    <button
                        type="button"
                        className="modal-btn modal-btn--secondary"
                        onClick={cancelConfigMapLink}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="modal-btn modal-btn--primary"
                        style={{ '--btn-color': '#06b6d4' } as React.CSSProperties}
                        onClick={() => confirmConfigMapLink(mechanism, needsKey ? key : undefined)}
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
