import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen as dom, fireEvent, cleanup } from '@testing-library/react';

// ideTheme.ts keeps module-level state (applied to <html> at import time), so
// each test re-imports the component through vi.resetModules() to get a fresh
// module that re-reads localStorage.
async function renderThemeToggle() {
    const { default: ThemeToggle } = await import('../../components/ThemeToggle');
    render(<ThemeToggle />);
    return ThemeToggle;
}

describe('ThemeToggle', () => {
    afterEach(() => {
        cleanup();
        localStorage.clear();
        document.documentElement.removeAttribute('data-theme');
        vi.resetModules();
    });

    it('defaults to dark mode and switches to light with persistence', async () => {
        await renderThemeToggle();
        expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
        expect(dom.getByRole('button', { name: 'Dark mode' })).toHaveAttribute(
            'aria-pressed',
            'true'
        );

        fireEvent.click(dom.getByRole('button', { name: 'Light mode' }));

        expect(document.documentElement.getAttribute('data-theme')).toBe('light');
        expect(localStorage.getItem('kubesketch_ide_theme')).toBe('light');
        expect(dom.getByRole('button', { name: 'Light mode' })).toHaveAttribute(
            'aria-pressed',
            'true'
        );

        fireEvent.click(dom.getByRole('button', { name: 'Dark mode' }));

        expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
        expect(localStorage.getItem('kubesketch_ide_theme')).toBe('dark');
    });

    it('seeds the theme from the landing preference when no IDE preference exists', async () => {
        localStorage.setItem('kubesketch_landing_theme', 'light');
        await renderThemeToggle();
        expect(document.documentElement.getAttribute('data-theme')).toBe('light');
        expect(dom.getByRole('button', { name: 'Light mode' })).toHaveAttribute(
            'aria-pressed',
            'true'
        );
        // The seeded value is not written back until the user changes it.
        expect(localStorage.getItem('kubesketch_ide_theme')).toBeNull();
    });

    it('restores a persisted IDE light theme on mount', async () => {
        localStorage.setItem('kubesketch_ide_theme', 'light');
        await renderThemeToggle();
        expect(document.documentElement.getAttribute('data-theme')).toBe('light');
        expect(dom.getByRole('button', { name: 'Light mode' })).toHaveAttribute(
            'aria-pressed',
            'true'
        );
    });

    it('prefers the IDE preference over the landing one', async () => {
        localStorage.setItem('kubesketch_landing_theme', 'light');
        localStorage.setItem('kubesketch_ide_theme', 'dark');
        await renderThemeToggle();
        expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
        expect(dom.getByRole('button', { name: 'Dark mode' })).toHaveAttribute(
            'aria-pressed',
            'true'
        );
    });

    it('keeps the landing theme key in sync with the IDE choice', async () => {
        await renderThemeToggle();
        fireEvent.click(dom.getByRole('button', { name: 'Light mode' }));
        expect(localStorage.getItem('kubesketch_ide_theme')).toBe('light');
        expect(localStorage.getItem('kubesketch_landing_theme')).toBe('light');

        fireEvent.click(dom.getByRole('button', { name: 'Dark mode' }));
        expect(localStorage.getItem('kubesketch_ide_theme')).toBe('dark');
        expect(localStorage.getItem('kubesketch_landing_theme')).toBe('dark');
    });
});
