import type { SupportedKind } from '../../../types/types';
import type { CreateFormBundle } from '../formTypes';

interface Props {
    kind: SupportedKind;
    form: CreateFormBundle;
}

/** App Label: auto-generated for workloads/Pods, target picker for Services. */
export function AppLabelSection({ kind, form }: Props) {
    const { set, derived } = form;
    const { setAppLabelTouched, setAppLabelDraft } = set;
    const { isWorkload, appLabel, workloadTargets } = derived;

    const handleAppLabelChange = (value: string) => {
        setAppLabelTouched(true);
        setAppLabelDraft(value);
    };

    return (
        <>
            {(isWorkload || kind === 'Pod' || kind === 'Job' || kind === 'CronJob') && (
                <div className="modal-field">
                    <label className="modal-field__label">
                        App Label
                        <span className="modal-field__hint">
                            {isWorkload || kind === 'Job' || kind === 'CronJob'
                                ? 'Auto-generated from the name. Sets metadata.labels.app and spec.selector.matchLabels.app.'
                                : 'Auto-generated from the name. Sets metadata.labels.app, which enables containment inside matching ReplicaSets.'}
                        </span>
                    </label>
                    <input
                        className="modal-field__input"
                        value={appLabel}
                        onChange={(e) => handleAppLabelChange(e.target.value)}
                        placeholder="my-app"
                    />
                </div>
            )}
            {kind === 'Service' && (
                <div className="modal-field">
                    <label className="modal-field__label">
                        Route to workload
                        <span className="modal-field__hint">
                            Sets spec.selector.app; pick an existing workload or Pod to send traffic to.
                        </span>
                    </label>
                    <select
                        className="modal-field__input modal-field__input--select"
                        value={appLabel}
                        onChange={(e) => handleAppLabelChange(e.target.value)}
                    >
                        <option value="">(no selector yet)</option>
                        {workloadTargets.map((t) => (
                            <option key={t.value} value={t.value}>
                                {t.value} ({t.owners})
                            </option>
                        ))}
                    </select>
                </div>
            )}
        </>
    );
}