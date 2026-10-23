import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen as dom, fireEvent, cleanup, within } from '@testing-library/react';
import WelcomeScreen from '../../components/WelcomeScreen';
import { buildContactMailto } from '../../utils/contactForm';

// The landing page is pure static chrome: no store, no @xyflow/react, so no
// mocks are needed here (window.open is stubbed only in the submit test).
// The theme tests re-import the component through vi.resetModules() because
// utils/ideTheme.ts keeps module-level state (applied to <html> at import
// time), exactly like ThemeToggle.test.tsx does.
describe('WelcomeScreen', () => {
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        localStorage.clear();
        document.documentElement.removeAttribute('data-theme');
        vi.resetModules();
    });

    it('renders the brand and a concise introduction', () => {
        render(<WelcomeScreen />);
        const nav = dom.getByRole('navigation', { name: 'Main' });
        expect(within(nav).getByText('KubeSketch')).toBeInTheDocument();
        expect(dom.getByRole('heading', { level: 1 })).toHaveTextContent(
            /Kubernetes infrastructure visually/i
        );
        expect(dom.getByText(/KubeSketch is a Kubernetes Visual IDE/)).toBeInTheDocument();
    });

    it('opens the IDE in a new tab from the hero CTA', () => {
        render(<WelcomeScreen />);
        const main = dom.getByRole('main');
        const cta = within(main).getByRole('link', { name: /try kubesketch/i });
        expect(cta).toHaveAttribute('href', '/ide');
        expect(cta).toHaveAttribute('target', '_blank');
        expect(cta).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('offers Try KubeSketch in the navbar as well', () => {
        render(<WelcomeScreen />);
        const nav = dom.getByRole('navigation', { name: 'Main' });
        const cta = within(nav).getByRole('link', { name: /try kubesketch/i });
        expect(cta).toHaveAttribute('href', '/ide');
        expect(cta).toHaveAttribute('target', '_blank');
    });

    it('renders the three product cards and no longer mentions bidirectional sync', () => {
        render(<WelcomeScreen />);
        expect(dom.getByText('Visual first')).toBeInTheDocument();
        expect(dom.getByText('Learn by exploring')).toBeInTheDocument();
        expect(dom.getByText('Abstraction without drift')).toBeInTheDocument();
        expect(dom.queryByText(/Bidirectional sync/i)).toBeNull();
    });

    it('renders the Kubernetes flavor logo strip', () => {
        render(<WelcomeScreen />);
        expect(
            dom.getByRole('heading', { name: /favorite Kubernetes flavor/i })
        ).toBeInTheDocument();
        for (const flavor of ['kind', 'minikube', 'AWS', 'Google Cloud', 'Azure']) {
            const logo = dom.getByAltText(flavor);
            expect(logo.getAttribute('src')).toMatch(/^\/flavors\//);
        }
    });

    it('does not render the Deployment example box anymore', () => {
        render(<WelcomeScreen />);
        expect(dom.queryByText(/A Deployment in the editor/i)).toBeNull();
    });

    it('does not offer a sample-manifest shortcut anymore', () => {
        render(<WelcomeScreen />);
        expect(dom.queryByRole('link', { name: /load sample manifest/i })).toBeNull();
    });

    it('renders the navbar anchors for What is KubeSketch and Contact Us', () => {
        render(<WelcomeScreen />);
        const nav = dom.getByRole('navigation', { name: 'Main' });
        expect(within(nav).getByRole('link', { name: 'What is KubeSketch' })).toHaveAttribute(
            'href',
            '#what-is-kubesketch'
        );
        expect(within(nav).getByRole('link', { name: 'Contact Us' })).toHaveAttribute(
            'href',
            '#contact'
        );
        expect(within(nav).queryByRole('link', { name: 'About Us' })).toBeNull();
    });

    it('links the cluster-integration CTA to the contact form', () => {
        render(<WelcomeScreen />);
        const cta = dom.getByRole('link', {
            name: /want to integrate kubesketch in your cluster\? contact us/i,
        });
        expect(cta).toHaveAttribute('href', '#contact');
    });

    it('renders the "What is KubeSketch" section with the product preview video', () => {
        render(<WelcomeScreen />);
        expect(dom.getByRole('heading', { name: 'What is KubeSketch' })).toBeInTheDocument();
        const video = dom.getByLabelText('KubeSketch product preview');
        expect(video.getAttribute('src')).toBe('/demo.mp4');
        expect(video).toHaveAttribute('controls');
        expect(dom.queryByAltText(/default manifest/)).toBeNull();
    });

    it('renders the footer link columns', () => {
        render(<WelcomeScreen />);
        const explore = dom.getByRole('navigation', { name: 'Explore' });
        expect(within(explore).getByRole('link', { name: 'What is KubeSketch' })).toHaveAttribute(
            'href',
            '#what-is-kubesketch'
        );
        expect(within(explore).getByRole('link', { name: 'Open the IDE' })).toHaveAttribute(
            'href',
            '/ide'
        );
        const community = dom.getByRole('navigation', { name: 'Community' });
        expect(within(community).getByRole('link', { name: 'GitHub' })).toHaveAttribute(
            'href',
            'https://github.com/AyoubManai01/veltra'
        );
        expect(dom.getByText(/not affiliated with\s+Kubernetes/)).toBeInTheDocument();
    });

    it('renders the contact form fields', () => {
        render(<WelcomeScreen />);
        expect(dom.getByLabelText('Name')).toBeInTheDocument();
        expect(dom.getByLabelText('Email')).toBeInTheDocument();
        expect(dom.getByLabelText('Organization (optional)')).toBeInTheDocument();
        expect(dom.getByLabelText('Message')).toBeInTheDocument();
    });

    it('validates before submitting and opens a prefilled mailto when valid', () => {
        const open = vi.spyOn(window, 'open').mockImplementation(() => null);
        render(<WelcomeScreen />);

        fireEvent.click(dom.getByRole('button', { name: 'Send' }));
        expect(dom.getByText('Name is required.')).toBeInTheDocument();
        expect(dom.getByText('Enter a valid email address.')).toBeInTheDocument();
        expect(open).not.toHaveBeenCalled();

        fireEvent.change(dom.getByLabelText('Name'), { target: { value: 'Jane Doe' } });
        fireEvent.change(dom.getByLabelText('Email'), { target: { value: 'jane@example.com' } });
        fireEvent.change(dom.getByLabelText('Message'), { target: { value: 'Hello' } });
        fireEvent.click(dom.getByRole('button', { name: 'Send' }));

        expect(open).toHaveBeenCalledTimes(1);
        const url = open.mock.calls[0][0] as string;
        expect(url).toMatch(/^mailto:/);
        expect(decodeURIComponent(url)).toContain('Name: Jane Doe');
        expect(decodeURIComponent(url)).toContain('Hello');
    });

    it('builds a mailto URL with the form payload', () => {
        const url = buildContactMailto({
            name: 'Jane Doe',
            email: 'jane@example.com',
            org: 'ACME',
            message: 'Hi there',
        });
        expect(url).toMatch(/^mailto:/);
        const decoded = decodeURIComponent(url);
        expect(decoded).toContain('KubeSketch cluster integration inquiry (ACME)');
        expect(decoded).toContain('Organization: ACME');
    });

    it('defaults to dark mode and switches to light with persistence', async () => {
        vi.resetModules();
        const { default: WelcomeScreen } = await import('../../components/WelcomeScreen');
        render(<WelcomeScreen />);
        expect(document.querySelector('.welcome')).not.toHaveClass('welcome--light');
        expect(dom.getByRole('button', { name: 'Dark mode' })).toHaveAttribute(
            'aria-pressed',
            'true'
        );

        fireEvent.click(dom.getByRole('button', { name: 'Light mode' }));

        expect(document.querySelector('.welcome')).toHaveClass('welcome--light');
        expect(localStorage.getItem('kubesketch_landing_theme')).toBe('light');
        expect(localStorage.getItem('kubesketch_ide_theme')).toBe('light');
        expect(dom.getByRole('button', { name: 'Light mode' })).toHaveAttribute(
            'aria-pressed',
            'true'
        );

        fireEvent.click(dom.getByRole('button', { name: 'Dark mode' }));

        expect(document.querySelector('.welcome')).not.toHaveClass('welcome--light');
        expect(localStorage.getItem('kubesketch_landing_theme')).toBe('dark');
        expect(localStorage.getItem('kubesketch_ide_theme')).toBe('dark');
    });

    it('restores a persisted light theme on mount', async () => {
        localStorage.setItem('kubesketch_landing_theme', 'light');
        vi.resetModules();
        const { default: WelcomeScreen } = await import('../../components/WelcomeScreen');
        render(<WelcomeScreen />);
        expect(document.querySelector('.welcome')).toHaveClass('welcome--light');
        expect(dom.getByRole('button', { name: 'Light mode' })).toHaveAttribute(
            'aria-pressed',
            'true'
        );
    });
});