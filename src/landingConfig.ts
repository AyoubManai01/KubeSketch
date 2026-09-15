/**
 * Landing page / IDE route constants. The landing page is served at "/" and
 * the IDE at `/ide`, opened from the landing CTA in a new tab. No router
 * dependency: App.tsx branches on window.location.pathname.
 */
export const IDE_PATH = '/ide';

/** When the IDE opens with `?sample=1`, it preloads the default manifest. */
export const IDE_SAMPLE_PARAM = 'sample';

export const GITHUB_URL = 'https://github.com/AyoubManai01/veltra';