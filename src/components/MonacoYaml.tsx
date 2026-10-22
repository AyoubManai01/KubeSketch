import Editor from '@monaco-editor/react';
import { useEffect, useRef } from 'react';
import type { SelectedResource } from '../store/store';
import { useIdeTheme } from '../utils/ideTheme';

interface MonacoYamlProps {
    value: string;
    onChange: (value: string) => void;
    error?: string | null;
    selectedResource?: SelectedResource | null;
    title: string;
    /** When provided, renders an Import button that reads a .yaml file and forwards it. */
    onImport?: (file: File) => void;
    /** When provided, renders an Export button that downloads `value`. */
    onExport?: () => void;
    /** When provided, renders a "Toggle File explorer" button beside Import/Export. */
    onToggleFileExplorer?: () => void;
    /** Pressed state for the file-explorer toggle (stays active until toggled back). */
    fileExplorerActive?: boolean;
    style?: React.CSSProperties;
}

/**
 * Reusable Monaco YAML editor: controlled value, error badge/banner, and a
 * whole-line highlight for the selected resource (scoped to whatever text
 * `value` holds, the full manifest or a single virtual file).
 */
export default function MonacoYaml({
    value,
    onChange,
    error,
    selectedResource,
    title,
    onImport,
    onExport,
    onToggleFileExplorer,
    fileExplorerActive,
    style,
}: MonacoYamlProps) {
    const editorRef = useRef<any>(null);
    const monacoRef = useRef<any>(null);
    const decorationIdsRef = useRef<string[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const ideTheme = useIdeTheme();

    useEffect(() => {
        const editor = editorRef.current;
        const monaco = monacoRef.current;
        if (!editor || !monaco || !selectedResource) return;

        const range = findResourceRange(value, selectedResource.kind, selectedResource.name);
        if (!range) {
            decorationIdsRef.current = editor.deltaDecorations(decorationIdsRef.current, []);
            return;
        }

        const decorationRange = new monaco.Range(range.startLine, 1, range.endLine, 1);

        decorationIdsRef.current = editor.deltaDecorations(decorationIdsRef.current, [
            {
                range: decorationRange,
                options: {
                    isWholeLine: true,
                    className: 'yaml-resource-highlight',
                    linesDecorationsClassName: 'yaml-resource-highlight-gutter',
                },
            },
        ]);
        editor.revealLineInCenter(range.startLine);
    }, [value, selectedResource]);

    return (
        <div className="editor-panel" style={style}>
            <div className="panel-header">
                <div className="panel-header__left">
                    <span className="panel-header__accent" />
                    <span className="panel-header__title" title={title}>
                        {title}
                    </span>
                </div>
                <div className="panel-header__right">
                    {error && (
                        <span className="yaml-error-badge" title={error}>
                            <svg className="yaml-error-badge__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                                <line x1="12" y1="9" x2="12" y2="13" />
                                <line x1="12" y1="17" x2="12.01" y2="17" />
                            </svg>
                            Invalid YAML
                        </span>
                    )}
                    {onImport && (
                        <>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".yaml,.yml"
                                className="yaml-import-input"
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    e.target.value = '';
                                    if (file) onImport(file);
                                }}
                            />
                            <button
                                type="button"
                                className="panel-header__btn"
                                onClick={() => fileInputRef.current?.click()}
                                title="Import a YAML file"
                            >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                                    <polyline points="17 8 12 3 7 8" />
                                    <line x1="12" y1="3" x2="12" y2="15" />
                                </svg>
                                Import
                            </button>
                        </>
                    )}
                    {onExport && (
                        <button
                            type="button"
                            className="panel-header__btn"
                            onClick={onExport}
                            title="Export this YAML as a file"
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                                <polyline points="7 10 12 15 17 10" />
                                <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                            Export
                        </button>
                    )}
                    {onToggleFileExplorer && (
                        <button
                            type="button"
                            className={`panel-header__btn${fileExplorerActive ? " panel-header__btn--active" : ""}`}
                            onClick={onToggleFileExplorer}
                            aria-pressed={fileExplorerActive}
                            title={
                                fileExplorerActive
                                    ? "Toggle back to the full-manifest YAML editor"
                                    : "Toggle the file explorer view"
                            }
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                            </svg>
                            Toggle File explorer
                        </button>
                    )}
                </div>
            </div>
            <div className="editor-content-wrapper">
                <div className="editor-wrapper">
                    <Editor
                        value={value}
                        language="yaml"
                        theme={ideTheme === 'light' ? 'vs' : 'vs-dark'}
                        onMount={(editor, monaco) => {
                            editorRef.current = editor;
                            monacoRef.current = monaco;
                        }}
                        onChange={(next) => onChange(next ?? '')}
                        options={{
                            minimap: { enabled: false },
                            fontSize: 13,
                            fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
                            lineNumbers: 'on',
                            scrollBeyondLastLine: false,
                            wordWrap: 'on',
                            tabSize: 2,
                            automaticLayout: true,
                            padding: { top: 12 },
                            smoothScrolling: true,
                            cursorBlinking: 'smooth',
                            cursorSmoothCaretAnimation: 'on',
                            renderLineHighlight: 'gutter',
                        }}
                    />
                </div>
                {error && (
                    <div className="yaml-error-banner">
                        <div className="yaml-error-banner__header">
                            <svg className="yaml-error-banner__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="10" />
                                <line x1="12" y1="8" x2="12" y2="12" />
                                <line x1="12" y1="16" x2="12.01" y2="16" />
                            </svg>
                            YAML Syntax Error
                        </div>
                        <div className="yaml-error-banner__body">{error}</div>
                    </div>
                )}
            </div>
        </div>
    );
}

function findResourceRange(
    yaml: string,
    kind: string,
    name: string
): { startLine: number; endLine: number } | null {
    const lines = yaml.split('\n');
    let docStart = 1;
    for (let i = 0; i <= lines.length; i += 1) {
        const isBoundary = i === lines.length || lines[i].trim() === '---';
        if (!isBoundary) continue;

        const docEnd = i === lines.length ? lines.length : i;
        const segment = lines.slice(docStart - 1, docEnd);
        const hasKind = segment.some((line) => line.trim() === `kind: ${kind}`);
        if (hasKind && hasMetadataName(segment, name)) {
            return { startLine: docStart, endLine: docEnd };
        }
        docStart = i + 2;
    }
    return null;
}

/**
 * Match `name:` only inside the top-level `metadata:` block so that container
 * names, template metadata, or backend service names never cause a false hit.
 */
function hasMetadataName(segment: string[], name: string): boolean {
    const metadataIdx = segment.findIndex((line) => /^metadata:\s*$/.test(line));
    if (metadataIdx === -1) return false;
    for (let i = metadataIdx + 1; i < segment.length; i += 1) {
        const line = segment[i];
        if (line.trim() && !/^\s/.test(line)) break; // left the metadata block
        const match = line.match(/^\s+name:\s*(.+?)\s*$/);
        if (match && match[1].replace(/^['"]|['"]$/g, '') === name) {
            return true;
        }
    }
    return false;
}