import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FileExplorer from './FileExplorer';
import FileEditor from './FileEditor';
import { useVeltraStore } from '../store/store';
import { buildFileExplorer } from '../utils/fileTree';

const EXPLORER_SPLIT_KEY = 'veltra_explorer_split';
const MIN_EXPLORER = 15;
const MAX_EXPLORER = 50;
const DEFAULT_EXPLORER = 25;

function loadExplorerRatio(): number {
    const saved = Number(localStorage.getItem(EXPLORER_SPLIT_KEY));
    return Number.isFinite(saved) && saved >= MIN_EXPLORER && saved <= MAX_EXPLORER ? saved : DEFAULT_EXPLORER;
}

/**
 * The file-explorer editor pane: an explorer sidebar (resizable) + the scoped
 * Monaco editor for the active file. Replaces the full-manifest editor while
 * file-explorer mode is on.
 */
export default function FileExplorerView({ style }: { style?: React.CSSProperties }) {
    const nodes = useVeltraStore((s) => s.nodes);
    const setActiveFile = useVeltraStore((s) => s.setActiveFile);
    const selectedResource = useVeltraStore((s) => s.selectedResource);

    const [explorerRatio, setExplorerRatio] = useState(loadExplorerRatio);
    const [isResizing, setIsResizing] = useState(false);
    const viewRef = useRef<HTMLDivElement>(null);

    const { tree, fileOf } = useMemo(() => buildFileExplorer(nodes), [nodes]);

    // Canvas selection opens the containing file. Deliberately NOT keyed on
    // `activeFile`: a file click already sets both the active file and the
    // selection (see FileExplorer.openFile), so reacting to the selection alone
    // keeps the two views consistent without ever reverting the user's click.
    useEffect(() => {
        if (!selectedResource) return;
        const path = fileOf.get(`${selectedResource.kind}:${selectedResource.name}`);
        if (path) setActiveFile(path);
    }, [selectedResource, fileOf, setActiveFile]);

    const handleSplitterPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        setIsResizing(true);
    }, []);

    const handleSplitterPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (!viewRef.current || e.buttons === 0) return;
        const rect = viewRef.current.getBoundingClientRect();
        const ratio = ((e.clientX - rect.left) / rect.width) * 100;
        setExplorerRatio(Math.min(MAX_EXPLORER, Math.max(MIN_EXPLORER, ratio)));
    }, []);

    const handleSplitterPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        setIsResizing(false);
        setExplorerRatio((current) => {
            localStorage.setItem(EXPLORER_SPLIT_KEY, String(current));
            return current;
        });
    }, []);

    return (
        <div className={`file-view${isResizing ? ' file-view--resizing' : ''}`} style={style} ref={viewRef}>
            <FileExplorer tree={tree} style={{ width: `${explorerRatio}%`, minWidth: 150 }} />
            <div
                className="panel-splitter"
                onPointerDown={handleSplitterPointerDown}
                onPointerMove={handleSplitterPointerMove}
                onPointerUp={handleSplitterPointerUp}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize file explorer and editor panels"
            />
            <FileEditor style={{ flex: 1, minWidth: 0 }} />
        </div>
    );
}