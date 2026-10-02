import { useState } from 'react';
import { useVeltraStore } from '../store/store';
import type { FileNode } from '../utils/fileTree';
import { KIND_COLORS } from './kindMeta';

const FolderIcon = ({ open }: { open: boolean }) =>
    open ? (
        <svg className="file-tree__icon file-tree__icon--folder" viewBox="0 0 24 24" fill="currentColor">
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
        </svg>
    ) : (
        <svg className="file-tree__icon file-tree__icon--folder" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
        </svg>
    );

const FileIcon = () => (
    <svg className="file-tree__icon file-tree__icon--file" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
    </svg>
);

const ChevronIcon = ({ open }: { open: boolean }) => (
    <svg className={`file-tree__chevron${open ? ' file-tree__chevron--open' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 18 15 12 9 6" />
    </svg>
);

interface FileExplorerProps {
    tree: FileNode;
    style?: React.CSSProperties;
}

/**
 * VSCode-style file tree: folders + files derived from the single manifest.
 * Clicking a file opens it in the scoped editor (store `activeFile`) and selects
 * its primary resource on the canvas (so the two views stay in sync both ways).
 */
export default function FileExplorer({ tree, style }: FileExplorerProps) {
    const activeFile = useVeltraStore((s) => s.activeFile);
    const setActiveFile = useVeltraStore((s) => s.setActiveFile);
    const setSelectedResource = useVeltraStore((s) => s.setSelectedResource);
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

    const toggle = (path: string) =>
        setCollapsed((prev) => {
            const next = new Set(prev);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
        });

    const openFile = (node: FileNode) => {
        setActiveFile(node.path);
        const primary = node.resources?.[0];
        if (primary) setSelectedResource({ kind: primary.kind, name: primary.name });
    };

    return (
        <div className="file-explorer" style={style}>
            <div className="panel-header">
                <div className="panel-header__left">
                    <span className="panel-header__accent" />
                    <span className="panel-header__title">Explorer</span>
                </div>
            </div>
            <div className="file-tree">
                {tree.children?.length ? (
                    tree.children.map((child) => (
                        <TreeNode
                            key={child.path}
                            node={child}
                            depth={0}
                            collapsed={collapsed}
                            onToggle={toggle}
                            activeFile={activeFile}
                            onOpen={openFile}
                        />
                    ))
                ) : (
                    <div className="file-explorer__empty">No resources yet</div>
                )}
            </div>
        </div>
    );
}

function TreeNode({
    node,
    depth,
    collapsed,
    onToggle,
    activeFile,
    onOpen,
}: {
    node: FileNode;
    depth: number;
    collapsed: Set<string>;
    onToggle: (path: string) => void;
    activeFile: string | null;
    onOpen: (node: FileNode) => void;
}) {
    const isOpen = !collapsed.has(node.path);
    const indent = { paddingLeft: 8 + depth * 14 };

    if (node.type === 'folder') {
        return (
            <>
                <button
                    type="button"
                    className="file-tree__row file-tree__row--folder"
                    style={indent}
                    onClick={() => onToggle(node.path)}
                    title={node.path}
                >
                    <ChevronIcon open={isOpen} />
                    <FolderIcon open={isOpen} />
                    <span className="file-tree__label">{node.name}</span>
                    {!!node.count && <span className="file-tree__count">{node.count}</span>}
                </button>
                {isOpen &&
                    node.children?.map((child) => (
                        <TreeNode
                            key={child.path}
                            node={child}
                            depth={depth + 1}
                            collapsed={collapsed}
                            onToggle={onToggle}
                            activeFile={activeFile}
                            onOpen={onOpen}
                        />
                    ))}
            </>
        );
    }

    const color = KIND_COLORS[node.resources?.[0]?.kind ?? ''] ?? '#8b949e';
    return (
        <button
            type="button"
            className={`file-tree__row file-tree__row--file${node.path === activeFile ? ' file-tree__row--active' : ''}`}
            style={indent}
            onClick={() => onOpen(node)}
            title={node.path}
        >
            <FileIcon />
            <span className="file-tree__label" style={{ color }}>
                {node.name}
            </span>
            {(node.resources?.length ?? 0) > 1 && (
                <span className="file-tree__count">{node.resources?.length}</span>
            )}
        </button>
    );
}
