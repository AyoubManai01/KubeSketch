import { useSyncExternalStore } from 'react';

/**
 * IDE color theme (dark by default, like the landing page).
 *
 * Presentation-only state, so it lives outside the resource-model store
 * (same rationale as the panel-split ratio in App.tsx). The preference is
 * shared with the landing page: on first visit the IDE seeds its theme from
 * `kubesketch_landing_theme`, then persists its own choice to
 * `kubesketch_ide_theme`. The active theme is mirrored to
 * `data-theme="light|dark"` on <html> (applied synchronously at module load
 * so a persisted light theme never flashes dark), and App mirrors the same
 * value onto the IDE's `.app` root — the element every light selector in
 * styles/theme-light.css is scoped to.
 */
export type IdeTheme = 'dark' | 'light';

const IDE_THEME_KEY = 'kubesketch_ide_theme';
const LANDING_THEME_KEY = 'kubesketch_landing_theme';

function readStoredTheme(): IdeTheme {
    const stored = localStorage.getItem(IDE_THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
    return localStorage.getItem(LANDING_THEME_KEY) === 'light' ? 'light' : 'dark';
}

let currentTheme: IdeTheme = readStoredTheme();
const listeners = new Set<() => void>();

function applyThemeToDom(theme: IdeTheme): void {
    document.documentElement.setAttribute('data-theme', theme);
}

// Applied synchronously at module load (before React renders), so a persisted
// light theme never flashes the dark one on boot.
applyThemeToDom(currentTheme);

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function getIdeTheme(): IdeTheme {
    return currentTheme;
}

export function setIdeTheme(theme: IdeTheme): void {
    if (theme === currentTheme) return;
    currentTheme = theme;
    localStorage.setItem(IDE_THEME_KEY, theme);
    applyThemeToDom(theme);
    listeners.forEach((listener) => listener());
}

export function useIdeTheme(): IdeTheme {
    return useSyncExternalStore(subscribe, getIdeTheme);
}
