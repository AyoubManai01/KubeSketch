import type { SupportedKind } from '../../../types/types';
import type { CreateFormBundle } from '../formTypes';

interface Props {
    kind: SupportedKind;
    form: CreateFormBundle;
}

/** Service + Ingress + HorizontalPodAutoscaler + VPA sections. */
export function NetworkSections({ kind, form }: Props) {
    const { state, set, derived } = form;

    return (
        <>
            {/* Service: type + ports */}
            {kind === 'Service' && (
                <>
                    <div className="modal-row">
                        <div className="modal-field">
                            <label className="modal-field__label">Service Type</label>
                            <select
                                className="modal-field__input modal-field__input--select"
                                value={state.serviceType}
                                onChange={(e) => set.setServiceType(e.target.value)}
                            >
                                <option>ClusterIP</option>
                                <option>NodePort</option>
                                <option>LoadBalancer</option>
                                <option>ExternalName</option>
                            </select>
                        </div>
                    </div>
                    <div className="modal-row">
                        <div className="modal-field">
                            <label className="modal-field__label">Port</label>
                            <input
                                className="modal-field__input"
                                type="number"
                                value={state.port}
                                onChange={(e) => set.setPort(e.target.value)}
                                placeholder="80"
                            />
                        </div>
                        <div className="modal-field">
                            <label className="modal-field__label">Target Port</label>
                            <input
                                className="modal-field__input"
                                type="number"
                                value={state.targetPort}
                                onChange={(e) => set.setTargetPort(e.target.value)}
                                placeholder="8080"
                            />
                        </div>
                    </div>
                </>
            )}

            {/* Ingress: host + path + backend */}
            {kind === 'Ingress' && (
                <>
                    <div className="modal-row">
                        <div className="modal-field">
                            <label className="modal-field__label">Host</label>
                            <input
                                className="modal-field__input"
                                value={state.host}
                                onChange={(e) => set.setHost(e.target.value)}
                                placeholder="my-app.example.com"
                            />
                        </div>
                        <div className="modal-field">
                            <label className="modal-field__label">Path</label>
                            <input
                                className="modal-field__input"
                                value={state.path}
                                onChange={(e) => set.setPath(e.target.value)}
                                placeholder="/"
                            />
                        </div>
                    </div>
                    <div className="modal-field">
                        <label className="modal-field__label">
                            Backend Service
                            <span className="modal-field__hint">
                                Lists the Services that currently exist on the canvas.
                            </span>
                        </label>
                        <select
                            className="modal-field__input modal-field__input--select"
                            value={state.backendService}
                            onChange={(e) => set.setBackendService(e.target.value)}
                        >
                            <option value="">(no backend yet)</option>
                            {derived.serviceOptions.map((s) => (
                                <option key={s} value={s}>{s}</option>
                            ))}
                        </select>
                    </div>
                    <div className="modal-field">
                        <label className="modal-field__label">
                            TLS Secret (optional)
                            <span className="modal-field__hint">
                                Writes spec.tls[].secretName to terminate HTTPS with
                                this Secret. Lists the Secrets that currently exist
                                on the canvas.
                            </span>
                        </label>
                        <select
                            className="modal-field__input modal-field__input--select"
                            value={state.ingressTlsSecret}
                            onChange={(e) => set.setIngressTlsSecret(e.target.value)}
                        >
                            <option value="">(no TLS)</option>
                            {derived.ingressTlsSecretOptions.map((s) => (
                                <option key={s} value={s}>{s}</option>
                            ))}
                        </select>
                    </div>
                    {state.ingressTlsSecret && (
                        <div className="modal-field">
                            <label className="modal-field__label">
                                TLS hosts
                                <span className="modal-field__hint">
                                    One per line or comma-separated. Leave empty to
                                    terminate TLS for all hosts.
                                </span>
                            </label>
                            <input
                                className="modal-field__input"
                                value={state.ingressTlsHosts}
                                onChange={(e) => set.setIngressTlsHosts(e.target.value)}
                                placeholder="app.example.com"
                            />
                        </div>
                    )}
                </>
            )}

            {/* HorizontalPodAutoscaler: scale target + replica bounds */}
            {kind === 'HorizontalPodAutoscaler' && (
                <>
                    <div className="modal-field">
                        <label className="modal-field__label">
                            Scale target
                            <span className="modal-field__hint">
                                Sets spec.scaleTargetRef: the Deployment or ReplicaSet this HorizontalPodAutoscaler scales.
                            </span>
                        </label>
                        <select
                            className="modal-field__input modal-field__input--select"
                            value={state.targetWorkload}
                            onChange={(e) => set.setTargetWorkload(e.target.value)}
                        >
                            <option value="">(select a workload)</option>
                            {derived.workloadOptions.map((w) => (
                                <option key={`${w.kind}|${w.name}`} value={`${w.kind}|${w.name}`}>
                                    {w.kind} {w.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="modal-row">
                        <div className="modal-field">
                            <label className="modal-field__label">Min Replicas</label>
                            <input
                                className="modal-field__input"
                                type="number"
                                min={1}
                                value={state.minReplicas}
                                onChange={(e) => set.setMinReplicas(e.target.value)}
                                placeholder="1"
                            />
                        </div>
                        <div className="modal-field">
                            <label className="modal-field__label">Max Replicas</label>
                            <input
                                className="modal-field__input"
                                type="number"
                                min={1}
                                value={state.maxReplicas}
                                onChange={(e) => set.setMaxReplicas(e.target.value)}
                                placeholder="10"
                            />
                        </div>
                    </div>
                    <div className="modal-field">
                        <label className="modal-field__label">
                            CPU Target %
                            <span className="modal-field__hint">
                                Sets metrics[0].resource.target.averageUtilization.
                            </span>
                        </label>
                        <input
                            className="modal-field__input"
                            type="number"
                            min={1}
                            max={100}
                            value={state.cpuTarget}
                            onChange={(e) => set.setCpuTarget(e.target.value)}
                            placeholder="70"
                        />
                    </div>
                </>
            )}

            {/* VPA: targetRef + update mode + resource bounds */}
            {kind === 'VerticalPodAutoscaler' && (
                <>
                    <div className="modal-field">
                        <label className="modal-field__label">
                            Target (targetRef)
                            <span className="modal-field__hint">
                                Sets spec.targetRef: the Deployment, ReplicaSet, Pod, Job or CronJob whose Pod container requests this VPA adjusts.
                            </span>
                        </label>
                        <select
                            className="modal-field__input modal-field__input--select"
                            value={state.vpaTarget}
                            onChange={(e) => set.setVpaTarget(e.target.value)}
                        >
                            <option value="">(select a target)</option>
                            {derived.vpaTargetOptions.map((w) => (
                                <option key={`${w.kind}|${w.name}`} value={`${w.kind}|${w.name}`}>
                                    {w.kind} {w.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="modal-field">
                        <label className="modal-field__label">
                            Update Mode
                            <span className="modal-field__hint">
                                Auto applies recommended requests to new Pods; Initial only to the first; Recreate evicts running Pods; Off never applies.
                            </span>
                        </label>
                        <select
                            className="modal-field__input modal-field__input--select"
                            value={state.vpaUpdateMode}
                            onChange={(e) => set.setVpaUpdateMode(e.target.value)}
                        >
                            <option>Auto</option>
                            <option>Initial</option>
                            <option>Recreate</option>
                            <option>Off</option>
                        </select>
                    </div>
                    <div className="modal-row">
                        <div className="modal-field">
                            <label className="modal-field__label">Min CPU</label>
                            <input
                                className="modal-field__input"
                                value={state.vpaMinCpu}
                                onChange={(e) => set.setVpaMinCpu(e.target.value)}
                                placeholder="100m"
                            />
                        </div>
                        <div className="modal-field">
                            <label className="modal-field__label">Max CPU</label>
                            <input
                                className="modal-field__input"
                                value={state.vpaMaxCpu}
                                onChange={(e) => set.setVpaMaxCpu(e.target.value)}
                                placeholder="1"
                            />
                        </div>
                    </div>
                    <div className="modal-row">
                        <div className="modal-field">
                            <label className="modal-field__label">Min Memory</label>
                            <input
                                className="modal-field__input"
                                value={state.vpaMinMemory}
                                onChange={(e) => set.setVpaMinMemory(e.target.value)}
                                placeholder="256Mi"
                            />
                        </div>
                        <div className="modal-field">
                            <label className="modal-field__label">Max Memory</label>
                            <input
                                className="modal-field__input"
                                value={state.vpaMaxMemory}
                                onChange={(e) => set.setVpaMaxMemory(e.target.value)}
                                placeholder="2Gi"
                            />
                        </div>
                    </div>
                    <span className="modal-field__hint">
                        Bounds write spec.resourcePolicy.containerPolicies[0] (containerName &quot;*&quot;). Leave empty for unbounded.
                    </span>
                </>
            )}
        </>
    );
}