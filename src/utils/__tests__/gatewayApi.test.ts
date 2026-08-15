import { describe, it, expect } from 'vitest';
import {
    buildGraph,
    collectGatewayApiFamily,
    getGatewayClassName,
    getGatewaysUsingClass,
    getRouteBackendRefNames,
    getRouteParentRefNames,
    getRoutesForGateway,
    getRoutesForService,
    nodeIdFor,
    isRouteKind,
    isGatewayApiKind,
} from '../buildGraph';
import { connectResources, explainInvalidLink } from '../linkResources';
import type { K8sResource } from '../../types/types';

type RouteKind = 'HTTPRoute' | 'GRPCRoute' | 'TCPRoute' | 'TLSRoute' | 'UDPRoute';

function gatewayClass(name: string): K8sResource {
    return {
        apiVersion: 'gateway.networking.k8s.io/v1',
        kind: 'GatewayClass',
        metadata: { name },
        spec: { controllerName: 'acme.io/gateway-controller' },
    };
}

function gateway(name: string, className?: string, namespace = 'default'): K8sResource {
    return {
        apiVersion: 'gateway.networking.k8s.io/v1',
        kind: 'Gateway',
        metadata: { name, namespace },
        spec: {
            ...(className ? { gatewayClassName: className } : {}),
            listeners: [{ port: 80, protocol: 'HTTP' }],
        },
    };
}

function route(
    kind: RouteKind,
    name: string,
    parentGateway?: string,
    backendServices: string[] = [],
    hostnames: string[] = []
): K8sResource {
    const spec: Record<string, unknown> = {};
    if (parentGateway) {
        spec.parentRefs = [{ name: parentGateway, namespace: 'default' }];
    }
    if (hostnames.length > 0 && kind !== 'TCPRoute' && kind !== 'UDPRoute') {
        spec.hostnames = hostnames;
    }
    if (backendServices.length > 0) {
        spec.backendRefs = backendServices.map((name) => ({ name, port: 80 }));
    }
    return {
        apiVersion: 'gateway.networking.k8s.io/v1',
        kind,
        metadata: { name, namespace: 'default' },
        spec,
    };
}

function service(name: string, port = 80): K8sResource {
    return {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name, namespace: 'default' },
        spec: { selector: { app: name }, ports: [{ port }] },
    };
}

/** The React Flow node list for a set of resources (real nodes only). */
function nodesOf(resources: K8sResource[]): ReturnType<typeof buildGraph>['nodes'] {
    return buildGraph(resources, []).nodes;
}

describe('Gateway API kind predicates', () => {
    it('isGatewayApiKind covers the family and nothing else', () => {
        expect(isGatewayApiKind('GatewayClass')).toBe(true);
        expect(isGatewayApiKind('Gateway')).toBe(true);
        expect(isGatewayApiKind('HTTPRoute')).toBe(true);
        expect(isGatewayApiKind('GRPCRoute')).toBe(true);
        expect(isGatewayApiKind('TCPRoute')).toBe(true);
        expect(isGatewayApiKind('TLSRoute')).toBe(true);
        expect(isGatewayApiKind('UDPRoute')).toBe(true);
        expect(isGatewayApiKind('Service')).toBe(false);
        expect(isGatewayApiKind('Deployment')).toBe(false);
    });

    it('isRouteKind covers the five route kinds and nothing else', () => {
        expect(isRouteKind('HTTPRoute')).toBe(true);
        expect(isRouteKind('GRPCRoute')).toBe(true);
        expect(isRouteKind('TCPRoute')).toBe(true);
        expect(isRouteKind('TLSRoute')).toBe(true);
        expect(isRouteKind('UDPRoute')).toBe(true);
        expect(isRouteKind('Gateway')).toBe(false);
        expect(isRouteKind('Ingress')).toBe(false);
    });
});

describe('Gateway API lane layout', () => {
    it('places GatewayClass and Gateway in the Y=1480 gateway lane', () => {
        const { nodes } = buildGraph([gatewayClass('gc-1'), gateway('gw-1', 'gc-1')], []);
        const gcNode = nodes.find((n) => n.data.kind === 'GatewayClass')!;
        const gwNode = nodes.find((n) => n.data.kind === 'Gateway')!;
        expect(gcNode.position.y).toBe(1480);
        expect(gwNode.position.y).toBe(1480);
    });

    it('places all five route kinds in the Y=1640 route lane without overlapping', () => {
        const resources = [
            gatewayClass('gc-1'),
            gateway('gw-1', 'gc-1'),
            route('HTTPRoute', 'r-http', 'gw-1', ['s-1']),
            route('GRPCRoute', 'r-grpc', 'gw-1', ['s-1']),
            route('TCPRoute', 'r-tcp', 'gw-1', ['s-1']),
            route('TLSRoute', 'r-tls', 'gw-1', ['s-1']),
            route('UDPRoute', 'r-udp', 'gw-1', ['s-1']),
        ];
        const { nodes } = buildGraph(resources, []);
        const routeNodes = nodes.filter((n) => isRouteKind(n.data.kind));
        expect(routeNodes.length).toBe(5);
        routeNodes.forEach((n) => {
            expect(n.position.y).toBe(1640);
        });
        // No two route nodes overlap horizontally
        for (let i = 0; i < routeNodes.length; i++) {
            for (let j = i + 1; j < routeNodes.length; j++) {
                const a = routeNodes[i];
                const b = routeNodes[j];
                const aW = typeof a.style?.width === 'number' ? a.style.width : 180;
                const bW = typeof b.style?.width === 'number' ? b.style.width : 180;
                const overlap =
                    b.position.x < a.position.x + aW && b.position.x + bW > a.position.x;
                expect(overlap).toBe(false);
            }
        }
    });
});

describe('Gateway API inferred edges', () => {
    it("draws Gateway → GatewayClass 'class'", () => {
        const { nodes, edges } = buildGraph(
            [gatewayClass('gc-1'), gateway('gw-1', 'gc-1')],
            []
        );
        const gwNode = nodes.find((n) => n.data.kind === 'Gateway')!;
        const gcNode = nodes.find((n) => n.data.kind === 'GatewayClass')!;
        expect(
            edges.some((e) => e.source === gwNode.id && e.target === gcNode.id && e.label === 'class')
        ).toBe(true);
    });

    it("draws Route → Gateway 'attaches' and Route → Service 'routes to' for every route kind", () => {
        const resources = [
            gatewayClass('gc-1'),
            gateway('gw-1', 'gc-1'),
            service('s-1'),
            route('HTTPRoute', 'r-http', 'gw-1', ['s-1']),
            route('GRPCRoute', 'r-grpc', 'gw-1', ['s-1']),
            route('TCPRoute', 'r-tcp', 'gw-1', ['s-1']),
            route('TLSRoute', 'r-tls', 'gw-1', ['s-1']),
            route('UDPRoute', 'r-udp', 'gw-1', ['s-1']),
        ];
        const { nodes, edges } = buildGraph(resources, []);
        const gwNode = nodes.find((n) => n.data.kind === 'Gateway')!;
        const svcNode = nodes.find((n) => n.data.kind === 'Service')!;
        const routeNodes = nodes.filter((n) => isRouteKind(n.data.kind));
        routeNodes.forEach((r) => {
            expect(
                edges.some((e) => e.source === r.id && e.target === gwNode.id && e.label === 'attaches')
            ).toBe(true);
            expect(
                edges.some((e) => e.source === r.id && e.target === svcNode.id && e.label === 'routes to')
            ).toBe(true);
        });
    });

    it('draws nothing when the parent Gateway or backend Service is missing', () => {
        const { edges } = buildGraph([gatewayClass('gc-1'), route('HTTPRoute', 'r-1', 'missing-gw', ['missing-svc'])], []);
        expect(edges.length).toBe(0);
    });
});

describe('Gateway API reference readers', () => {
    it('getGatewayClassName reads spec.gatewayClassName', () => {
        expect(getGatewayClassName(gateway('gw-1', 'gc-1'))).toBe('gc-1');
        expect(getGatewayClassName(gateway('gw-2'))).toBeUndefined();
    });

    it('getRouteParentRefNames reads spec.parentRefs[].name', () => {
        expect(getRouteParentRefNames(route('HTTPRoute', 'r-1', 'gw-1'))).toEqual(['gw-1']);
        expect(getRouteParentRefNames(route('HTTPRoute', 'r-2'))).toEqual([]);
    });

    it('getRouteBackendRefNames reads spec.backendRefs[].name', () => {
        expect(getRouteBackendRefNames(route('GRPCRoute', 'r-1', 'gw-1', ['s-1', 's-2']))).toEqual([
            's-1',
            's-2',
        ]);
        expect(getRouteBackendRefNames(route('TCPRoute', 'r-2', 'gw-1'))).toEqual([]);
    });

    it('reverse readers find Gateways/Routes by reference', () => {
        const resources = [
            gatewayClass('gc-1'),
            gateway('gw-1', 'gc-1'),
            gateway('gw-2', 'gc-1'),
            gateway('gw-3', 'gc-2'),
            route('HTTPRoute', 'r-1', 'gw-1', ['s-1']),
            route('TLSRoute', 'r-2', 'gw-2', ['s-1']),
            route('TCPRoute', 'r-3', 'gw-2', ['s-2']),
        ];
        expect(getGatewaysUsingClass(resources, 'gc-1').map((r) => r.metadata.name).sort()).toEqual([
            'gw-1',
            'gw-2',
        ]);
        expect(getRoutesForGateway(resources, 'gw-2').map((r) => r.metadata.name).sort()).toEqual([
            'r-2',
            'r-3',
        ]);
        expect(getRoutesForService(resources, 's-1').map((r) => r.metadata.name).sort()).toEqual([
            'r-1',
            'r-2',
        ]);
    });
});

describe('Gateway API manual linking', () => {
    it('Gateway ↔ GatewayClass writes spec.gatewayClassName (1:1)', () => {
        const resources = [gatewayClass('gc-1'), gateway('gw-1')];
        const linked = connectResources(resources, 1, 0);
        expect(linked).not.toBeNull();
        expect(linked!.resources[1].spec).toMatchObject({ gatewayClassName: 'gc-1' });
    });

    it('Route ↔ Gateway writes spec.parentRefs[].name (appends, de-dupes)', () => {
        const resources = [gateway('gw-1', 'gc-1'), route('HTTPRoute', 'r-1')];
        const linked = connectResources(resources, 0, 1);
        expect(linked!.resources[1].spec).toMatchObject({
            parentRefs: [{ name: 'gw-1', namespace: 'default' }],
        });
        // second drag onto the same Gateway is a no-op (already attached)
        const again = connectResources(linked!.resources, 0, 1);
        expect(again!.resources[1].spec).toMatchObject({ parentRefs: [{ name: 'gw-1' }] });
    });

    it('Route ↔ Service writes spec.backendRefs with the Service port', () => {
        const resources = [service('s-1', 8080), route('GRPCRoute', 'r-1')];
        const linked = connectResources(resources, 0, 1);
        expect(linked!.resources[1].spec).toMatchObject({
            backendRefs: [{ name: 's-1', port: 8080 }],
        });
    });

    it('UDPRoute links to a Gateway and a Service like the other routes', () => {
        const resources = [
            gatewayClass('gc-1'),
            gateway('gw-1', 'gc-1'),
            service('s-1', 53),
            route('UDPRoute', 'r-udp'),
        ];
        const attached = connectResources(resources, 1, 3);
        expect(attached!.resources[3].spec).toMatchObject({
            parentRefs: [{ name: 'gw-1', namespace: 'default' }],
        });
        const routed = connectResources(resources, 2, 3);
        expect(routed!.resources[3].spec).toMatchObject({
            backendRefs: [{ name: 's-1', port: 53 }],
        });
    });

    it('rejects Gateway ↔ Service and explains why', () => {
        const resources = [service('s-1'), gateway('gw-1')];
        expect(connectResources(resources, 0, 1)).toBeNull();
        expect(explainInvalidLink('Gateway', 'Service')).toContain('not routed to Services');
    });

    it('rejects Route ↔ Deployment (routes only target Services)', () => {
        const dep: K8sResource = {
            apiVersion: 'apps/v1',
            kind: 'Deployment',
            metadata: { name: 'web' },
            spec: { replicas: 1 },
        };
        const resources = [dep, route('HTTPRoute', 'r-1')];
        expect(connectResources(resources, 0, 1)).toBeNull();
        expect(explainInvalidLink('HTTPRoute', 'Deployment')).toContain('only route to Services');
    });

    it('rejects GatewayClass ↔ Service and Route ↔ Route', () => {
        const resources = [gatewayClass('gc-1'), service('s-1'), route('HTTPRoute', 'r-1'), route('TCPRoute', 'r-2')];
        expect(connectResources(resources, 0, 1)).toBeNull();
        expect(connectResources(resources, 2, 3)).toBeNull();
        expect(explainInvalidLink('GatewayClass', 'Service')).toContain('GatewayClass');
        expect(explainInvalidLink('HTTPRoute', 'HTTPRoute')).toContain('no direct relationship');
    });
});

describe('Gateway API family cascade', () => {
    it('deleting any member collects the whole family but never the Service', () => {
        const resources = [
            gatewayClass('gc-1'),
            gateway('gw-1', 'gc-1'),
            gateway('gw-2', 'gc-1'),
            route('HTTPRoute', 'r-1', 'gw-1', ['s-1']),
            route('GRPCRoute', 'r-2', 'gw-2', ['s-1']),
            route('TCPRoute', 'r-3', 'gw-2', ['s-2']),
            service('s-1'),
            service('s-2'),
        ];
        const nodes = nodesOf(resources);

        // Delete the lone GRPCRoute -> whole family goes (classes, both gateways, all routes)
        const r2 = nodes.find((n) => n.data.kind === 'GRPCRoute')!;
        const doomedByRoute = collectGatewayApiFamily(nodes, r2.id);
        expect(doomedByRoute.has(nodes.find((n) => n.data.kind === 'GatewayClass')!.id)).toBe(true);
        expect(doomedByRoute.has(nodes.find((n) => n.data.kind === 'Gateway' && n.data.name === 'gw-2')!.id)).toBe(true);
        expect(doomedByRoute.has(nodes.find((n) => n.data.kind === 'Gateway' && n.data.name === 'gw-1')!.id)).toBe(true);
        expect(doomedByRoute.has(nodes.find((n) => n.data.kind === 'HTTPRoute')!.id)).toBe(true);
        expect(doomedByRoute.size).toBe(6); // class + 2 gateways + 3 routes
        // Services are never collected
        expect(
            nodes
                .filter((n) => n.data.kind === 'Service')
                .some((n) => doomedByRoute.has(n.id))
        ).toBe(false);
    });

    it('deleting a GatewayClass collects its whole family', () => {
        const resources = [
            gatewayClass('gc-1'),
            gatewayClass('gc-other'),
            gateway('gw-1', 'gc-1'),
            gateway('gw-other', 'gc-other'),
            route('HTTPRoute', 'r-1', 'gw-1', ['s-1']),
            service('s-1'),
        ];
        const nodes = nodesOf(resources);
        const gc1 = nodes.find((n) => n.data.kind === 'GatewayClass' && n.data.name === 'gc-1')!;
        const doomed = collectGatewayApiFamily(nodes, gc1.id);
        const idOf = (kind: string, name: string) =>
            nodes.find((n) => n.data.kind === kind && n.data.name === name)!.id;
        expect(doomed.has(idOf('Gateway', 'gw-1'))).toBe(true);
        expect(doomed.has(idOf('HTTPRoute', 'r-1'))).toBe(true);
        expect(doomed.has(idOf('GatewayClass', 'gc-other'))).toBe(false);
        expect(doomed.has(idOf('Gateway', 'gw-other'))).toBe(false);
        expect(doomed.has(idOf('Service', 's-1'))).toBe(false);
    });

    it('non-Gateway-API roots collect nothing (the store adds the root separately)', () => {
        const resources = [service('s-1'), gatewayClass('gc-1'), gateway('gw-1', 'gc-1')];
        const nodes = nodesOf(resources);
        const svcNode = nodes.find((n) => n.data.kind === 'Service')!;
        expect(collectGatewayApiFamily(nodes, svcNode.id).size).toBe(0);
    });

    it('nodeIdFor produces stable Gateway API ids', () => {
        expect(nodeIdFor('GatewayClass', 'gc-1')).toBe('GatewayClass-gc-1');
        expect(nodeIdFor('HTTPRoute', 'r-1')).toBe('HTTPRoute-r-1');
    });
});
