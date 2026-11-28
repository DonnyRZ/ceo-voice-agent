import { readdirSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { transformSync } from 'esbuild';

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = directory + '/' + entry.name;
    return entry.isDirectory() ? files(path) : /\.[jt]sx?$/.test(path) ? [path] : [];
  });
}

test('seluruh frontend bebas indikator loading teks bertitik', () => {
  const violations = [];
  for (const path of files('frontend/src')) {
    // Parse TS/JSX with the project's existing compiler before inspecting emitted
    // string literals; object spread syntax is not visible loading copy.
    const { code } = transformSync(readFileSync(path, 'utf8'), {
      loader: path.endsWith('x') ? 'tsx' : 'ts', jsx: 'automatic', charset: 'utf8',
    });
    for (const match of code.matchAll(/"(?:[^"\\]|\\.)*"/g)) {
      const text = match[0];
      if (/…|\.{3}/.test(text) && /memuat|memeriksa|memverifikasi|menyimpan|mengirim|memproses|mengaktifkan|menyiapkan|membuka|sedang (masuk|keluar)|loading/i.test(text)) {
        violations.push(path);
      }
    }
  }
  assert.deepEqual(violations, [], 'Indikator loading lama masih ada');
});
