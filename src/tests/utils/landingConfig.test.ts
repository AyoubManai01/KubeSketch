import { describe, it, expect } from 'vitest';
import { IDE_PATH, isIdePath } from '../../landingConfig';

describe('landingConfig routing', () => {
    it('exposes the IDE route path', () => {
        expect(IDE_PATH).toBe('/ide');
    });

    it('matches the IDE route with and without trailing slashes', () => {
        expect(isIdePath('/ide')).toBe(true);
        expect(isIdePath('/ide/')).toBe(true);
        expect(isIdePath('/ide//')).toBe(true);
    });

    it('matches the IDE route under a subpath deployment', () => {
        expect(isIdePath('/veltra/ide')).toBe(true);
        expect(isIdePath('/veltra/ide/')).toBe(true);
    });

    it('does not match the landing page or lookalike paths', () => {
        expect(isIdePath('/')).toBe(false);
        expect(isIdePath('')).toBe(false);
        expect(isIdePath('/index.html')).toBe(false);
        expect(isIdePath('/xide')).toBe(false);
        expect(isIdePath('/ideas')).toBe(false);
    });
});
