import Editor from '@monaco-editor/react';
import { useEffect, useRef } from 'react';
import { useVeltraStore } from '../store/store';

/**
 * Monaco Editor configured for YAML editing.
 * Updates the Zustand store on every change, triggering re-parse.
 */
export default function YamlEditor() {
    const yaml = useVeltraStore((s) => s.yaml);
    const setYaml = useVeltraStore((s) => s.setYaml);
    const selectedResource = useVeltraStore((s) => s.selectedResource);
    const editorRef = useRef<any>(null);
    const monacoRef = useRef<any>(null);
    const decorationIdsRef = useRef<string[]>([]);

    useEffect(() => {
        const editor = editorRef.current;
        const monaco = monacoRef.current;
        if (!editor || !monaco || !selectedResource) return;

        const range = findResourceRange(yaml, selectedResource.kind, selectedResource.name);
        if (!range) {
            decorationIdsRef.current = editor.deltaDecorations(
                decorationIdsRef.current,
                []
            );
            return;
        }

        const decorationRange = new monaco.Range(
            range.startLine,
            1,
            range.endLine,
            1
        );

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
    }, [yaml, selectedResource]);

    return (
        <div className="editor-panel">
            <div className="panel-header">
                <span className="panel-header__accent" />
                <span className="panel-header__title">YAML Editor</span>
            </div>
            <div className="editor-wrapper">
                <Editor
                    value={yaml}
                    language="yaml"
                    theme="vs-dark"
                    onMount={(editor, monaco) => {
                        editorRef.current = editor;
                        monacoRef.current = monaco;
                    }}
                    onChange={(value) => setYaml(value ?? '')}
                    options={{
                        minimap: { enabled: false },
                        fontSize: 14,
                        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
                        lineNumbers: 'on',
                        scrollBeyondLastLine: false,
                        wordWrap: 'on',
                        tabSize: 2,
                        automaticLayout: true,
                        padding: { top: 16 },
                        smoothScrolling: true,
                        cursorBlinking: 'smooth',
                        cursorSmoothCaretAnimation: 'on',
                        renderLineHighlight: 'gutter',
                    }}
                />
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
        const hasName = segment.some((line) => line.trim() === `name: ${name}`);
        if (hasKind && hasName) {
            return { startLine: docStart, endLine: docEnd };
        }
        docStart = i + 2;
    }
    return null;
}
