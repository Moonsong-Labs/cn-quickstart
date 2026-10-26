import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config/env';

test('PORT defaults to 8081 and rejects values Bun would otherwise bind', () => {
  expect(loadConfig({}).port).toBe(8081);
  expect(loadConfig({ PORT: '8082' }).port).toBe(8082);

  for (const port of ['', 'abc', '8081x', '0', '1.5', '70000']) {
    expect(() => loadConfig({ PORT: port })).toThrow('PORT must be an integer between 1 and 65535');
  }
});

test('API docs follow NODE_ENV unless API_DOCS_ENABLED is set', () => {
  expect(loadConfig({}).apiDocsEnabled).toBe(true);
  expect(loadConfig({ NODE_ENV: 'production' }).apiDocsEnabled).toBe(false);
  expect(loadConfig({ NODE_ENV: 'production', API_DOCS_ENABLED: 'true' }).apiDocsEnabled).toBe(
    true,
  );
  expect(loadConfig({ API_DOCS_ENABLED: 'false' }).apiDocsEnabled).toBe(false);
  expect(loadConfig({ API_DOCS_ENABLED: 'TRUE' }).apiDocsEnabled).toBe(false);
});

// `bun build` inlines `process.env.NODE_ENV`. This fails if that folds the docs check to `true`.
test('bundle reads NODE_ENV at runtime', async () => {
  const outdir = await mkdtemp(join(tmpdir(), 'backend-env-'));
  try {
    const built = await Bun.build({
      entrypoints: [new URL('../src/config/env.ts', import.meta.url).pathname],
      target: 'bun',
      outdir,
    });

    expect(built.success).toBe(true);
    const js = await built.outputs.find((output) => output.kind === 'entry-point')?.text();
    expect(js).toContain('NODE_ENV !== "production"');
    expect(js).not.toContain('process.env.NODE_ENV');
  } finally {
    await rm(outdir, { recursive: true, force: true });
  }
});
