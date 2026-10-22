import { setIdeTheme, useIdeTheme } from '../utils/ideTheme';

/**
 * Moon/sun two-button theme switch for the IDE navbar, mirroring the
 * landing page's `.welcome__theme` group. The preference is shared with the
 * landing page through `useIdeTheme` (see utils/ideTheme.ts).
 */
export default function ThemeToggle() {
    const theme = useIdeTheme();
    const isLight = theme === 'light';

    return (
        <div className="toolbar__theme" role="group" aria-label="Color theme">
            <button
                type="button"
                className={`toolbar__theme-btn${!isLight ? ' toolbar__theme-btn--active' : ''}`}
                onClick={() => setIdeTheme('dark')}
                aria-pressed={!isLight}
                aria-label="Dark mode"
                title="Dark mode"
            >
                <MoonIcon />
            </button>
            <button
                type="button"
                className={`toolbar__theme-btn${isLight ? ' toolbar__theme-btn--active' : ''}`}
                onClick={() => setIdeTheme('light')}
                aria-pressed={isLight}
                aria-label="Light mode"
                title="Light mode"
            >
                <SunIcon />
            </button>
        </div>
    );
}

function SunIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2" />
            <path d="M12 20v2" />
            <path d="M4.93 4.93l1.41 1.41" />
            <path d="M17.66 17.66l1.41 1.41" />
            <path d="M2 12h2" />
            <path d="M20 12h2" />
            <path d="M4.93 19.07l1.41-1.41" />
            <path d="M17.66 6.34l1.41-1.41" />
        </svg>
    );
}

function MoonIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
        </svg>
    );
}
