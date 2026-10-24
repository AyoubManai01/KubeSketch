/**
 * Landing page / IDE route constants. The landing page is served at "/" and
 * the IDE at `/ide`, opened from the landing CTA in a new tab. No router
 * dependency: App.tsx branches on window.location.pathname.
 */
export const IDE_PATH = '/ide';

/** When the IDE opens with `?sample=1`, it preloads the default manifest. */
export const IDE_SAMPLE_PARAM = 'sample';

export const GITHUB_URL = 'https://github.com/AyoubManai01/veltra';

/**
 * True when a request pathname points at the IDE route. Trailing slashes are
 * normalized (static hosts serving ide/index.html often redirect to /ide/)
 * and subpath deployments are honored: `/ide`, `/ide/`, and `/sub/ide`
 * match, while `/`, `/index.html`, and `/xide` do not.
 */
export function isIdePath(pathname: string): boolean {
    const path = pathname.replace(/\/+$/, '');
    return path === IDE_PATH || path.endsWith(IDE_PATH);
}