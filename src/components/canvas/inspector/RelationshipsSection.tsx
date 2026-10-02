import type { InspectorProps } from "./inspectorTypes";

/** The read-only Relationships list of every inferred/owned link touching the selection. */
export function RelationshipsSection(props: InspectorProps) {
  const { setSelectedResource, model } = props;
  return (
    <>
                {/* ── Section: Relationships ───────────────── */}
                {model.relationships.length > 0 && (
                  <div className="inspector-section">
                    <div className="inspector-section__header">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                      Relationships
                      <span className="inspector-section__count">
                        {model.relationships.length}
                      </span>
                    </div>
                    <div className="inspector-section__body">
                      <div className="inspector-rel-list">
                        {model.relationships.map((rel) => (
                          <button
                            key={rel.key}
                            type="button"
                            className="inspector-rel-item inspector-rel-item--link"
                            title={`Select ${rel.kind} ${rel.name}`}
                            onClick={() =>
                              setSelectedResource({
                                kind: rel.kind,
                                name: rel.name,
                              })
                            }
                          >
                            <span
                              className={`inspector-rel-arrow inspector-rel-arrow--${rel.direction}`}
                              title={rel.direction}
                            >
                              {rel.direction === "outgoing" && "↓"}
                              {rel.direction === "incoming" && "↑"}
                              {rel.direction === "owns" && "▣"}
                              {rel.direction === "owned-by" && "◈"}
                            </span>
                            <div className="inspector-rel-info">
                              <span className="inspector-rel-kind">
                                {rel.kind}
                              </span>
                              <span className="inspector-rel-name">
                                {rel.name}
                              </span>
                            </div>
                            {rel.label && (
                              <span className="inspector-rel-badge">
                                {rel.label}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
    </>
  );
}
