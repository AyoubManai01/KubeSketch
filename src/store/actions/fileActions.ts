import { parseYaml } from '../../utils/parseYaml';
import { computeFileOf, fileViewOf, resourceKeyOf } from '../../utils/fileTree';
import type { K8sResource } from '../../types/types';
import { ACTIVE_FILE_KEY, FILE_EXPLORER_KEY } from '../constants';
import { clearSavedPositions } from '../persistence';
import { commitResources, toResources } from '../graphCommit';
import type { StoreSetter, VeltraState } from '../types';

export function createFileActions(
    set: StoreSetter
): Pick<VeltraState, 'setFileExplorerMode' | 'setActiveFile' | 'setFileYaml'> {
    return {
        setFileExplorerMode: (on: boolean) => {
            localStorage.setItem(FILE_EXPLORER_KEY, on ? '1' : '0');
            set((state) => {
                if (!on) {
                    return { fileExplorerMode: false, fileYamlError: null };
                }
                const resources = toResources(state.nodes);
                const fileOf = computeFileOf(resources);
                let path = state.activeFile;
                if (path === null || !new Set(fileOf.values()).has(path)) {
                    // Prefer the file containing the selected resource, then the first file.
                    if (state.selectedResource) {
                        path = fileOf.get(`${state.selectedResource.kind}:${state.selectedResource.name}`) ?? null;
                    }
                    if (path === null) path = fileOf.values().next().value ?? null;
                }
                return { fileExplorerMode: true, ...fileViewOf(resources, path), fileYamlError: null };
            });
        },

        setActiveFile: (path: string | null) => {
            localStorage.setItem(ACTIVE_FILE_KEY, path ?? '');
            set((state) => fileViewOf(toResources(state.nodes), path));
        },

        setFileYaml: (path: string, value: string) =>
            set((state) => {
                if (!state.fileExplorerMode || !path) return {};
                let newFileResources: K8sResource[];
                try {
                    newFileResources = parseYaml(value);
                } catch (err: any) {
                    // Scoped version of invariant 9: an invalid file never wipes the
                    // model/canvas; the editor keeps the raw text and shows the error.
                    return { fileYamlError: err.message || String(err) };
                }
                // Remove the resources that currently live in this file, then merge the
                // re-parsed slice back into the single manifest and commit as usual.
                const all = toResources(state.nodes);
                const fileOf = computeFileOf(all);
                const rest = all.filter((r) => fileOf.get(resourceKeyOf(r)) !== path);
                // Resources newly added through the file editor get fresh placement,
                // never a stale pin from a previously deleted resource (see setYaml).
                const liveKeys = new Set(state.nodes.map((n) => `${n.data.kind}:${n.data.name}`));
                clearSavedPositions(
                    newFileResources
                        .map((r) => `${r.kind}:${r.metadata?.name}`)
                        .filter((key) => !liveKeys.has(key))
                );
                const result = commitResources(state, [...rest, ...newFileResources], state.nodes);
                // Keep the raw typed text in the editor (commitResources re-serializes
                // the canonical form; the user's formatting wins while typing).
                result.activeFileText = value;
                result.fileYamlError = null;
                return result;
            }),
    };
}
