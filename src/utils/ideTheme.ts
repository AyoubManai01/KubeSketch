import { useSyncExternalStore } from 'react';

/**
 * IDE color theme (dark by default, like the landing page).
 *
 * Presentation-only state, so it lives outside the resource-model store
 * (same rationale as the panel-split ratio in App.tsx). This module is the
 * SINGLE theme source shared by the landing page ("/") and the IDE ("/ide"):
 * both toggles call `setIdeTheme`, which persists the choice to BOTH
 * `kubesketch_ide_theme` and `kubesketch_landing_theme` so the two pages
 * never disagree, and `readStoredTheme` (IDE key first, landing key as the
 * legacy fallback) resolves any pre-existing divergence on the next toggle.
 * The active theme is mirrored to `data-theme="light|dark"` on <html>
 * (applied synchronously at module load so a persisted light theme never
 * flashes dark), and App mirrors the same value onto the IDE's `.app` root —
 * the element every light selector in styles/theme-light.css is scoped to.
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
    // Keep both keys in sync: the landing page (WelcomeScreen) and the IDE
    // (ThemeToggle) read their respective key, so writing only one of them
    // is what used to let a toggle on "/" be ignored by "/ide" and vice
    // versa. Legacy users may hold divergent keys; the first toggle fixes it.
    localStorage.setItem(IDE_THEME_KEY, theme);
    localStorage.setItem(LANDING_THEME_KEY, theme);
    applyThemeToDom(theme);
    listeners.forEach((listener) => listener());
}

export function useIdeTheme(): IdeTheme {
    return useSyncExternalStore(subscribe, getIdeTheme);
}
