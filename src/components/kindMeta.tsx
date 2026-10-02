import type { ReactNode } from 'react';

/** Shared kind identity tokens: the accent color, the inline SVG icon and the
 *  hex tint helper used by every kind surface in the app (toolbar, node cards,
 *  inspector, creation modals and the file explorer). Single source of truth:
 *  import from here rather than redefining a per-component copy. */
  export const KIND_COLORS: Record<string, string> = {
    Deployment: "#10b981",
    ReplicaSet: "#f97316",
    Pod: "#14b8a6",
    Service: "#3b82f6",
    Ingress: "#8b5cf6",
    HorizontalPodAutoscaler: "#f59e0b",
    ConfigMap: "#06b6d4",
    PersistentVolumeClaim: "#ec4899",
    PersistentVolume: "#84cc16",
    StorageClass: "#6366f1",
    Secret: "#dc2626",
    Job: "#eab308",
    CronJob: "#d946ef",
    VerticalPodAutoscaler: "#0ea5e9",
    GatewayClass: "#f43f5e",
    Gateway: "#7c3aed",
    HTTPRoute: "#0d9488",
    GRPCRoute: "#65a30d",
    TCPRoute: "#0284c7",
    TLSRoute: "#d97706",
    UDPRoute: "#16a34a",
  };

  export const KIND_ICONS: Record<string, ReactNode> = {
    Deployment: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="2" y="2" width="8" height="8" rx="1.5" />
        <rect x="14" y="2" width="8" height="8" rx="1.5" />
        <rect x="2" y="14" width="8" height="8" rx="1.5" />
        <path d="M6 10v4M10 6h4M14 18h4" strokeDasharray="2 2" />
      </svg>
    ),
    ReplicaSet: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="3" width="10" height="10" rx="2" />
        <rect x="11" y="11" width="10" height="10" rx="2" strokeDasharray="2 2" />
        <path d="M13 8h3v3" strokeDasharray="2 2" />
      </svg>
    ),
    Pod: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    ),
    Service: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20 4h-4a2 2 0 00-2 2v3a2 2 0 002 2h4a2 2 0 002-2V6a2 2 0 00-2-2z" />
        <path d="M8 13H4a2 2 0 00-2 2v3a2 2 0 002 2h4a2 2 0 002-2v-3a2 2 0 00-2-2z" />
        <path d="M9 8v5M15 15v-5M12 5v14" strokeDasharray="2 2" />
      </svg>
    ),
    Ingress: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
      </svg>
    ),
    HorizontalPodAutoscaler: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 20V10M12 6V4" />
        <path d="M12 16l3-3-3-3-3 3 3 3z" />
        <path d="M5 6a7 7 0 0014 0" />
      </svg>
    ),
    ConfigMap: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 6h16v12H4z" />
        <path d="M8 10h8M8 14h5" />
      </svg>
    ),
    PersistentVolumeClaim: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <ellipse cx="12" cy="5" rx="8" ry="3" />
        <path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
        <path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
      </svg>
    ),
    PersistentVolume: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
        <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
      </svg>
    ),
    StorageClass: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="4" width="18" height="6" rx="2" />
        <rect x="3" y="14" width="18" height="6" rx="2" />
        <path d="M7 10v4M17 10v4" strokeDasharray="2 2" />
      </svg>
    ),
    Secret: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path d="M8 11V7a4 4 0 018 0v4" />
        <circle cx="12" cy="15.5" r="1.5" />
      </svg>
    ),
    Job: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M8 2v4M16 2v4M3 9h18" />
        <path d="M9 14l2 2 4-4" />
      </svg>
    ),
    CronJob: (
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
    ),
    VerticalPodAutoscaler: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="4" y="12" width="4" height="8" rx="1" />
        <rect x="10" y="8" width="4" height="12" rx="1" />
        <rect x="16" y="4" width="4" height="16" rx="1" />
        <path d="M5 12V9M11 8V5M17 4V7" strokeDasharray="2 2" />
      </svg>
    ),
    GatewayClass: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 9h18" />
        <circle cx="7" cy="16" r="1" />
        <circle cx="12" cy="16" r="1" />
        <circle cx="17" cy="16" r="1" />
      </svg>
    ),
    Gateway: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 7h18v10H3z" />
        <path d="M8 10h4v4H8z" />
        <path d="M14.5 10h2.5v4h-2.5" />
      </svg>
    ),
    HTTPRoute: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 19V5" />
        <path d="M4 5l16 6-16 6" />
        <path d="M13 5h7v4" />
      </svg>
    ),
    GRPCRoute: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 19V5" />
        <path d="M4 5l16 6-16 6" />
        <path d="M15 4.5l4.5 1.5L15 7.5" />
        <path d="M15 16.5l4.5 1.5-4.5 1.5" />
      </svg>
    ),
    TCPRoute: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 19V5" />
        <path d="M4 5l16 6-16 6" />
        <circle cx="18" cy="18" r="3" />
      </svg>
    ),
    TLSRoute: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 19V5" />
        <path d="M4 5l16 6-16 6" />
        <rect x="14" y="12" width="8" height="6" rx="1" />
        <path d="M16 12v-1a2 2 0 014 0v1" />
      </svg>
    ),
    UDPRoute: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 19V5" />
        <path d="M4 5l16 6-16 6" />
        <circle cx="19" cy="18" r="2" />
        <path d="M19 8v6" strokeDasharray="2 2" />
      </svg>
    ),
  };
export function hexToRgba(hex: string, alpha: number, fallbackRgb = '59,130,246'): string {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return `rgba(${fallbackRgb},${alpha})`;
    return `rgba(${parseInt(result[1], 16)},${parseInt(result[2], 16)},${parseInt(result[3], 16)},${alpha})`;
}
