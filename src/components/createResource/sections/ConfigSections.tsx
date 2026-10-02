import type { ConfigMapMechanism, SecretMechanism } from '../../../utils/linkResources';
import ConfigMapDataEditor from '../../ConfigMapDataEditor';
import type { SupportedKind } from '../../../types/types';
import type { CreateFormBundle } from '../formTypes';

interface Props {
    kind: SupportedKind;
    form: CreateFormBundle;
}

/** ConfigMap + Secret sections (labels, annotations, data, optional link). */
export function ConfigSections({ kind, form }: Props) {
    const { state, set, derived } = form;

    return (
        <>
            {/* ConfigMap: labels + annotations + data */}
            {kind === 'ConfigMap' && (
                <>
                    <div className="modal-field">
                        <label className="modal-field__label">
                            Labels
                            <span className="modal-field__hint">
                                Comma-separated key=value pairs (optional). These can be
                                matched by workloads and selectors elsewhere in the cluster.
                            </span>
                        </label>
                        <input
                            className="modal-field__input"
                            value={state.cmLabels}
                            onChange={(e) => set.setCmLabels(e.target.value)}
                            placeholder="app=my-app,tier=config"
                        />
                    </div>
                    <div className="modal-field">
                        <label className="modal-field__label">
                            Annotations
                            <span className="modal-field__hint">
                                Comma-separated key=value pairs (optional).
                            </span>
                        </label>
                        <input
                            className="modal-field__input"
                            value={state.cmAnnotations}
                            onChange={(e) => set.setCmAnnotations(e.target.value)}
                            placeholder="owner=team-a"
                        />
                    </div>
                    <div className="modal-field">
                        <label className="modal-field__label">
                            Data
                            <span className="modal-field__hint">
                                Optional key/value entries, injected into Pods via
                                envFrom, env.valueFrom or volumes.
                            </span>
                        </label>
                        <ConfigMapDataEditor
                            resource={{
                                apiVersion: 'v1',
                                kind: 'ConfigMap',
                                metadata: { name: state.name.trim() || derived.suggestedName },
                                data: state.cmData,
                            }}
                            resetToken="create-configmap"
                            onCommit={set.setCmData}
                        />
                    </div>
                    <div className="modal-field">
                        <label className="modal-field__label">
                            Link to a resource (optional)
                            <span className="modal-field__hint">
                                Picks a Pod, ReplicaSet or Deployment that will consume
                                this ConfigMap. Selecting a controller-created Pod writes
                                the reference to its owner&apos;s Pod template.
                            </span>
                        </label>
                        <select
                            className="modal-field__input modal-field__input--select"
                            value={state.cmTarget}
                            onChange={(e) => {
                                set.setCmTarget(e.target.value);
                                set.setCmKey('');
                            }}
                        >
                            <option value="">(no target, just create the ConfigMap)</option>
                            {derived.cmTargetOptions.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                </option>
                            ))}
                        </select>
                    </div>
                    {state.cmTarget && (
                        <>
                            <div className="modal-field">
                                <label className="modal-field__label">
                                    Reference mechanism
                                    <span className="modal-field__hint">
                                        How the target consumes the ConfigMap.
                                    </span>
                                </label>
                                <select
                                    className="modal-field__input modal-field__input--select"
                                    value={state.cmMechanism}
                                    onChange={(e) => {
                                        set.setCmMechanism(e.target.value as ConfigMapMechanism);
                                        set.setCmKey('');
                                    }}
                                >
                                    <option value="envFrom">envFrom: inject all keys as env vars</option>
                                    <option value="volumes">volumes: mount as files</option>
                                    <option value="envKey">env: inject a single key</option>
                                </select>
                            </div>
                            {state.cmMechanism === 'envKey' && (
                                <div className="modal-field">
                                    <label className="modal-field__label">
                                        Data key
                                        <span className="modal-field__hint">
                                            The ConfigMap key injected as an env var.
                                        </span>
                                    </label>
                                    <select
                                        className="modal-field__input modal-field__input--select"
                                        value={state.cmKey}
                                        onChange={(e) => set.setCmKey(e.target.value)}
                                    >
                                        <option value="">(select a key)</option>
                                        {derived.cmDataKeys.map((k) => (
                                            <option key={k} value={k}>
                                                {k}
                                            </option>
                                        ))}
                                    </select>
                                    {derived.cmDataKeys.length === 0 && (
                                        <span className="modal-field__error">
                                            This ConfigMap has no data keys; add some above or
                                            pick envFrom / volumes.
                                        </span>
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </>
            )}

            {/* Secret: labels + annotations + data + optional link */}
            {kind === 'Secret' && (
                <>
                    <div className="modal-field">
                        <label className="modal-field__label">
                            Labels
                            <span className="modal-field__hint">
                                Comma-separated key=value pairs (optional).
                            </span>
                        </label>
                        <input
                            className="modal-field__input"
                            value={state.secretLabels}
                            onChange={(e) => set.setSecretLabels(e.target.value)}
                            placeholder="app=my-app"
                        />
                    </div>
                    <div className="modal-field">
                        <label className="modal-field__label">
                            Annotations
                            <span className="modal-field__hint">
                                Comma-separated key=value pairs (optional).
                            </span>
                        </label>
                        <input
                            className="modal-field__input"
                            value={state.secretAnnotations}
                            onChange={(e) => set.setSecretAnnotations(e.target.value)}
                            placeholder="owner=team-a"
                        />
                    </div>
                    <div className="modal-field">
                        <label className="modal-field__label">
                            Data
                            <span className="modal-field__hint">
                                Optional key/value entries, injected into Pods via
                                envFrom, env.valueFrom or volumes. Values are stored
                                as-is (Kubernetes expects base64 in spec.data).
                            </span>
                        </label>
                        <ConfigMapDataEditor
                            resource={{
                                apiVersion: 'v1',
                                kind: 'Secret',
                                metadata: { name: state.name.trim() || derived.suggestedName },
                                data: state.secretData,
                            }}
                            resetToken="create-secret"
                            onCommit={set.setSecretData}
                        />
                    </div>
                    <div className="modal-field">
                        <label className="modal-field__label">
                            Link to a resource (optional)
                            <span className="modal-field__hint">
                                Picks a Pod, ReplicaSet or Deployment that will consume
                                this Secret. Selecting a controller-created Pod writes
                                the reference to its owner&apos;s Pod template.
                            </span>
                        </label>
                        <select
                            className="modal-field__input modal-field__input--select"
                            value={state.secretTarget}
                            onChange={(e) => {
                                set.setSecretTarget(e.target.value);
                                set.setSecretKey('');
                            }}
                        >
                            <option value="">(no target, just create the Secret)</option>
                            {derived.secretTargetOptions.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                </option>
                            ))}
                        </select>
                    </div>
                    {state.secretTarget && (
                        <>
                            <div className="modal-field">
                                <label className="modal-field__label">
                                    Reference mechanism
                                    <span className="modal-field__hint">
                                        How the target consumes the Secret.
                                    </span>
                                </label>
                                <select
                                    className="modal-field__input modal-field__input--select"
                                    value={state.secretMechanism}
                                    onChange={(e) => {
                                        set.setSecretMechanism(e.target.value as SecretMechanism);
                                        set.setSecretKey('');
                                    }}
                                >
                                    <option value="envFrom">envFrom: inject all keys as env vars</option>
                                    <option value="volumes">volumes: mount as files</option>
                                    <option value="envKey">env: inject a single key</option>
                                </select>
                            </div>
                            {state.secretMechanism === 'envKey' && (
                                <div className="modal-field">
                                    <label className="modal-field__label">
                                        Data key
                                        <span className="modal-field__hint">
                                            The Secret key injected as an env var.
                                        </span>
                                    </label>
                                    <select
                                        className="modal-field__input modal-field__input--select"
                                        value={state.secretKey}
                                        onChange={(e) => set.setSecretKey(e.target.value)}
                                    >
                                        <option value="">(select a key)</option>
                                        {derived.secretDataKeys.map((k) => (
                                            <option key={k} value={k}>
                                                {k}
                                            </option>
                                        ))}
                                    </select>
                                    {derived.secretDataKeys.length === 0 && (
                                        <span className="modal-field__error">
                                            This Secret has no data keys; add some above or
                                            pick envFrom / volumes.
                                        </span>
                                    )}
                                </div>
                            )}
                            {state.secretMechanism === 'volumes' && (
                                <div className="modal-field">
                                    <label className="modal-field__label">
                                        Volume name
                                        <span className="modal-field__hint">
                                            The volume name inside the Pod (defaults to the
                                            Secret name).
                                        </span>
                                    </label>
                                    <input
                                        className="modal-field__input"
                                        value={state.secretVolumeName}
                                        onChange={(e) => set.setSecretVolumeName(e.target.value)}
                                        placeholder={state.name.trim() || derived.suggestedName}
                                    />
                                </div>
                            )}
                        </>
                    )}
                </>
            )}
        </>
    );
}