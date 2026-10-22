import MonacoYaml from './MonacoYaml';
import { useKubeSketchStore } from '../store/store';

/**
 * Scoped editor for the active virtual file: a projection of the single
 * manifest. Edits commit only the file's slice back into the model via
 * `setFileYaml` (through the same commitResources path as every other edit).
 */
export default function FileEditor({ style }: { style?: React.CSSProperties }) {
    const activeFile = useKubeSketchStore((s) => s.activeFile);
    const activeFileText = useKubeSketchStore((s) => s.activeFileText);
    const setFileYaml = useKubeSketchStore((s) => s.setFileYaml);
    const fileYamlError = useKubeSketchStore((s) => s.fileYamlError);
    const selectedResource = useKubeSketchStore((s) => s.selectedResource);
    const setNotice = useKubeSketchStore((s) => s.setNotice);
    const fileExplorerMode = useKubeSketchStore((s) => s.fileExplorerMode);
    const setFileExplorerMode = useKubeSketchStore((s) => s.setFileExplorerMode);

    const handleExport = () => {
        if (!activeFileText.trim()) {
            setNotice({
                id: Date.now(),
                tone: 'error',
                text: 'Nothing to export, this file is empty.',
            });
            return;
        }
        const blob = new Blob([activeFileText], { type: 'text/yaml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (activeFile ?? 'manifest.yaml').split('/').pop() ?? 'manifest.yaml';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    };

    return (
        <MonacoYaml
            value={activeFileText}
            onChange={(value) => setFileYaml(activeFile ?? '', value)}
            error={fileYamlError}
            selectedResource={selectedResource}
            title={activeFile ?? 'No file selected'}
            onExport={handleExport}
            onToggleFileExplorer={() => setFileExplorerMode(!fileExplorerMode)}
            fileExplorerActive={fileExplorerMode}
            style={style}
        />
    );
}