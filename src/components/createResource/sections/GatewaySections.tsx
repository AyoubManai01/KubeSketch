import type { SupportedKind } from '../../../types/types';
import type { CreateFormBundle } from '../formTypes';

interface Props {
    kind: SupportedKind;
    form: CreateFormBundle;
}

/** GatewayClass (controller name) + Gateway (class picker) + Routes (parent/backends). */
export function GatewaySections({ kind, form }: Props) {
    const { state, set, derived } = form;

    return (
        <>
            {/* GatewayClass: controller name (cluster-scoped) */}
            {kind === 'GatewayClass' && (
                <div className="modal-field">
                    <label className="modal-field__label">
                        Controller Name
                        <span className="modal-field__hint">
                            spec.controllerName: the controller that reconciles
                            Gateways of this class.
                        </span>
                    </label>
                    <input
                        className="modal-field__input"
                        value={state.gcControllerName}
                        onChange={(e) => set.setGcControllerName(e.target.value)}
                        placeholder="acme.io/gateway-controller"
                    />
                </div>
            )}

            {/* Gateway: pick its GatewayClass (spec.gatewayClassName) */}
            {kind === 'Gateway' && (
                <div className="modal-field">
                    <label className="modal-field__label">
                        Gateway Class
                        <span className="modal-field__hint">
                            A Gateway is created from exactly one GatewayClass.
                        </span>
                    </label>
                    <select
                        className="modal-field__input modal-field__input--select"
                        value={state.gwClassName}
                        onChange={(e) => set.setGwClassName(e.target.value)}
                    >
                        <option value="">(no class yet)</option>
                        {derived.gatewayClassOptions.map((gc) => (
                            <option key={gc} value={gc}>{gc}</option>
                        ))}
                    </select>
                </div>
            )}

            {/* Routes (HTTPRoute/GRPCRoute/TCPRoute/TLSRoute/UDPRoute): parent Gateway + backends */}
            {(kind === 'HTTPRoute' || kind === 'GRPCRoute' || kind === 'TCPRoute' || kind === 'TLSRoute' || kind === 'UDPRoute') && (
                <>
                    <div className="modal-field">
                        <label className="modal-field__label">
                            Parent Gateway
                            <span className="modal-field__hint">
                                The Gateway this route attaches to (spec.parentRefs).
                            </span>
                        </label>
                        <select
                            className="modal-field__input modal-field__input--select"
                            value={state.routeParentGateway}
                            onChange={(e) => set.setRouteParentGateway(e.target.value)}
                        >
                            <option value="">(no parent yet)</option>
                            {derived.gatewayOptions.map((gw) => (
                                <option key={gw} value={gw}>{gw}</option>
                            ))}
                        </select>
                    </div>
                    {kind !== 'TCPRoute' && kind !== 'UDPRoute' && (
                        <div className="modal-field">
                            <label className="modal-field__label">
                                Hostnames
                                <span className="modal-field__hint">
                                    Comma-separated spec.hostnames (SNI matching for TLSRoute).
                                </span>
                            </label>
                            <input
                                className="modal-field__input"
                                value={state.routeHostnames}
                                onChange={(e) => set.setRouteHostnames(e.target.value)}
                                placeholder="api.example.com"
                            />
                        </div>
                    )}
                    <div className="modal-field">
                        <label className="modal-field__label">
                            Backend Service
                            <span className="modal-field__hint">
                                A Route only routes to Services (spec.backendRefs).
                            </span>
                        </label>
                        <select
                            className="modal-field__input modal-field__input--select"
                            value={state.routeBackendService}
                            onChange={(e) => set.setRouteBackendService(e.target.value)}
                        >
                            <option value="">(no backend yet)</option>
                            {derived.serviceOptions.map((svc) => (
                                <option key={svc} value={svc}>{svc}</option>
                            ))}
                        </select>
                    </div>
                </>
            )}
        </>
    );
}