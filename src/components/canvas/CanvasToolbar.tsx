import { Fragment, useEffect, useRef, useState } from "react";
import { SUPPORTED_KINDS, type SupportedKind } from "../../types/types";
import { isGatewayApiKind } from "../../utils/buildGraph";
import { useVeltraStore } from "../../store/store";

/** Presentational kind groups for the canvas toolbar (left → right). */
const RESOURCE_GROUPS: { label: string; kinds: SupportedKind[] }[] = [
  "Workload",
  "Network",
  "Storage",
  "Configuration",
].map((label) => ({
  label,
  kinds: SUPPORTED_KINDS.filter(
    (kind) => !isGatewayApiKind(kind) && kindGroupLabelLocal(kind) === label,
  ),
}));

function kindGroupLabelLocal(kind: string): string {
  if (
    kind === "Deployment" ||
    kind === "Pod" ||
    kind === "ReplicaSet" ||
    kind === "HorizontalPodAutoscaler" ||
    kind === "VerticalPodAutoscaler" ||
    kind === "Job" ||
    kind === "CronJob"
  ) {
    return "Workload";
  }
  if (kind === "Service" || kind === "Ingress") {
    return "Network";
  }
  if (
    kind === "PersistentVolume" ||
    kind === "PersistentVolumeClaim" ||
    kind === "StorageClass"
  ) {
    return "Storage";
  }
  if (kind === "ConfigMap" || kind === "Secret") {
    return "Configuration";
  }
  return "Other";
}

interface Props {
  setPendingKind: (kind: SupportedKind | null) => void;
  setGatewayApiModalOpen: (open: boolean) => void;
  setNamespaceModalOpen: (open: boolean) => void;
}

/** Quick Actions toolbar: resource-group buttons, the Gateway API entry with
 *  its dropdown, and the namespace-editing mode toggle. */
export function CanvasToolbar({
  setPendingKind,
  setGatewayApiModalOpen,
  setNamespaceModalOpen,
}: Props) {
  const nsEditMode = useVeltraStore((s) => s.nsEditMode);
  const setNsEditMode = useVeltraStore((s) => s.setNsEditMode);

  const [gatewayApiDropdownOpen, setGatewayApiDropdownOpen] = useState(false);
  const [gaDropdownPos, setGaDropdownPos] = useState({ top: 0, left: 0 });
  const gaEntryRef = useRef<HTMLDivElement>(null);
  const gaDropdownRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollNav, setScrollNav] = useState({ left: false, right: false });

  // Which scroll directions are available for the resource row: gates the
  // ‹ › nav buttons and keeps them in sync with resize/scroll/content changes.
  const updateScrollNav = () => {
    const el = scrollRef.current;
    if (!el) return;
    setScrollNav({
      left: el.scrollLeft > 1,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
    });
  };

  useEffect(() => {
    updateScrollNav();
    const el = scrollRef.current;
    if (!el) return;
    // jsdom (tests) has no ResizeObserver; the nav state still initializes
    // correctly and updates from the scroll event.
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateScrollNav);
      return () => window.removeEventListener("resize", updateScrollNav);
    }
    const observer = new ResizeObserver(updateScrollNav);
    observer.observe(el);
    window.addEventListener("resize", updateScrollNav);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateScrollNav);
    };
  }, []);

  const scrollResourceRow = (dir: 1 | -1) => {
    scrollRef.current?.scrollBy({ left: dir * 320, behavior: "smooth" });
  };

  // Close the Gateway API dropdown on any outside pointerdown. The dropdown is
  // rendered outside the scrollable row (so the toolbar's overflow can't clip
  // it), so both the entry and the dropdown itself count as "inside".
  useEffect(() => {
    if (!gatewayApiDropdownOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (gaEntryRef.current?.contains(target)) return;
      if (gaDropdownRef.current?.contains(target)) return;
      setGatewayApiDropdownOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [gatewayApiDropdownOpen]);

  // Anchor the dropdown under the entry. The toolbar forms the containing
  // block (position: relative), so coordinates are computed relative to it:
  // getBoundingClientRect() viewport coords are converted by subtracting the
  // toolbar's own rect. The dropdown is clamped to the toolbar's width so it
  // never spills past the right edge (the entry can be scrolled far right).
  const toggleGatewayApiDropdown = () => {
    const next = !gatewayApiDropdownOpen;
    if (next) {
      const entry = gaEntryRef.current;
      const toolbar = entry?.closest(".canvas-toolbar");
      if (entry && toolbar) {
        const entryRect = entry.getBoundingClientRect();
        const toolbarRect = toolbar.getBoundingClientRect();
        setGaDropdownPos({
          top: entryRect.bottom - toolbarRect.top + 6,
          left: Math.min(
            entryRect.left - toolbarRect.left,
            Math.max(8, toolbarRect.width - 206),
          ),
        });
      }
    }
    setGatewayApiDropdownOpen(next);
  };

  return (
    <div className="canvas-toolbar">
      <div className="canvas-toolbar__group canvas-toolbar__group--grow">
        <div
          className="canvas-toolbar__scroll"
          ref={scrollRef}
          onScroll={() => {
            setGatewayApiDropdownOpen(false);
            updateScrollNav();
          }}
        >
          {RESOURCE_GROUPS.map((group, gi) => (
            <Fragment key={group.label}>
              {gi > 0 && (
                <span
                  className="canvas-toolbar__group-divider"
                  aria-hidden="true"
                />
              )}
              <span className="canvas-toolbar__group-label">
                {group.label}
              </span>
              {group.kinds.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className="canvas-button"
                  onClick={() => {
                    setGatewayApiModalOpen(false);
                    setPendingKind(kind);
                  }}
                  title={`Add ${kind} resource`}
                >
                  + {kind}
                </button>
              ))}
              {group.label === "Network" && (
                <div className="canvas-toolbar__ga-entry" ref={gaEntryRef}>
                  <button
                    type="button"
                    className="canvas-button"
                    onClick={() => {
                      setGatewayApiDropdownOpen(false);
                      setPendingKind(null);
                      setGatewayApiModalOpen(true);
                    }}
                    title="Create a GatewayClass, Gateway and Routes in one flow"
                  >
                    + Gateway API
                  </button>
                  <button
                    type="button"
                    className={`canvas-button canvas-button--chevron ${
                      gatewayApiDropdownOpen
                        ? "canvas-button--chevron--open"
                        : ""
                    }`}
                    onClick={toggleGatewayApiDropdown}
                    title="Reveal the Gateway API resources (GatewayClass, Gateway, routes)"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      width="12"
                      height="12"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                </div>
              )}
            </Fragment>
          ))}
        </div>
        <div className="canvas-toolbar__scroll-nav">
          <button
            type="button"
            className="canvas-button canvas-button--scroll"
            onClick={() => scrollResourceRow(-1)}
            disabled={!scrollNav.left}
            title="Scroll the resource list left"
            aria-label="Scroll the resource list left"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              width="11"
              height="11"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button
            type="button"
            className="canvas-button canvas-button--scroll"
            onClick={() => scrollResourceRow(1)}
            disabled={!scrollNav.right}
            title="Scroll the resource list right"
            aria-label="Scroll the resource list right"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              width="11"
              height="11"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
        {gatewayApiDropdownOpen && (
          <div
            className="canvas-toolbar__dropdown"
            ref={gaDropdownRef}
            style={{ top: gaDropdownPos.top, left: gaDropdownPos.left }}
          >
            {SUPPORTED_KINDS.filter((kind) => isGatewayApiKind(kind)).map(
              (kind) => (
                <button
                  key={kind}
                  type="button"
                  className="canvas-button canvas-toolbar__dropdown-item"
                  onClick={() => {
                    setGatewayApiDropdownOpen(false);
                    setGatewayApiModalOpen(false);
                    setPendingKind(kind);
                  }}
                  title={`Add ${kind} resource`}
                >
                  + {kind}
                </button>
              ),
            )}
          </div>
        )}
      </div>
      <div className="canvas-toolbar__group canvas-toolbar__group--pinned">
        {nsEditMode && (
          <button
            type="button"
            className="canvas-button"
            onClick={() => setNamespaceModalOpen(true)}
            title="Add an empty namespace rectangle to the cluster"
          >
            + Namespace
          </button>
        )}
        <button
          type="button"
          className={`canvas-button canvas-button--nsmode${nsEditMode ? " canvas-button--active" : ""}`}
          onClick={() => setNsEditMode(!nsEditMode)}
          title={
            nsEditMode
              ? "Exit namespace editing mode (layout is saved)"
              : "Enter namespace editing mode to drag, resize and add namespace boxes"
          }
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="8" height="8" rx="1.5" />
            <rect x="13" y="3" width="8" height="8" rx="1.5" />
            <rect x="3" y="13" width="8" height="8" rx="1.5" />
            <rect x="13" y="13" width="8" height="8" rx="1.5" />
          </svg>
          {nsEditMode ? "Done" : "Namespaces"}
        </button>
      </div>
    </div>
  );
}