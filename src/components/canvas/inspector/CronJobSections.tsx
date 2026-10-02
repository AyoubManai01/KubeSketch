import { cronScheduleError, toOptionalNumber } from "../inspectorUtils";
import type { InspectorProps } from "./inspectorTypes";

/** CronJob (schedule/job template), its Containers, and Pod Containers sections. */
export function CronJobSections(props: InspectorProps) {
  const { isManaged, draftKind, draftSpec, patchDraft } = props;
  return (
    <>
                {/* ── Section: CronJob (schedule/job template) ── */}
                {!isManaged && draftKind === "CronJob" && (
                  <div className="inspector-section">
                    <div className="inspector-section__header">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 7v5l3 3" />
                        <path d="M12 4v3M12 17v3" />
                      </svg>
                      CronJob
                    </div>
                    <div className="inspector-section__body">
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Schedule
                        </label>
                        <input
                          className={`inspector-field__input ${cronScheduleError(String(draftSpec?.schedule ?? "")) ? "inspector-field__input--invalid" : ""}`}
                          value={String(draftSpec?.schedule ?? "")}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                schedule: e.target.value,
                              },
                            })
                          }
                          placeholder="* * * * *"
                        />
                        <span className="inspector-field__hint">
                          5-field cron (minute hour day month weekday) or an
                          @-descriptor like @hourly.
                        </span>
                        {cronScheduleError(
                          String(draftSpec?.schedule ?? ""),
                        ) && (
                          <span className="inspector-field__error">
                            {cronScheduleError(
                              String(draftSpec?.schedule ?? ""),
                            )}
                          </span>
                        )}
                      </div>
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Restart Policy
                        </label>
                        <select
                          className="inspector-field__input inspector-field__input--select"
                          value={String(
                            draftSpec?.jobTemplate?.spec?.template?.spec
                              ?.restartPolicy ?? "OnFailure",
                          )}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                jobTemplate: {
                                  ...(draftSpec?.jobTemplate ?? {}),
                                  spec: {
                                    ...(draftSpec?.jobTemplate?.spec ?? {}),
                                    template: {
                                      ...(draftSpec?.jobTemplate?.spec
                                        ?.template ?? {}),
                                      spec: {
                                        ...(draftSpec?.jobTemplate?.spec
                                          ?.template?.spec ?? {}),
                                        restartPolicy: e.target.value,
                                      },
                                    },
                                  },
                                },
                              },
                            })
                          }
                        >
                          <option>OnFailure</option>
                          <option>Never</option>
                        </select>
                      </div>
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Parallelism
                        </label>
                        <input
                          className="inspector-field__input"
                          type="number"
                          min={1}
                          value={String(
                            draftSpec?.jobTemplate?.spec?.parallelism ?? "",
                          )}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                jobTemplate: {
                                  ...(draftSpec?.jobTemplate ?? {}),
                                  spec: {
                                    ...(draftSpec?.jobTemplate?.spec ?? {}),
                                    parallelism: toOptionalNumber(
                                      e.target.value,
                                    ),
                                  },
                                },
                              },
                            })
                          }
                          placeholder="1"
                        />
                        <span className="inspector-field__hint">
                          This many Pods run at the same time on each scheduled
                          run.
                        </span>
                      </div>
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Completions
                        </label>
                        <input
                          className="inspector-field__input"
                          type="number"
                          min={1}
                          value={String(
                            draftSpec?.jobTemplate?.spec?.completions ?? "",
                          )}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                jobTemplate: {
                                  ...(draftSpec?.jobTemplate ?? {}),
                                  spec: {
                                    ...(draftSpec?.jobTemplate?.spec ?? {}),
                                    completions: toOptionalNumber(
                                      e.target.value,
                                    ),
                                  },
                                },
                              },
                            })
                          }
                          placeholder="1"
                        />
                        <span className="inspector-field__hint">
                          Total Pods the created Job runs to completion.
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Section: Containers (CronJob) ───────── */}
                {!isManaged && draftKind === "CronJob" && (
                  <div className="inspector-section">
                    <div className="inspector-section__header">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <rect x="2" y="7" width="20" height="14" rx="2" />
                        <path d="M16 7V5a4 4 0 00-8 0v2" />
                      </svg>
                      Containers
                    </div>
                    <div className="inspector-section__body">
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Container Name
                        </label>
                        <input
                          className="inspector-field__input"
                          value={String(
                            draftSpec?.jobTemplate?.spec?.template?.spec
                              ?.containers?.[0]?.name ?? "",
                          )}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                jobTemplate: {
                                  ...(draftSpec?.jobTemplate ?? {}),
                                  spec: {
                                    ...(draftSpec?.jobTemplate?.spec ?? {}),
                                    template: {
                                      ...(draftSpec?.jobTemplate?.spec
                                        ?.template ?? {}),
                                      spec: {
                                        ...(draftSpec?.jobTemplate?.spec
                                          ?.template?.spec ?? {}),
                                        containers: [
                                          {
                                            ...(draftSpec?.jobTemplate?.spec
                                              ?.template?.spec
                                              ?.containers?.[0] ?? {}),
                                            name: e.target.value,
                                          },
                                        ],
                                      },
                                    },
                                  },
                                },
                              },
                            })
                          }
                          placeholder="app"
                        />
                      </div>
                      <div className="inspector-field">
                        <label className="inspector-field__label">Image</label>
                        <input
                          className="inspector-field__input"
                          value={String(
                            draftSpec?.jobTemplate?.spec?.template?.spec
                              ?.containers?.[0]?.image ?? "",
                          )}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                jobTemplate: {
                                  ...(draftSpec?.jobTemplate ?? {}),
                                  spec: {
                                    ...(draftSpec?.jobTemplate?.spec ?? {}),
                                    template: {
                                      ...(draftSpec?.jobTemplate?.spec
                                        ?.template ?? {}),
                                      spec: {
                                        ...(draftSpec?.jobTemplate?.spec
                                          ?.template?.spec ?? {}),
                                        containers: [
                                          {
                                            ...(draftSpec?.jobTemplate?.spec
                                              ?.template?.spec
                                              ?.containers?.[0] ?? {}),
                                            image: e.target.value,
                                          },
                                        ],
                                      },
                                    },
                                  },
                                },
                              },
                            })
                          }
                          placeholder="nginx:latest"
                        />
                      </div>
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Shell command (optional)
                        </label>
                        <input
                          className="inspector-field__input"
                          value={String(
                            draftSpec?.jobTemplate?.spec?.template?.spec
                              ?.containers?.[0]?.args?.[0] ?? "",
                          )}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                jobTemplate: {
                                  ...(draftSpec?.jobTemplate ?? {}),
                                  spec: {
                                    ...(draftSpec?.jobTemplate?.spec ?? {}),
                                    template: {
                                      ...(draftSpec?.jobTemplate?.spec
                                        ?.template ?? {}),
                                      spec: {
                                        ...(draftSpec?.jobTemplate?.spec
                                          ?.template?.spec ?? {}),
                                        containers: [
                                          {
                                            ...(draftSpec?.jobTemplate?.spec
                                              ?.template?.spec
                                              ?.containers?.[0] ?? {}),
                                            command: ["/bin/sh", "-c"],
                                            args: [e.target.value],
                                          },
                                        ],
                                      },
                                    },
                                  },
                                },
                              },
                            })
                          }
                          placeholder="echo hello && date"
                        />
                        <span className="inspector-field__hint">
                          Runs /bin/sh -c &quot;&lt;command&gt;&quot; instead of
                          the image&apos;s default command. Clear to run the
                          image&apos;s default.
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Section: Containers (Pod) ───────────── */}
                {!isManaged && draftKind === "Pod" && (
                  <div className="inspector-section">
                    <div className="inspector-section__header">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <rect x="2" y="7" width="20" height="14" rx="2" />
                        <path d="M16 7V5a4 4 0 00-8 0v2" />
                      </svg>
                      Containers
                    </div>
                    <div className="inspector-section__body">
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Container Name
                        </label>
                        <input
                          className="inspector-field__input"
                          value={String(draftSpec?.containers?.[0]?.name ?? "")}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                containers: [
                                  {
                                    ...(draftSpec?.containers?.[0] ?? {}),
                                    name: e.target.value,
                                  },
                                ],
                              },
                            })
                          }
                          placeholder="app"
                        />
                      </div>
                      <div className="inspector-field">
                        <label className="inspector-field__label">Image</label>
                        <input
                          className="inspector-field__input"
                          value={String(
                            draftSpec?.containers?.[0]?.image ?? "",
                          )}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                containers: [
                                  {
                                    ...(draftSpec?.containers?.[0] ?? {}),
                                    image: e.target.value,
                                  },
                                ],
                              },
                            })
                          }
                          placeholder="nginx:latest"
                        />
                      </div>
                    </div>
                  </div>
                )}
    </>
  );
}
