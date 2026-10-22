import { useState } from 'react';
import { GITHUB_URL, IDE_PATH } from '../landingConfig';
import { buildContactMailto, type ContactFormState } from '../utils/contactForm';

type LandingTheme = 'dark' | 'light';

const THEME_KEY = 'kubesketch_landing_theme';

function readTheme(): LandingTheme {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
}

const EMPTY_FORM: ContactFormState = { name: '', email: '', org: '', message: '' };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The landing page, served at "/" (the app itself lives at `/ide` and is
 * opened from here in a new tab). Pure static chrome: no store, no canvas.
 * The IDE URL is derived from the current path so a subpath deployment
 * (e.g. GitHub Pages at /veltra/) keeps working without server config.
 * The theme choice is persisted and also seeds the IDE's theme (see
 * utils/ideTheme.ts).
 */
export default function WelcomeScreen() {
    const base = window.location.pathname.replace(/\/+$/, '');
    const ideUrl = `${base}${IDE_PATH}`;
    const [theme, setTheme] = useState<LandingTheme>(readTheme);
    const [form, setForm] = useState<ContactFormState>(EMPTY_FORM);
    const [errors, setErrors] = useState<Partial<Record<keyof ContactFormState, string>>>({});
    const isLight = theme === 'light';

    const applyTheme = (next: LandingTheme) => {
        setTheme(next);
        localStorage.setItem(THEME_KEY, next);
    };

    const setField = (field: keyof ContactFormState) => (
        e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
    ) => {
        setForm((current) => ({ ...current, [field]: e.target.value }));
        setErrors((current) => ({ ...current, [field]: undefined }));
    };

    const handleContactSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const nextErrors: Partial<Record<keyof ContactFormState, string>> = {};
        if (!form.name.trim()) nextErrors.name = 'Name is required.';
        if (!EMAIL_RE.test(form.email.trim())) nextErrors.email = 'Enter a valid email address.';
        if (!form.message.trim()) nextErrors.message = 'Message is required.';
        setErrors(nextErrors);
        if (nextErrors.name || nextErrors.email || nextErrors.message) return;
        window.open(buildContactMailto(form), '_self');
    };

    return (
        <div className={`welcome${isLight ? ' welcome--light' : ''}`}>
            <div className="welcome__watermark" aria-hidden="true" />

            <nav className="welcome__nav" aria-label="Main">
                <a className="welcome__brand" href="#top" aria-label="Back to top">
                    <img className="welcome__logo" src="/Logo-nobg.png" alt="KubeSketch logo" />
                    <span className="welcome__name">KubeSketch</span>
                </a>
                <div className="welcome__nav-links">
                    <a href="#what-is-kubesketch">What is KubeSketch</a>
                    <a href="#contact">Contact Us</a>
                </div>
                <div className="welcome__nav-actions">
                    <a
                        className="welcome-btn welcome-btn--primary welcome-btn--nav"
                        href={ideUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        Try KubeSketch
                        <ExternalLinkIcon />
                    </a>
                    <a
                        className="welcome__github"
                        href={GITHUB_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="KubeSketch on GitHub"
                    >
                        <GitHubIcon />
                    </a>
                    <div className="welcome__theme" role="group" aria-label="Color theme">
                        <button
                            type="button"
                            className={`welcome__theme-btn${!isLight ? ' welcome__theme-btn--active' : ''}`}
                            onClick={() => applyTheme('dark')}
                            aria-pressed={!isLight}
                            aria-label="Dark mode"
                            title="Dark mode"
                        >
                            <MoonIcon />
                        </button>
                        <button
                            type="button"
                            className={`welcome__theme-btn${isLight ? ' welcome__theme-btn--active' : ''}`}
                            onClick={() => applyTheme('light')}
                            aria-pressed={isLight}
                            aria-label="Light mode"
                            title="Light mode"
                        >
                            <SunIcon />
                        </button>
                    </div>
                </div>
            </nav>

            <main className="welcome__main">
                <section className="welcome__hero" id="top">
                    <h1 className="welcome__title">
                        Design, understand and evolve <em>Kubernetes</em> infrastructure
                        visually.
                    </h1>
                    <p className="welcome__lede">
                        KubeSketch is a Kubernetes Visual IDE. Your YAML manifest stays the
                        single source of truth while a live canvas shows the architecture it
                        describes, including the resources a real cluster would materialize.
                        It is built to make Kubernetes easier to see, learn and reason
                        about.
                    </p>

                    <div className="welcome__actions">
                        <a
                            className="welcome-btn welcome-btn--primary"
                            href={ideUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            Try KubeSketch
                            <ExternalLinkIcon />
                        </a>
                        <a className="welcome-btn welcome-btn--secondary" href="#contact">
                            Want to integrate KubeSketch in your cluster? Contact Us
                        </a>
                    </div>
                </section>

                <section className="welcome__cards-section" aria-label="What KubeSketch offers">
                    <div className="welcome__cards">
                        {CARDS.map((card) => (
                            <article className="welcome__card" key={card.title}>
                                <span className="welcome__card-icon" aria-hidden="true">
                                    {card.icon}
                                </span>
                                <h3 className="welcome__card-title">{card.title}</h3>
                                <p className="welcome__card-text">{card.text}</p>
                            </article>
                        ))}
                    </div>
                </section>

                <section className="welcome__section">
                    <h2 className="welcome__section-title welcome__section-title--md">
                        Works with your favorite Kubernetes flavor
                    </h2>
                    <p className="welcome__section-text">
                        KubeSketch is YAML-native: author and review manifests for any flavor
                        without changing tools. It runs in the browser with no setup.
                    </p>
                    <ul className="welcome__chips">
                        {FLAVORS.map((flavor) => (
                            <li className="welcome__chip" key={flavor.name} title={flavor.name}>
                                <img
                                    className="welcome__chip-logo"
                                    src={flavor.logo}
                                    alt={flavor.name}
                                />
                            </li>
                        ))}
                    </ul>
                </section>

                <section className="welcome__section" id="what-is-kubesketch">
                    <h2 className="welcome__section-title">What is KubeSketch</h2>
                    <p className="welcome__section-text">
                        KubeSketch turns a Kubernetes manifest into a picture you can explore.
                        It simulates the controllers, so a Deployment shows its ReplicaSet
                        and Pods, a CronJob its Job, and the frames show where
                        workloads run: the cluster and the namespaces.
                    </p>
                    <div className="welcome__preview">
                        <PreviewIcon />
                        <span className="welcome__preview-label">Product preview</span>
                    </div>
                </section>

                <section className="welcome__section" id="contact">
                    <h2 className="welcome__section-title">Contact Us</h2>
                    <p className="welcome__section-text">
                        Want to integrate KubeSketch in your cluster? Tell us about your setup
                        and we will get back to you.
                    </p>
                    <form className="welcome__form" onSubmit={handleContactSubmit} noValidate>
                        <div className="welcome__form-field">
                            <label className="welcome__form-label" htmlFor="contact-name">
                                Name
                            </label>
                            <input
                                className={`welcome__form-input${errors.name ? ' welcome__form-input--invalid' : ''}`}
                                id="contact-name"
                                type="text"
                                value={form.name}
                                onChange={setField('name')}
                                placeholder="Jane Doe"
                            />
                            {errors.name && (
                                <span className="welcome__form-error">{errors.name}</span>
                            )}
                        </div>
                        <div className="welcome__form-field">
                            <label className="welcome__form-label" htmlFor="contact-email">
                                Email
                            </label>
                            <input
                                className={`welcome__form-input${errors.email ? ' welcome__form-input--invalid' : ''}`}
                                id="contact-email"
                                type="email"
                                value={form.email}
                                onChange={setField('email')}
                                placeholder="jane@example.com"
                            />
                            {errors.email && (
                                <span className="welcome__form-error">{errors.email}</span>
                            )}
                        </div>
                        <div className="welcome__form-field">
                            <label className="welcome__form-label" htmlFor="contact-org">
                                Organization (optional)
                            </label>
                            <input
                                className="welcome__form-input"
                                id="contact-org"
                                type="text"
                                value={form.org}
                                onChange={setField('org')}
                                placeholder="ACME Corp"
                            />
                        </div>
                        <div className="welcome__form-field">
                            <label className="welcome__form-label" htmlFor="contact-message">
                                Message
                            </label>
                            <textarea
                                className={`welcome__form-textarea${errors.message ? ' welcome__form-input--invalid' : ''}`}
                                id="contact-message"
                                value={form.message}
                                onChange={setField('message')}
                                placeholder="Tell us about your cluster and what you want to build."
                            />
                            {errors.message && (
                                <span className="welcome__form-error">{errors.message}</span>
                            )}
                        </div>
                        <button className="welcome-btn welcome-btn--primary" type="submit">
                            Send
                        </button>
                    </form>
                </section>
            </main>

            <footer className="welcome__footer">
                <div className="welcome__footer-inner">
                    <div className="welcome__footer-brand">
                        <div className="welcome__footer-brand-row">
                            <img
                                className="welcome__footer-logo"
                                src="/Logo-nobg.png"
                                alt="KubeSketch logo"
                            />
                            <span className="welcome__footer-name">KubeSketch</span>
                        </div>
                        <p className="welcome__footer-tag">
                            A Kubernetes Visual IDE. GPL-3.0 licensed, open source on GitHub.
                        </p>
                    </div>
                    <nav className="welcome__footer-col" aria-label="Explore">
                        <span className="welcome__footer-heading">Explore</span>
                        <a href="#what-is-kubesketch">What is KubeSketch</a>
                        <a href="#contact">Contact Us</a>
                        <a href={ideUrl} target="_blank" rel="noopener noreferrer">
                            Open the IDE
                        </a>
                    </nav>
                    <nav className="welcome__footer-col" aria-label="Community">
                        <span className="welcome__footer-heading">Community</span>
                        <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
                            GitHub
                        </a>
                    </nav>
                </div>
                <div className="welcome__footer-bottom">
                    KubeSketch is an independent open source project and is not affiliated with
                    Kubernetes.
                </div>
            </footer>
        </div>
    );
}

const CARDS = [
    {
        title: 'Visual first',
        text: 'See the architecture your manifest describes, without opening a diagram tool.',
        icon: <EyeIcon />,
    },
    {
        title: 'Learn by exploring',
        text: 'Watch a Deployment materialize its ReplicaSet and Pods, a CronJob its Job.',
        icon: <CompassIcon />,
    },
    {
        title: 'Abstraction without drift',
        text: 'The canvas is a projection of the manifest, so what you see always matches what you wrote.',
        icon: <LayersIcon />,
    },
];

const FLAVORS = [
    { name: 'kind', logo: '/flavors/kind.png' },
    { name: 'minikube', logo: '/flavors/minikube.svg' },
    { name: 'AWS', logo: '/flavors/aws.svg' },
    { name: 'Google Cloud', logo: '/flavors/googlecloud.svg' },
    { name: 'Azure', logo: '/flavors/azure.svg' },
];

function EyeIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
        </svg>
    );
}

function CompassIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
        </svg>
    );
}

function LayersIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 2 7 12 12 22 7 12 2" />
            <polyline points="2 17 12 22 22 17" />
            <polyline points="2 12 12 17 22 12" />
        </svg>
    );
}

function PreviewIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="13" rx="2" />
            <path d="M8 21h8" />
            <path d="M12 17v4" />
        </svg>
    );
}

function ExternalLinkIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
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

function GitHubIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 00-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0020 4.77 5.07 5.07 0 0019.91 1S18.73.65 16 2.48a13.38 13.38 0 00-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 005 4.77a5.44 5.44 0 00-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 009 18.13V22" />
        </svg>
    );
}