import { toPng, toSvg } from 'html-to-image';
import { getViewportForBounds, type Node, type ReactFlowInstance } from '@xyflow/react';
import { useVeltraStore } from '../store/store';
import type { K8sNodeData } from './buildGraph';

/**
 * The live React Flow instance, registered by Canvas's onInit so the top-navbar
 * export action can reach the flow without a ReactFlowProvider in App.
 *
 * Note: never null this out on unmount — React 19 StrictMode simulates an
 * unmount during development, and React Flow only fires onInit once (it guards
 * with a ref), so a cleanup would leave the holder permanently null in dev.
 */
let rfInstance: ReactFlowInstance<Node<K8sNodeData>> | null = null;

export function setRfInstance(instance: ReactFlowInstance<Node<K8sNodeData>> | null): void {
    rfInstance = instance;
}

/** Exported images use a white background with black text — see the
 *  veltra-export-light class in index.css. The class is applied to the
 *  offscreen render host only, so the live canvas never changes. */
const EXPORT_BACKGROUND = '#ffffff';
const EXPORT_LIGHT_CLASS = 'veltra-export-light';

function triggerDownload(dataUrl: string, filename: string): void {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
}

/**
 * Export the current canvas (nodes, edges, namespace/cluster frames) to a PNG or
 * SVG file.
 *
 * The export is rendered from an offscreen CLONE of the flow's viewport: the
 * light theme (white background / black text / white edge-label pills) and the
 * fit-to-graph transform are applied only to the clone, so the live canvas is
 * never modified — not even for a single frame. If the first snapshot attempt
 * fails (html-to-image commonly trips on embedding cross-origin font CSS), it
 * retries once with font embedding skipped.
 */
export async function exportCanvasImage(format: 'png' | 'svg'): Promise<void> {
    const { nodes, setNotice } = useVeltraStore.getState();
    const fail = (text: string) => setNotice({ id: Date.now(), tone: 'error', text });

    if (nodes.length === 0) {
        fail('Nothing to export — the canvas is empty.');
        return;
    }
    if (!rfInstance) {
        fail('The canvas is not ready yet — try again in a moment.');
        return;
    }
    const viewportEl = document.querySelector<HTMLElement>('.react-flow__viewport');
    if (!viewportEl) {
        fail('The canvas viewport could not be found.');
        return;
    }

    let bounds;
    try {
        bounds = rfInstance.getNodesBounds(nodes);
    } catch {
        fail('Could not compute the graph bounds.');
        return;
    }
    if (bounds.width === 0 || bounds.height === 0) {
        fail('The canvas has no measurable content.');
        return;
    }

    const padding = 0.15;
    const width = Math.ceil(bounds.width * (1 + padding));
    const height = Math.ceil(bounds.height * (1 + padding));
    const viewport = getViewportForBounds(bounds, width, height, 0.5, 2, padding);

    // Offscreen render host: parked at -99999px with opacity 0, so nothing is
    // ever visible while the snapshot runs. Carries the light-theme class and
    // the edge-label variables; the cloned subtree resolves them by inheritance.
    const host = document.createElement('div');
    host.className = `react-flow ${EXPORT_LIGHT_CLASS}`;
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText =
        'position: fixed; left: -99999px; top: 0; width: 0; height: 0; overflow: visible; opacity: 0; pointer-events: none;';

    const clone = viewportEl.cloneNode(true) as HTMLElement;
    clone.style.transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`;
    clone.style.width = `${width}px`;
    clone.style.height = `${height}px`;
    clone.style.position = 'absolute';
    clone.style.left = '0';
    clone.style.top = '0';
    // Edge labels: white pill with black text. The host's CSS variables should
    // take care of this via inheritance, but inline styles make it immune to
    // any computed-style/cascade quirk in the snapshotter.
    clone.querySelectorAll<SVGElement>('.react-flow__edge-textbg').forEach((el) => {
        el.style.fill = '#ffffff';
    });
    clone.querySelectorAll<SVGElement>('.react-flow__edge-text').forEach((el) => {
        el.style.fill = '#000000';
    });
    host.appendChild(clone);
    document.body.appendChild(host);

    try {
        const options = { width, height, backgroundColor: EXPORT_BACKGROUND, pixelRatio: 2 };
        let dataUrl: string;
        try {
            dataUrl =
                format === 'svg'
                    ? await toSvg(clone, options)
                    : await toPng(clone, options);
        } catch {
            dataUrl =
                format === 'svg'
                    ? await toSvg(clone, { ...options, skipFonts: true })
                    : await toPng(clone, { ...options, skipFonts: true });
        }
        triggerDownload(dataUrl, `veltra-graph.${format}`);
    } catch {
        fail(
            `Could not export the canvas as ${format.toUpperCase()} — check the browser console for details.`
        );
    } finally {
        host.remove();
    }
}