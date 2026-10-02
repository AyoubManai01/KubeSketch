import type { K8sResource } from '../../types/types';
import { isRouteKind } from './kinds';

export function getIngressServiceNames(resource: K8sResource): string[] {
    const spec = resource.spec as {
        rules?: Array<{
            http?: {
                paths?: Array<{
                    backend?: { service?: { name?: string } };
                }>;
            };
        }>;
    } | undefined;

    const names: string[] = [];
    spec?.rules?.forEach((rule) => {
        rule.http?.paths?.forEach((path) => {
            const name = path.backend?.service?.name;
            if (name) names.push(name);
        });
    });
    return names;
}

/** The Secret names an Ingress terminates TLS with (from spec.tls[].secretName). */
export function getIngressTlsSecretNames(resource: K8sResource): string[] {
    const spec = resource.spec as
        | { tls?: Array<{ secretName?: string; hosts?: string[] }> }
        | undefined;

    const names: string[] = [];
    const seen = new Set<string>();
    spec?.tls?.forEach((tls) => {
        const name = tls?.secretName;
        if (typeof name === 'string' && name && !seen.has(name)) {
            seen.add(name);
            names.push(name);
        }
    });
    return names;
}

/** The GatewayClass a Gateway references (spec.gatewayClassName), or undefined. */
export function getGatewayClassName(gateway: K8sResource): string | undefined {
    const spec = gateway.spec as { gatewayClassName?: unknown } | undefined;
    const name = spec?.gatewayClassName;
    return typeof name === 'string' && name.trim() ? name : undefined;
}

/** The Gateway names a route attaches to (spec.parentRefs[].name), in document order. */
export function getRouteParentRefNames(route: K8sResource): string[] {
    const spec = route.spec as { parentRefs?: Array<{ name?: unknown }> } | undefined;
    if (!Array.isArray(spec?.parentRefs)) return [];
    return spec.parentRefs
        .filter((ref) => ref && typeof ref.name === 'string' && ref.name.trim())
        .map((ref) => ref.name as string);
}

/** The Service names a route routes to (spec.backendRefs[].name), in document order. */
export function getRouteBackendRefNames(route: K8sResource): string[] {
    const spec = route.spec as { backendRefs?: Array<{ name?: unknown }> } | undefined;
    if (!Array.isArray(spec?.backendRefs)) return [];
    return spec.backendRefs
        .filter((ref) => ref && typeof ref.name === 'string' && ref.name.trim())
        .map((ref) => ref.name as string);
}

/** All Gateways referencing the given GatewayClass by name (spec.gatewayClassName). */
export function getGatewaysUsingClass(resources: K8sResource[], className: string): K8sResource[] {
    return resources.filter(
        (r) => r.kind === 'Gateway' && getGatewayClassName(r) === className
    );
}

/** All Routes attached to the given Gateway by name (spec.parentRefs[].name). */
export function getRoutesForGateway(resources: K8sResource[], gatewayName: string): K8sResource[] {
    return resources.filter(
        (r) => isRouteKind(r.kind) && getRouteParentRefNames(r).includes(gatewayName)
    );
}

/** All Routes routing to the given Service by name (spec.backendRefs[].name). */
export function getRoutesForService(resources: K8sResource[], serviceName: string): K8sResource[] {
    return resources.filter(
        (r) => isRouteKind(r.kind) && getRouteBackendRefNames(r).includes(serviceName)
    );
}
