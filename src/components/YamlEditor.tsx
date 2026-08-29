import MonacoYaml from './MonacoYaml';
import { useVeltraStore } from '../store/store';

/**
 * Full-manifest Monaco editor: wires the reusable MonacoYaml editor to the
 * store's single YAML source of truth.
 */
export default function YamlEditor({ style }: { style?: React.CSSProperties }) {
    const yaml = useVeltraStore((s) => s.yaml);
    const setYaml = useVeltraStore((s) => s.setYaml);
    const setNotice = useVeltraStore((s) => s.setNotice);
    const yamlError = useVeltraStore((s) => s.yamlError);
    const selectedResource = useVeltraStore((s) => s.selectedResource);

    const handleImport = (file: File) => {
        if (!/\.ya?ml$/i.test(file.name)) {
            setNotice({
                id: Date.now(),
                tone: 'error',
                text: 'Only .yaml and .yml files can be imported.',
            });
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            setYaml(String(reader.result ?? ''));
            setNotice({
                id: Date.now(),
                tone: 'success',
                text: `Imported ${file.name}.`,
            });
        };
        reader.onerror = () => {
            setNotice({
                id: Date.now(),
                tone: 'error',
                text: `Could not read ${file.name}.`,
            });
        };
        reader.readAsText(file);
    };

    const handleExport = () => {
        if (!yaml.trim()) {
            setNotice({
                id: Date.now(),
                tone: 'error',
                text: 'Nothing to export — the editor is empty.',
            });
            return;
        }
        const blob = new Blob([yaml], { type: 'text/yaml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'veltra-manifest.yaml';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    };

    return (
        <MonacoYaml
            value={yaml}
            onChange={setYaml}
            error={yamlError}
            selectedResource={selectedResource}
            title="YAML Editor"
            onImport={handleImport}
            onExport={handleExport}
            style={style}
        />
    );
}