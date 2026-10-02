import { describe, it, beforeEach, expect, vi } from 'vitest';
import { render, screen as dom, fireEvent, waitFor } from '@testing-library/react';
import YamlEditor from '../../components/YamlEditor';
import { getFakeMonacoEditor, resetFakeMonaco, resetMockStoreState, setMockStoreState } from './mocks';

// `vi.mock` is hoisted above this file's own static imports, so each factory
// dynamically imports './mocks' itself rather than closing over a statically
// imported reference (which would hit a temporal-dead-zone ReferenceError).
vi.mock('../../store/store', async () => (await import('./mocks')).storeMockFactory());
vi.mock('@monaco-editor/react', async () => (await import('./mocks')).monacoMockFactory());

// A Deployment (with a decoy `name:` nested under spec.template.metadata, which
// must NOT be treated as the resource's identity) followed by a Service,
// exercising both the multi-document split on `---` and the "only the
// top-level metadata block counts" scoping rule.
const MULTI_DOC_YAML = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  labels:
    app: web
spec:
  replicas: 2
  template:
    metadata:
      name: not-the-real-name
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: nginx
---
apiVersion: v1
kind: Service
metadata:
  name: web-svc
spec:
  selector:
    app: web
`;

/** 1-indexed line where the document after the first `---` begins. */
function secondDocStartLine(yaml: string): number {
    const lines = yaml.split('\n');
    return lines.findIndex((l) => l.trim() === '---') + 2;
}

function lastDecorationsCall(): unknown[] {
    const calls = getFakeMonacoEditor().deltaDecorations.mock.calls;
    const [, decorations] = calls[calls.length - 1];
    return decorations;
}

describe('YamlEditor', () => {
    beforeEach(() => {
        resetMockStoreState();
        resetFakeMonaco();
    });

    it('renders the current YAML from the store into the editor', () => {
        setMockStoreState({ yaml: MULTI_DOC_YAML });
        render(<YamlEditor />);
        expect(dom.getByTestId('monaco-editor-mock')).toHaveValue(MULTI_DOC_YAML);
    });

    it('forwards editor changes to setYaml verbatim (no transformation in the component)', () => {
        const setYaml = vi.fn();
        setMockStoreState({ yaml: '', setYaml });
        render(<YamlEditor />);
        fireEvent.change(dom.getByTestId('monaco-editor-mock'), { target: { value: 'kind: Pod' } });
        expect(setYaml).toHaveBeenCalledWith('kind: Pod');
    });

    describe('yamlError banner', () => {
        it('shows neither badge nor banner when yamlError is null', () => {
            setMockStoreState({ yamlError: null });
            render(<YamlEditor />);
            expect(dom.queryByText('Invalid YAML')).toBeNull();
            expect(dom.queryByText('YAML Syntax Error')).toBeNull();
        });

        it('shows the badge and the banner with the message when yamlError is set', () => {
            setMockStoreState({ yamlError: 'bad indentation on line 4' });
            render(<YamlEditor />);
            expect(dom.getByText('Invalid YAML')).toBeInTheDocument();
            expect(dom.getByText('bad indentation on line 4')).toBeInTheDocument();
        });
    });

    describe('selected-resource highlighting', () => {
        it('does nothing when nothing is selected: no decoration call at all', () => {
            setMockStoreState({ yaml: MULTI_DOC_YAML, selectedResource: null });
            render(<YamlEditor />);
            expect(getFakeMonacoEditor().deltaDecorations).not.toHaveBeenCalled();
        });

        it('decorates the matched document and reveals its first line', async () => {
            setMockStoreState({ yaml: MULTI_DOC_YAML, selectedResource: { kind: 'Deployment', name: 'web' } });
            render(<YamlEditor />);
            await waitFor(() => expect(getFakeMonacoEditor().deltaDecorations).toHaveBeenCalled());

            expect(lastDecorationsCall()).toHaveLength(1);
            expect(getFakeMonacoEditor().revealLineInCenter).toHaveBeenCalledWith(1);
        });

        it('matches the second document independently of the first', () => {
            setMockStoreState({ yaml: MULTI_DOC_YAML, selectedResource: { kind: 'Service', name: 'web-svc' } });
            render(<YamlEditor />);
            expect(lastDecorationsCall()).toHaveLength(1);
            expect(getFakeMonacoEditor().revealLineInCenter).toHaveBeenCalledWith(secondDocStartLine(MULTI_DOC_YAML));
        });

        it('ignores a name nested under spec.template.metadata: only the top-level metadata block counts', () => {
            setMockStoreState({
                yaml: MULTI_DOC_YAML,
                selectedResource: { kind: 'Deployment', name: 'not-the-real-name' },
            });
            render(<YamlEditor />);
            expect(lastDecorationsCall()).toHaveLength(0);
        });

        it('ignores a matching kind with a non-matching name (no cross-document confusion)', () => {
            setMockStoreState({ yaml: MULTI_DOC_YAML, selectedResource: { kind: 'Service', name: 'web' } });
            render(<YamlEditor />);
            expect(lastDecorationsCall()).toHaveLength(0);
        });

        it('clears decorations (empty array) when the selected resource is not found in the YAML at all', () => {
            setMockStoreState({ yaml: MULTI_DOC_YAML, selectedResource: { kind: 'Ingress', name: 'missing' } });
            render(<YamlEditor />);
            expect(lastDecorationsCall()).toHaveLength(0);
            expect(getFakeMonacoEditor().revealLineInCenter).not.toHaveBeenCalled();
        });

        it('re-decorates when the selection changes to a different resource', () => {
            setMockStoreState({ yaml: MULTI_DOC_YAML, selectedResource: { kind: 'Deployment', name: 'web' } });
            const { rerender } = render(<YamlEditor />);
            expect(getFakeMonacoEditor().revealLineInCenter).toHaveBeenLastCalledWith(1);

            setMockStoreState({ yaml: MULTI_DOC_YAML, selectedResource: { kind: 'Service', name: 'web-svc' } });
            rerender(<YamlEditor />);
            expect(getFakeMonacoEditor().revealLineInCenter).toHaveBeenLastCalledWith(
                secondDocStartLine(MULTI_DOC_YAML)
            );
        });
    });
});
