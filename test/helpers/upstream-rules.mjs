import { build } from 'vite';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export async function loadUpstreamRules() {
  const directory = await mkdtemp(join(tmpdir(), 'bpmn-rules-oracle-'));
  try {
    const result = await build({
      configFile: false,
      logLevel: 'silent',
      ssr: { noExternal: true },
      build: { write: false, ssr: resolve('node_modules/bpmn-js/lib/features/rules/BpmnRules.js'), minify: false }
    });
    const entry = result.output.find(item => item.type === 'chunk' && item.isEntry);
    const path = join(directory, 'rules.mjs');
    await writeFile(path, entry.code);
    return (await import(pathToFileURL(path).href)).default.prototype;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
