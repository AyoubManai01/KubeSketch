import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Without `test.globals: true` in vite.config.ts, React Testing Library's
// automatic afterEach(cleanup) registration never fires (it detects `afterEach`
// as an ambient global, which we deliberately don't enable). Do it explicitly
// so each test unmounts its render() instead of accumulating DOM across a file.
afterEach(() => {
    cleanup();
});
