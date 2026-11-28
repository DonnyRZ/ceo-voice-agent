import { fileURLToPath } from 'node:url';
import { mergeConfig } from 'vite';
import application from './vite.config.ts';

// Keep dependency optimization independent of the functional E2E dev server.
export default mergeConfig(application, {
  cacheDir: fileURLToPath(new URL('node_modules/.vite-ui-audit/', import.meta.url)),
});
