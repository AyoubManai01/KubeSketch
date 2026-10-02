import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen as dom } from '@testing-library/react';
import type { NodeProps } from '@xyflow/react';
import K8sNode from '../../components/K8sNode';
import type { K8sNodeData } from '../../utils/buildGraph';

// K8sNode only touches Handle/Position from @xyflow/react (no store dependency),
// so this is the only collaborator that needs isolating. `vi.mock` is hoisted
// above every import in this file, so the factory dynamically imports './mocks'
// itself rather than closing over a statically-imported reference (which would
// hit a temporal-dead-zone ReferenceError under hoisting).
vi.mock('@xyflow/react', async () => (await import('./mocks')).xyflowMockFactory());

function renderNode(overrides: Partial<K8sNodeData>) {
    const nodeData: K8sNodeData = {
        kind: 'Pod',
        name: 'demo-pod',
        namespace: 'default',
        resource: { apiVersion: 'v1', kind: 'Pod', metadata: { name: 'demo-pod' }, spec: {} },
        ...overrides,
    };
    const props = { data: nodeData } as unknown as NodeProps;
    return render(React.createElement(K8sNode, props));
}

describe('K8sNode', () => {
    it('renders the kind label and resource name in the header', () => {
        renderNode({ kind: 'Deployment', name: 'checkout-api' });
        expect(dom.getByText('Deployment')).toBeInTheDocument();
        expect(dom.getByText('checkout-api')).toBeInTheDocument();
    });

    it('applies the kind-specific CSS class and the leaf layout for non-container kinds', () => {
        const { container } = renderNode({ kind: 'Service', name: 'svc' });
        const root = container.querySelector('.k8s-node');
        expect(root).toHaveClass('k8s-node--service');
        expect(root).toHaveClass('k8s-node--leaf');
        expect(root).not.toHaveClass('k8s-node--container');
    });

    describe('container kinds (Deployment / ReplicaSet)', () => {
        it('renders as a container with no body, so replica badges are the only content shown', () => {
            const { container } = renderNode({
                kind: 'Deployment',
                name: 'web',
                resource: {
                    apiVersion: 'apps/v1',
                    kind: 'Deployment',
                    metadata: { name: 'web' },
                    spec: { replicas: 4 },
                },
            });
            const root = container.querySelector('.k8s-node');
            expect(root).toHaveClass('k8s-node--container');
            expect(container.querySelector('.k8s-node__body')).toBeNull();
            expect(dom.getByText('4 Replicas')).toBeInTheDocument();
        });

        it('shows the ReplicaSet pod-count badge in the ×N format', () => {
            renderNode({
                kind: 'ReplicaSet',
                name: 'web-abcde',
                resource: {
                    apiVersion: 'apps/v1',
                    kind: 'ReplicaSet',
                    metadata: { name: 'web-abcde' },
                    spec: { replicas: 3 },
                },
            });
            expect(dom.getByText('×3 Pods')).toBeInTheDocument();
        });

        it('omits the replica badge when spec.replicas is not a number', () => {
            renderNode({
                kind: 'Deployment',
                name: 'web',
                resource: { apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: 'web' }, spec: {} },
            });
            expect(dom.queryByText(/Replicas/)).toBeNull();
        });
    });

    describe('synthetic / managed badge', () => {
        it('shows "auto" with a tooltip naming the owner when synthetic AND managedBy are both set', () => {
            renderNode({
                kind: 'Pod',
                name: 'web-abcde-xyz12',
                synthetic: true,
                managedBy: { kind: 'ReplicaSet', name: 'web-abcde' },
            });
            const badge = dom.getByText('auto');
            expect(badge).toHaveAttribute(
                'title',
                'Created automatically by ReplicaSet web-abcde (like a real cluster)'
            );
        });

        it('hides the badge for a synthetic node with no managedBy (defensive branch)', () => {
            renderNode({ kind: 'Pod', name: 'orphan', synthetic: true, managedBy: undefined });
            expect(dom.queryByText('auto')).toBeNull();
        });

        it('hides the badge for a non-synthetic node even if managedBy happened to be set', () => {
            renderNode({
                kind: 'Pod',
                name: 'real-pod',
                synthetic: false,
                managedBy: { kind: 'ReplicaSet', name: 'x' },
            });
            expect(dom.queryByText('auto')).toBeNull();
        });

        it('applies the k8s-node--managed CSS class only for synthetic nodes', () => {
            const managed = renderNode({ kind: 'Pod', name: 'p', synthetic: true });
            expect(managed.container.querySelector('.k8s-node')).toHaveClass('k8s-node--managed');

            const real = renderNode({ kind: 'Pod', name: 'p2', synthetic: false });
            expect(real.container.querySelector('.k8s-node')).not.toHaveClass('k8s-node--managed');
        });
    });

    describe('Pod body details', () => {
        it('renders the container name and shortens a fully-qualified image to its last path segment', () => {
            renderNode({
                kind: 'Pod',
                name: 'demo-pod',
                resource: {
                    apiVersion: 'v1',
                    kind: 'Pod',
                    metadata: { name: 'demo-pod' },
                    spec: { containers: [{ name: 'app', image: 'docker.io/library/nginx:latest' }] },
                },
            });
            expect(dom.getByText('app')).toBeInTheDocument();
            expect(dom.getByText('nginx:latest')).toBeInTheDocument();
        });

        it('omits container/image rows entirely when the pod has no containers', () => {
            renderNode({
                kind: 'Pod',
                name: 'demo-pod',
                resource: { apiVersion: 'v1', kind: 'Pod', metadata: { name: 'demo-pod' }, spec: {} },
            });
            expect(dom.queryByText('container:')).toBeNull();
            expect(dom.queryByText('image:')).toBeNull();
        });
    });

    describe('Service body details', () => {
        it('formats "port -> targetPort" when both are set', () => {
            renderNode({
                kind: 'Service',
                name: 'svc',
                resource: {
                    apiVersion: 'v1',
                    kind: 'Service',
                    metadata: { name: 'svc' },
                    spec: { type: 'ClusterIP', ports: [{ port: 80, targetPort: 8080 }] },
                },
            });
            expect(dom.getByText('80 -> 8080')).toBeInTheDocument();
            expect(dom.getByText('ClusterIP')).toBeInTheDocument();
        });

        it('formats just the port when targetPort is absent', () => {
            renderNode({
                kind: 'Service',
                name: 'svc',
                resource: {
                    apiVersion: 'v1',
                    kind: 'Service',
                    metadata: { name: 'svc' },
                    spec: { ports: [{ port: 80 }] },
                },
            });
            expect(dom.getByText('80')).toBeInTheDocument();
        });
    });

    describe('Ingress body details', () => {
        it('renders host and path rows when both are present on the first rule', () => {
            renderNode({
                kind: 'Ingress',
                name: 'ing',
                resource: {
                    apiVersion: 'networking.k8s.io/v1',
                    kind: 'Ingress',
                    metadata: { name: 'ing' },
                    spec: { rules: [{ host: 'app.example.com', http: { paths: [{ path: '/api' }] } }] },
                },
            });
            expect(dom.getByText('app.example.com')).toBeInTheDocument();
            expect(dom.getByText('/api')).toBeInTheDocument();
        });

        it('omits the host row when the rule has no host, while still showing the path', () => {
            renderNode({
                kind: 'Ingress',
                name: 'ing',
                resource: {
                    apiVersion: 'networking.k8s.io/v1',
                    kind: 'Ingress',
                    metadata: { name: 'ing' },
                    spec: { rules: [{ http: { paths: [{ path: '/' }] } }] },
                },
            });
            expect(dom.queryByText('host:')).toBeNull();
            expect(dom.getByText('/')).toBeInTheDocument();
        });
    });

    it('renders a target handle on top and a source handle on bottom for drag-to-connect', () => {
        renderNode({ kind: 'Pod', name: 'demo-pod' });
        expect(dom.getByTestId('handle-target-top')).toBeInTheDocument();
        expect(dom.getByTestId('handle-source-bottom')).toBeInTheDocument();
    });

    it('falls back to the default color/icon for an unrecognized kind instead of throwing', () => {
        // KIND_COLORS[kind] ?? '#8b949e' and ICONS[kind] ?? ICONS.Pod are both defensive
        // lookups: an unknown kind must still render, not crash the canvas.
        const { container } = renderNode({ kind: 'CustomResource' as unknown as K8sNodeData['kind'], name: 'x' });
        expect(container.querySelector('.k8s-node--customresource')).toBeInTheDocument();
    });
});
