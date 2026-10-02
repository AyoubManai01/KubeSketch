import type { SupportedKind } from '../../../types/types';
import type { CreateFormBundle } from '../formTypes';

interface Props {
    kind: SupportedKind;
    form: CreateFormBundle;
}

/** PVC (access modes + optional mount/bind links) + PV + StorageClass sections. */
export function StorageSections({ kind, form }: Props) {
    const { state, set, derived } = form;

    return (
        <>
            {/* PVC: access modes + size + optional mount/bind links */}
            {kind === 'PersistentVolumeClaim' && (
                <>
                    <div className="modal-row">
                        <div className="modal-field">
                            <label className="modal-field__label">Access Mode</label>
                            <select
                                className="modal-field__input modal-field__input--select"
                                value={state.pvcAccessModes}
                                onChange={(e) => set.setPvcAccessModes(e.target.value)}
                            >
                                <option>ReadWriteOnce</option>
                                <option>ReadOnlyMany</option>
                                <option>ReadWriteMany</option>
                                <option>ReadWriteOncePod</option>
                            </select>
                        </div>
                        <div className="modal-field">
                            <label className="modal-field__label">Size Request</label>
                            <input
                                className="modal-field__input"
                                value={state.pvcSize}
                                onChange={(e) => set.setPvcSize(e.target.value)}
                                placeholder="1Gi"
                            />
                        </div>
                    </div>
                    <div className="modal-field">
                        <label className="modal-field__label">
                            Mount into (optional)
                            <span className="modal-field__hint">
                                Writes spec.volumes[].persistentVolumeClaim into a Pod
                                or a workload&apos;s Pod template (Deployment/ReplicaSet).
                                Requires a volume name.
                            </span>
                        </label>
                        <select
                            className="modal-field__input modal-field__input--select"
                            value={state.pvcMountTarget}
                            onChange={(e) => {
                                set.setPvcMountTarget(e.target.value);
                                if (e.target.value && !state.pvcVolumeName) {
                                    set.setPvcVolumeName(state.name.trim() || derived.suggestedName);
                                }
                            }}
                        >
                            <option value="">(no mount, just create the claim)</option>
                            {derived.pvcMountOptions.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                </option>
                            ))}
                        </select>
                        {derived.pvcMountReplicasError && (
                            <span className="modal-field__error">{derived.pvcMountReplicasError}</span>
                        )}
                    </div>
                    {state.pvcMountTarget && (
                        <div className="modal-field">
                            <label className="modal-field__label">Volume name</label>
                            <input
                                className="modal-field__input"
                                value={state.pvcVolumeName}
                                onChange={(e) => set.setPvcVolumeName(e.target.value)}
                                placeholder={state.name.trim() || derived.suggestedName}
                            />
                        </div>
                    )}
                    <div className="modal-field">
                        <label className="modal-field__label">
                            Bind to (optional)
                            <span className="modal-field__hint">
                                A PVC binds to exactly one target: a PV sets
                                spec.volumeName, a StorageClass sets
                                spec.storageClassName.
                            </span>
                        </label>
                        <select
                            className="modal-field__input modal-field__input--select"
                            value={state.pvcBindTarget}
                            onChange={(e) => set.setPvcBindTarget(e.target.value)}
                        >
                            <option value="">(unbound: no storageClassName, no volumeName)</option>
                            {derived.pvOptions.map((pv) => (
                                <option
                                    key={`PersistentVolume|${pv.name}`}
                                    value={`PersistentVolume|${pv.name}`}
                                >
                                    PV {pv.name}
                                    {pv.bound ? ` (claimed by ${pv.bound})` : ''}
                                </option>
                            ))}
                            {derived.storageClassOptions.map((sc) => (
                                <option key={`StorageClass|${sc}`} value={`StorageClass|${sc}`}>
                                    StorageClass {sc}
                                </option>
                            ))}
                        </select>
                        {state.pvcBindTarget && (
                            <span className="modal-field__hint">
                                {state.pvcBindTarget.startsWith('PersistentVolume')
                                    ? 'Writes spec.volumeName; the claim binds to that PV directly.'
                                    : 'Writes spec.storageClassName; the claim provisions storage through that class.'}
                            </span>
                        )}
                    </div>
                </>
            )}

            {/* PV: capacity + access modes + reclaim policy */}
            {kind === 'PersistentVolume' && (
                <>
                    <div className="modal-row">
                        <div className="modal-field">
                            <label className="modal-field__label">Capacity</label>
                            <input
                                className="modal-field__input"
                                value={state.pvCapacity}
                                onChange={(e) => set.setPvCapacity(e.target.value)}
                                placeholder="10Gi"
                            />
                        </div>
                        <div className="modal-field">
                            <label className="modal-field__label">Access Mode</label>
                            <select
                                className="modal-field__input modal-field__input--select"
                                value={state.pvAccessModes}
                                onChange={(e) => set.setPvAccessModes(e.target.value)}
                            >
                                <option>ReadWriteOnce</option>
                                <option>ReadOnlyMany</option>
                                <option>ReadWriteMany</option>
                                <option>ReadWriteOncePod</option>
                            </select>
                        </div>
                    </div>
                    <div className="modal-field">
                        <label className="modal-field__label">Reclaim Policy</label>
                        <select
                            className="modal-field__input modal-field__input--select"
                            value={state.pvReclaimPolicy}
                            onChange={(e) => set.setPvReclaimPolicy(e.target.value)}
                        >
                            <option>Retain</option>
                            <option>Recycle</option>
                            <option>Delete</option>
                        </select>
                    </div>
                </>
            )}

            {/* StorageClass: provisioner + reclaim policy */}
            {kind === 'StorageClass' && (
                <>
                    <div className="modal-field">
                        <label className="modal-field__label">
                            Provisioner
                            <span className="modal-field__hint">
                                The storage provisioner that creates volumes for
                                claims using this class.
                            </span>
                        </label>
                        <input
                            className="modal-field__input"
                            value={state.scProvisioner}
                            onChange={(e) => set.setScProvisioner(e.target.value)}
                            placeholder="kubernetes.io/no-provisioner"
                        />
                    </div>
                    <div className="modal-field">
                        <label className="modal-field__label">Reclaim Policy</label>
                        <select
                            className="modal-field__input modal-field__input--select"
                            value={state.scReclaimPolicy}
                            onChange={(e) => set.setScReclaimPolicy(e.target.value)}
                        >
                            <option>Delete</option>
                            <option>Retain</option>
                            <option>Recycle</option>
                        </select>
                    </div>
                </>
            )}
        </>
    );
}