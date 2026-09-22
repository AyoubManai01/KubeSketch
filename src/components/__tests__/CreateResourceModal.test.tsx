import { describe, it, beforeEach, expect, vi, type Mock } from 'vitest';
import { render, screen as dom, fireEvent } from '@testing-library/react';
import type { K8sResource } from '../../types/types';
import CreateResourceModal from '../CreateResourceModal';
import { createMockNode, resetMockStoreState, setMockStoreState } from './mocks';

// The store is the only real collaborator this component talks to (nodes for
// validation/suggestions, addConfiguredNode to persist) — mock it, use the
// component for real otherwise. The factory dynamically imports './mocks'
// itself since `vi.mock` is hoisted above this file's own static imports.
vi.mock('../../store/store', async () => (await import('./mocks')).storeMockFactory());

function lastCreatedResource(addConfiguredNode: Mock): [string, K8sResource] {
    const call = addConfiguredNode.mock.calls[addConfiguredNode.mock.calls.length - 1];
    return call as unknown as [string, K8sResource];
}

/** Find a <select>/<input> by its visible field label — labels here aren't htmlFor-linked. */
function fieldByLabel(container: HTMLElement, labelText: string): HTMLInputElement | HTMLSelectElement {
    const labels = Array.from(container.querySelectorAll('.modal-field__label'));
    const label = labels.find((el) => (el.textContent ?? '').trim().startsWith(labelText));
    if (!label) throw new Error(`No modal field labeled "${labelText}"`);
    const field = label.closest('.modal-field');
    const input = field?.querySelector('input, select');
    if (!input) throw new Error(`No input/select under field "${labelText}"`);
    return input as HTMLInputElement | HTMLSelectElement;
}

/**
 * Namespaces are never assumed anymore: a namespaced resource must pick, type
 * or create one explicitly, so every create test that reaches the Create button
 * first commits a namespace through the picker.
 */
function pickNamespace(value = 'default') {
    const input = dom.getByPlaceholderText('choose or type a namespace');
    fireEvent.change(input, { target: { value } });
}

describe('CreateResourceModal', () => {
    let onClose: Mock;

    beforeEach(() => {
        resetMockStoreState();
        onClose = vi.fn();
    });

    describe('suggested name generation', () => {
        it('suggests "<kind>-1" when no resource of that kind exists yet', () => {
            render(<CreateResourceModal kind="Deployment" onClose={onClose} />);
            expect(dom.getByPlaceholderText('deployment-1')).toBeInTheDocument();
        });

        it('skips names already taken by resources of the same kind', () => {
            setMockStoreState({
                nodes: [
                    createMockNode({ kind: 'Deployment', name: 'deployment-1' }),
                    createMockNode({ kind: 'Deployment', name: 'deployment-2' }),
                ],
            });
            render(<CreateResourceModal kind="Deployment" onClose={onClose} />);
            expect(dom.getByPlaceholderText('deployment-3')).toBeInTheDocument();
        });

        it('is scoped per kind — a Service named "deployment-1" does not block the Deployment suggestion', () => {
            setMockStoreState({ nodes: [createMockNode({ kind: 'Service', name: 'deployment-1' })] });
            render(<CreateResourceModal kind="Deployment" onClose={onClose} />);
            expect(dom.getByPlaceholderText('deployment-1')).toBeInTheDocument();
        });
    });

    describe('name validation', () => {
        it('shows an inline error and disables Create when the name collides with an existing kind+name pair', () => {
            setMockStoreState({ nodes: [createMockNode({ kind: 'Deployment', name: 'web' })] });
            render(<CreateResourceModal kind="Deployment" onClose={onClose} />);

            fireEvent.change(dom.getByPlaceholderText('deployment-1'), { target: { value: 'web' } });

            expect(dom.getByText('A Deployment named “web” already exists.')).toBeInTheDocument();
            expect(dom.getByRole('button', { name: 'Create Deployment' })).toBeDisabled();
        });

        it('does not collide across kinds — a Service named "web" does not block a Deployment named "web"', () => {
            setMockStoreState({ nodes: [createMockNode({ kind: 'Service', name: 'web' })] });
            render(<CreateResourceModal kind="Deployment" onClose={onClose} />);

            pickNamespace();
            fireEvent.change(dom.getByPlaceholderText('deployment-1'), { target: { value: 'web' } });

            expect(dom.queryByText(/already exists/)).toBeNull();
            expect(dom.getByRole('button', { name: 'Create Deployment' })).toBeEnabled();
        });

        it('blocks Create (and never calls addConfiguredNode/onClose) while the name is a duplicate', () => {
            const addConfiguredNode = vi.fn();
            setMockStoreState({ addConfiguredNode, nodes: [createMockNode({ kind: 'Pod', name: 'p1' })] });
            render(<CreateResourceModal kind="Pod" onClose={onClose} />);

            fireEvent.change(dom.getByPlaceholderText('pod-1'), { target: { value: 'p1' } });
            fireEvent.click(dom.getByRole('button', { name: 'Create Pod' }));

            expect(addConfiguredNode).not.toHaveBeenCalled();
            expect(onClose).not.toHaveBeenCalled();
        });
    });

    describe('namespace selection', () => {
        it('requires a namespace before creating a namespaced resource (no implicit "default")', () => {
            const addConfiguredNode = vi.fn();
            setMockStoreState({ addConfiguredNode });
            render(<CreateResourceModal kind="Deployment" onClose={onClose} />);

            expect(dom.getByText('Choose or create a namespace.')).toBeInTheDocument();
            expect(dom.getByRole('button', { name: 'Create Deployment' })).toBeDisabled();
            fireEvent.click(dom.getByRole('button', { name: 'Create Deployment' }));
            expect(addConfiguredNode).not.toHaveBeenCalled();
            expect(onClose).not.toHaveBeenCalled();
        });

        it('does not offer "default" in the namespace options when nothing references it', () => {
            setMockStoreState({ nodes: [], nsLayout: null });
            render(<CreateResourceModal kind="Deployment" onClose={onClose} />);

            fireEvent.focus(dom.getByPlaceholderText('choose or type a namespace'));
            expect(dom.getByText('No matching namespaces')).toBeInTheDocument();
            expect(dom.queryByText('default')).toBeNull();
        });

        it('uses the typed namespace verbatim on create', () => {
            const addConfiguredNode = vi.fn();
            setMockStoreState({ addConfiguredNode });
            render(<CreateResourceModal kind="Deployment" onClose={onClose} />);

            pickNamespace('team-b');
            fireEvent.click(dom.getByRole('button', { name: 'Create Deployment' }));

            const [, resource] = lastCreatedResource(addConfiguredNode);
            expect(resource.metadata.namespace).toBe('team-b');
        });

        it('the "+ New" button opens the NamespaceModal and auto-selects the created namespace', () => {
            const addConfiguredNode = vi.fn();
            setMockStoreState({ addConfiguredNode });
            render(<CreateResourceModal kind="Deployment" onClose={onClose} />);

            fireEvent.click(dom.getByText('+ New'));
            expect(dom.getByText('New Namespace')).toBeInTheDocument();

            fireEvent.change(dom.getByPlaceholderText('my-namespace'), { target: { value: 'team-b' } });
            fireEvent.click(dom.getByRole('button', { name: 'Create' }));

            expect(dom.queryByText('New Namespace')).toBeNull();
            expect(dom.getByPlaceholderText('choose or type a namespace')).toHaveValue('team-b');
            expect(dom.getByRole('button', { name: 'Create Deployment' })).toBeEnabled();
        });

        it('cluster-scoped kinds (PV/StorageClass) never require a namespace', () => {
            const addConfiguredNode = vi.fn();
            setMockStoreState({ addConfiguredNode });
            render(<CreateResourceModal kind="PersistentVolume" onClose={onClose} />);

            expect(dom.queryByText('Choose or create a namespace.')).toBeNull();
            expect(dom.queryByPlaceholderText('choose or type a namespace')).toBeNull();
            expect(dom.getByRole('button', { name: 'Create PersistentVolume' })).toBeEnabled();
        });
    });

    describe('dismissal', () => {
        it('calls onClose when the overlay backdrop is clicked', () => {
            const { container } = render(<CreateResourceModal kind="Pod" onClose={onClose} />);
            fireEvent.click(container.querySelector('.modal-overlay')!);
            expect(onClose).toHaveBeenCalledTimes(1);
        });

        it('does not call onClose when clicking inside the modal body (click is stopped from bubbling)', () => {
            const { container } = render(<CreateResourceModal kind="Pod" onClose={onClose} />);
            fireEvent.click(container.querySelector('.modal')!);
            expect(onClose).not.toHaveBeenCalled();
        });

        it('calls onClose when Escape is pressed', () => {
            render(<CreateResourceModal kind="Pod" onClose={onClose} />);
            fireEvent.keyDown(document, { key: 'Escape' });
            expect(onClose).toHaveBeenCalledTimes(1);
        });

        it('calls onClose when the header close (×) button is clicked', () => {
            const { container } = render(<CreateResourceModal kind="Pod" onClose={onClose} />);
            fireEvent.click(container.querySelector('.modal-header__close')!);
            expect(onClose).toHaveBeenCalledTimes(1);
        });
    });

    describe('app label auto-generation (workloads/Pods)', () => {
        it('mirrors the Name field until the user edits the App Label field directly', () => {
            render(<CreateResourceModal kind="Deployment" onClose={onClose} />);
            fireEvent.change(dom.getByPlaceholderText('deployment-1'), { target: { value: 'checkout' } });
            expect(dom.getByPlaceholderText('my-app')).toHaveValue('checkout');
        });

        it('stops following the name once the user has typed into the App Label field', () => {
            render(<CreateResourceModal kind="Deployment" onClose={onClose} />);
            const labelInput = dom.getByPlaceholderText('my-app');
            fireEvent.change(labelInput, { target: { value: 'custom-label' } });
            fireEvent.change(dom.getByPlaceholderText('deployment-1'), { target: { value: 'checkout' } });
            expect(labelInput).toHaveValue('custom-label');
        });
    });

    describe('buildResource() per kind, verified via the payload passed to addConfiguredNode', () => {
        it('Deployment: parses replicas, and mirrors the app label into selector + template labels', () => {
            const addConfiguredNode = vi.fn();
            setMockStoreState({ addConfiguredNode });
            render(<CreateResourceModal kind="Deployment" onClose={onClose} />);

            pickNamespace();
            fireEvent.change(dom.getByPlaceholderText('deployment-1'), { target: { value: 'checkout' } });
            fireEvent.change(dom.getByPlaceholderText('3'), { target: { value: '5' } });
            fireEvent.click(dom.getByRole('button', { name: 'Create Deployment' }));

            expect(addConfiguredNode).toHaveBeenCalledWith('Deployment', {
                apiVersion: 'apps/v1',
                kind: 'Deployment',
                metadata: { name: 'checkout', namespace: 'default', labels: { app: 'checkout' } },
                spec: {
                    replicas: 5,
                    selector: { matchLabels: { app: 'checkout' } },
                    template: {
                        metadata: { labels: { app: 'checkout' } },
                        spec: { containers: [{ name: 'app', image: 'nginx:latest' }] },
                    },
                },
            });
            expect(onClose).toHaveBeenCalled();
        });

        it('Deployment/ReplicaSet: falls back to 1 replica when the field is not a finite number', () => {
            const addConfiguredNode = vi.fn();
            setMockStoreState({ addConfiguredNode });
            render(<CreateResourceModal kind="ReplicaSet" onClose={onClose} />);

            pickNamespace();
            fireEvent.change(dom.getByPlaceholderText('3'), { target: { value: 'not-a-number' } });
            fireEvent.click(dom.getByRole('button', { name: 'Create ReplicaSet' }));

            const [, resource] = lastCreatedResource(addConfiguredNode);
            expect((resource.spec as { replicas: number }).replicas).toBe(1);
        });

        it('Pod: uses the given container name/image, defaulting blank fields to app/nginx:latest', () => {
            const addConfiguredNode = vi.fn();
            setMockStoreState({ addConfiguredNode });
            render(<CreateResourceModal kind="Pod" onClose={onClose} />);

            pickNamespace();
            fireEvent.change(dom.getByPlaceholderText('app'), { target: { value: '   ' } });
            fireEvent.change(dom.getByPlaceholderText('nginx:latest'), { target: { value: '   ' } });
            fireEvent.click(dom.getByRole('button', { name: 'Create Pod' }));

            const [, resource] = lastCreatedResource(addConfiguredNode);
            expect((resource.spec as { containers: unknown[] }).containers).toEqual([
                { name: 'app', image: 'nginx:latest' },
            ]);
        });

        it('Service: only includes spec.selector when an app label/target was chosen', () => {
            const addConfiguredNode = vi.fn();
            setMockStoreState({ addConfiguredNode });
            render(<CreateResourceModal kind="Service" onClose={onClose} />);

            pickNamespace();
            fireEvent.click(dom.getByRole('button', { name: 'Create Service' }));

            const [, resource] = lastCreatedResource(addConfiguredNode);
            const spec = resource.spec as { selector?: unknown; ports: unknown[] };
            expect(spec.selector).toBeUndefined();
            expect(spec.ports).toEqual([{ port: 80, targetPort: 8080 }]);
        });

        it('Ingress: omits an empty host and only attaches a backend when a Service is selected', () => {
            const addConfiguredNode = vi.fn();
            setMockStoreState({ addConfiguredNode, nodes: [createMockNode({ kind: 'Service', name: 'checkout-svc' })] });
            render(<CreateResourceModal kind="Ingress" onClose={onClose} />);

            pickNamespace();
            fireEvent.click(dom.getByRole('button', { name: 'Create Ingress' }));

            const [, resource] = lastCreatedResource(addConfiguredNode);
            const rule = (resource.spec as { rules: any[] }).rules[0];
            expect(rule.host).toBeUndefined();
            expect(rule.http.paths[0].backend).toBeUndefined();
            expect(rule.http.paths[0].path).toBe('/');
        });

        it('Service: Service Type and Port are carried into the built resource', () => {
            const addConfiguredNode = vi.fn();
            setMockStoreState({ addConfiguredNode });
            const { container } = render(<CreateResourceModal kind="Service" onClose={onClose} />);

            pickNamespace();
            fireEvent.change(fieldByLabel(container, 'Service Type'), { target: { value: 'NodePort' } });
            fireEvent.change(dom.getByPlaceholderText('80'), { target: { value: '443' } });
            fireEvent.click(dom.getByRole('button', { name: 'Create Service' }));

            const [, resource] = lastCreatedResource(addConfiguredNode);
            const spec = resource.spec as { type: string; ports: Array<{ port: number }> };
            expect(spec.type).toBe('NodePort');
            expect(spec.ports).toEqual([{ port: 443, targetPort: 8080 }]);
        });

        it('Service: "Route to workload" sets spec.selector.app from an existing workload target', () => {
            const addConfiguredNode = vi.fn();
            setMockStoreState({
                addConfiguredNode,
                nodes: [
                    createMockNode({
                        kind: 'Deployment',
                        name: 'checkout',
                        resource: {
                            apiVersion: 'apps/v1',
                            kind: 'Deployment',
                            metadata: { name: 'checkout' },
                            spec: { template: { metadata: { labels: { app: 'checkout' } } } },
                        },
                    }),
                ],
            });
            const { container } = render(<CreateResourceModal kind="Service" onClose={onClose} />);

            pickNamespace();
            fireEvent.change(fieldByLabel(container, 'Route to workload'), { target: { value: 'checkout' } });
            fireEvent.click(dom.getByRole('button', { name: 'Create Service' }));

            const [, resource] = lastCreatedResource(addConfiguredNode);
            expect((resource.spec as { selector?: { app: string } }).selector).toEqual({ app: 'checkout' });
        });

        it('Ingress: Host and Path are carried into the built resource', () => {
            const addConfiguredNode = vi.fn();
            setMockStoreState({ addConfiguredNode });
            const { container } = render(<CreateResourceModal kind="Ingress" onClose={onClose} />);

            pickNamespace();
            fireEvent.change(fieldByLabel(container, 'Host'), { target: { value: 'my-app.example.com' } });
            fireEvent.change(fieldByLabel(container, 'Path'), { target: { value: '/api' } });
            fireEvent.click(dom.getByRole('button', { name: 'Create Ingress' }));

            const [, resource] = lastCreatedResource(addConfiguredNode);
            const rule = (resource.spec as { rules: any[] }).rules[0];
            expect(rule.host).toBe('my-app.example.com');
            expect(rule.http.paths[0].path).toBe('/api');
        });

    });
});
