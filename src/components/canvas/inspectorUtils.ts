/**
 * Convert screen (client) coordinates to flow coordinates. Mirrors React Flow's
 * own screenToFlowPosition: the viewport transform is applied relative to the
 * flow renderer's bounding box, so that offset must be subtracted too.
 */
export function flowPointFromScreen(e: {
  clientX?: number;
  clientY?: number;
}): { x: number; y: number } | null {
  if (typeof e?.clientX !== "number" || typeof e.clientY !== "number")
    return null;
  const renderer = document.querySelector(
    ".react-flow__renderer",
  ) as HTMLElement | null;
  const viewport = document.querySelector(
    ".react-flow__viewport",
  ) as HTMLElement | null;
  if (!renderer || !viewport) return null;
  const bounds = renderer.getBoundingClientRect();
  const m = new DOMMatrixReadOnly(viewport.style.transform);
  return {
    x: (e.clientX - bounds.left - m.e) / m.a,
    y: (e.clientY - bounds.top - m.f) / m.d,
  };
}

export function toOptionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Empty string = valid; otherwise the cron-schedule validation error to show. */
export function cronScheduleError(schedule: string): string {
  const trimmed = schedule.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("@")) return "";
  return trimmed.split(/\s+/).length === 5
    ? ""
    : 'A cron schedule has 5 fields: minute hour day month weekday (e.g. "* * * * *").';
}

export function parseKeyValueString(
  value: string,
): Record<string, string> | undefined {
  if (!value.trim()) return undefined;
  const obj: Record<string, string> = {};
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((pair) => {
      const [k, ...rest] = pair.split("=");
      if (!k || rest.length === 0) return;
      obj[k.trim()] = rest.join("=").trim();
    });
  return Object.keys(obj).length ? obj : undefined;
}

/** Empty string = valid; otherwise the first malformed key=value entry. */
export function keyValueError(value: string): string {
  const tokens = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  for (const token of tokens) {
    const eq = token.indexOf("=");
    if (eq <= 0) {
      return `Invalid entry “${token}”: use key=value pairs separated by commas.`;
    }
    if (!token.slice(0, eq).trim()) {
      return `Invalid entry “${token}”: the key can't be empty.`;
    }
  }
  return "";
}

export function toKeyValueString(value: Record<string, string> | undefined): string {
  if (!value) return "";
  return Object.entries(value)
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
}