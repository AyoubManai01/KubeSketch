import type { SupportedKind } from '../../../types/types';
import type { CreateFormBundle } from '../formTypes';

interface Props {
    kind: SupportedKind;
    form: CreateFormBundle;
}

/** Workload replicas + Pod container + Job + CronJob sections. */
export function WorkloadSections({ kind, form }: Props) {
    const { state, set, derived } = form;
    const { isWorkload, scheduleError } = derived;

    return (
        <>
            {/* Workload: replicas */}
            {isWorkload && (
                <div className="modal-field">
                    <label className="modal-field__label">
                        Replicas
                        <span className="modal-field__hint">
                            {kind === 'Deployment'
                                ? 'Its ReplicaSet and this many Pods are created automatically, like a real cluster.'
                                : 'This many Pods are created automatically.'}
                        </span>
                    </label>
                    <input
                        className="modal-field__input"
                        type="number"
                        min={0}
                        value={state.replicas}
                        onChange={(e) => set.setReplicas(e.target.value)}
                        placeholder="3"
                    />
                </div>
            )}

            {/* Pod: container */}
            {kind === 'Pod' && (
                <div className="modal-row">
                    <div className="modal-field">
                        <label className="modal-field__label">Container Name</label>
                        <input
                            className="modal-field__input"
                            value={state.containerName}
                            onChange={(e) => set.setContainerName(e.target.value)}
                            placeholder="app"
                        />
                    </div>
                    <div className="modal-field">
                        <label className="modal-field__label">Image</label>
                        <input
                            className="modal-field__input"
                            value={state.containerImage}
                            onChange={(e) => set.setContainerImage(e.target.value)}
                            placeholder="nginx:latest"
                        />
                    </div>
                </div>
            )}

            {/* Job: restart policy + parallelism + completions */}
            {kind === 'Job' && (
                <>
                    <div className="modal-field">
                        <label className="modal-field__label">
                            Restart Policy
                            <span className="modal-field__hint">
                                OnFailure restarts the failed container in the same Pod; Never lets the Pod fail so a new one is created.
                            </span>
                        </label>
                        <select
                            className="modal-field__input modal-field__input--select"
                            value={state.restartPolicy}
                            onChange={(e) => set.setRestartPolicy(e.target.value)}
                        >
                            <option>OnFailure</option>
                            <option>Never</option>
                        </select>
                    </div>
                    <div className="modal-row">
                        <div className="modal-field">
                            <label className="modal-field__label">
                                Parallelism
                                <span className="modal-field__hint">
                                    How many Pods run at the same time.
                                </span>
                            </label>
                            <input
                                className="modal-field__input"
                                type="number"
                                min={1}
                                value={state.parallelism}
                                onChange={(e) => set.setParallelism(e.target.value)}
                                placeholder="1"
                            />
                        </div>
                        <div className="modal-field">
                            <label className="modal-field__label">
                                Completions
                                <span className="modal-field__hint">
                                    Total Pods to run to completion.
                                </span>
                            </label>
                            <input
                                className="modal-field__input"
                                type="number"
                                min={1}
                                value={state.completions}
                                onChange={(e) => set.setCompletions(e.target.value)}
                                placeholder="1"
                            />
                        </div>
                    </div>
                    <div className="modal-row">
                        <div className="modal-field">
                            <label className="modal-field__label">Container Name</label>
                            <input
                                className="modal-field__input"
                                value={state.containerName}
                                onChange={(e) => set.setContainerName(e.target.value)}
                                placeholder="app"
                            />
                        </div>
                        <div className="modal-field">
                            <label className="modal-field__label">Image</label>
                            <input
                                className="modal-field__input"
                                value={state.containerImage}
                                onChange={(e) => set.setContainerImage(e.target.value)}
                                placeholder="nginx:latest"
                            />
                        </div>
                    </div>
                </>
            )}

            {/* CronJob: schedule + job template (restart/parallelism/completions) + pod (container/shell) */}
            {kind === 'CronJob' && (
                <>
                    <div className="modal-field">
                        <label className="modal-field__label">
                            Schedule
                            <span className="modal-field__hint">
                                Standard 5-field cron (minute hour day month weekday),
                                e.g. &quot;0 9 * * 1&quot; for every Monday 09:00, or an
                                @-descriptor like @hourly. Runs every minute by default.
                            </span>
                        </label>
                        <input
                            className={`modal-field__input ${scheduleError ? 'modal-field__input--invalid' : ''}`}
                            value={state.schedule}
                            onChange={(e) => set.setSchedule(e.target.value)}
                            placeholder="* * * * *"
                        />
                        {scheduleError && (
                            <span className="modal-field__error">{scheduleError}</span>
                        )}
                    </div>
                    <div className="modal-field">
                        <label className="modal-field__label">
                            Restart Policy
                            <span className="modal-field__hint">
                                OnFailure restarts the failed container in the same Pod;
                                Never lets the Pod fail so a new one is created.
                            </span>
                        </label>
                        <select
                            className="modal-field__input modal-field__input--select"
                            value={state.restartPolicy}
                            onChange={(e) => set.setRestartPolicy(e.target.value)}
                        >
                            <option>OnFailure</option>
                            <option>Never</option>
                        </select>
                    </div>
                    <div className="modal-row">
                        <div className="modal-field">
                            <label className="modal-field__label">
                                Parallelism
                                <span className="modal-field__hint">
                                    How many Pods the created Job runs at the same time.
                                </span>
                            </label>
                            <input
                                className="modal-field__input"
                                type="number"
                                min={1}
                                value={state.parallelism}
                                onChange={(e) => set.setParallelism(e.target.value)}
                                placeholder="1"
                            />
                        </div>
                        <div className="modal-field">
                            <label className="modal-field__label">
                                Completions
                                <span className="modal-field__hint">
                                    Total Pods the created Job runs to completion.
                                </span>
                            </label>
                            <input
                                className="modal-field__input"
                                type="number"
                                min={1}
                                value={state.completions}
                                onChange={(e) => set.setCompletions(e.target.value)}
                                placeholder="1"
                            />
                        </div>
                    </div>
                    <div className="modal-row">
                        <div className="modal-field">
                            <label className="modal-field__label">Container Name</label>
                            <input
                                className="modal-field__input"
                                value={state.containerName}
                                onChange={(e) => set.setContainerName(e.target.value)}
                                placeholder="app"
                            />
                        </div>
                        <div className="modal-field">
                            <label className="modal-field__label">Image</label>
                            <input
                                className="modal-field__input"
                                value={state.containerImage}
                                onChange={(e) => set.setContainerImage(e.target.value)}
                                placeholder="nginx:latest"
                            />
                        </div>
                    </div>
                    <div className="modal-field">
                        <label className="modal-field__label">
                            <span className="modal-field__checkrow">
                                <input
                                    type="checkbox"
                                    className="modal-field__checkbox"
                                    checked={state.shellCommandEnabled}
                                    onChange={(e) => set.setShellCommandEnabled(e.target.checked)}
                                />
                                <span className="modal-field__checkrow-text">
                                    Run a shell command (optional)
                                </span>
                            </span>
                            <span className="modal-field__hint">
                                Runs /bin/sh -c &quot;&lt;command&gt;&quot; in the
                                container instead of the image&apos;s default command.
                            </span>
                        </label>
                    </div>
                    {state.shellCommandEnabled && (
                        <div className="modal-field">
                            <label className="modal-field__label">Shell command</label>
                            <textarea
                                className="modal-field__input modal-field__input--textarea"
                                value={state.shellCommand}
                                onChange={(e) => set.setShellCommand(e.target.value)}
                                placeholder="echo hello && date"
                                rows={2}
                            />
                        </div>
                    )}
                </>
            )}
        </>
    );
}