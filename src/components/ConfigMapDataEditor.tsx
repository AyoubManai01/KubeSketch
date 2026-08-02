import { useState } from 'react';
import type { K8sResource } from '../types/types';

interface Row {
    id: number;
    key: string;
    value: string;
}

interface EditorModel {
    rows: Row[];
    seq: number;
}

/** Snapshot the resource's `data` map as editable rows with unique ids. */
function initModel(resource: K8sResource): EditorModel {
    const data = (resource.data ?? {}) as Record<string, unknown>;
    const rows: Row[] = [];
    let seq = 0;
    Object.entries(data).forEach(([key, value]) => {
        rows.push({
            id: ++seq,
            key,
            value: typeof value === 'string' ? value : String(value ?? ''),
        });
    });
    return { rows, seq };
}

/**
 * Live key/value editor for a ConfigMap's `data` map.
 * Holds a local row list (synced when a different resource is selected), commits
 * the whole map through `onCommit` on every edit so the canvas/YAML stay live.
 * Rows with an empty key are dropped; an empty map is committed as `undefined`
 * (omitted from YAML).
 */
export default function ConfigMapDataEditor({
    resource,
    resetToken,
    onCommit,
}: {
    resource: K8sResource;
    /** Changes whenever a different resource is selected — resets the rows. */
    resetToken: string;
    onCommit: (data: Record<string, string> | undefined) => void;
}) {
    const [model, setModel] = useState<EditorModel>(() => initModel(resource));
    const [lastToken, setLastToken] = useState(resetToken);

    if (lastToken !== resetToken) {
        setLastToken(resetToken);
        setModel(initModel(resource));
    }

    const emit = (rows: Row[]) => {
        const data = Object.fromEntries(
            rows
                .map((row) => [row.key.trim(), row.value])
                .filter(([key]) => (key as string).length > 0)
        );
        onCommit(Object.keys(data).length ? data : undefined);
    };

    const updateRow = (id: number, patch: Partial<{ key: string; value: string }>) => {
        const next = model.rows.map((row) => (row.id === id ? { ...row, ...patch } : row));
        setModel((m) => ({ ...m, rows: next }));
        emit(next);
    };

    const removeRow = (id: number) => {
        const next = model.rows.filter((row) => row.id !== id);
        setModel((m) => ({ ...m, rows: next }));
        emit(next);
    };

    const addRow = () => {
        setModel((m) => ({
            seq: m.seq + 1,
            rows: [...m.rows, { id: m.seq + 1, key: '', value: '' }],
        }));
    };

    return (
        <div className="k8s-keyval-editor">
            {model.rows.length === 0 && (
                <span className="modal-field__hint">
                    No data entries yet — add keys to make this ConfigMap injectable
                    via envFrom / env / volumes.
                </span>
            )}
            {model.rows.map((row) => (
                <div key={row.id} className="k8s-keyval-row">
                    <input
                        className="k8s-keyval-row__input k8s-keyval-row__key"
                        value={row.key}
                        onChange={(e) => updateRow(row.id, { key: e.target.value })}
                        placeholder="key"
                    />
                    <textarea
                        className="k8s-keyval-row__input k8s-keyval-row__value"
                        value={row.value}
                        onChange={(e) => updateRow(row.id, { value: e.target.value })}
                        placeholder="value"
                        rows={2}
                    />
                    <button
                        type="button"
                        className="k8s-keyval-row__remove"
                        onClick={() => removeRow(row.id)}
                        title="Remove entry"
                    >
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            width="12"
                            height="12"
                        >
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>
            ))}
            <button type="button" className="k8s-keyval-add" onClick={addRow}>
                + Add entry
            </button>
        </div>
    );
}
