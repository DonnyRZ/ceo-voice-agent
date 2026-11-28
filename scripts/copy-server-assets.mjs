import { cp, mkdir } from 'node:fs/promises';

const destination = new URL('../build/backend/modules/mail/assets/', import.meta.url);
await mkdir(destination, { recursive: true });
await cp(new URL('../backend/modules/mail/assets/', import.meta.url), destination, { recursive: true });
