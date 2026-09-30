/** Exercise the actual distributable, never source aliases or demo imports. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import ts from 'typescript';
import { setupDOM } from '../helpers/dom.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const temp = await mkdtemp(join(tmpdir(), 'bpmn-xyflow-consumer-'));
const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const fixtureNames = ['core.ts', 'react.tsx', 'vue.ts', 'svelte.ts'];

function checkTypes(files, resolution) {
  const program = ts.createProgram(files.map(file => join(temp, file)), {
    strict: true,
    noEmit: true,
    skipLibCheck: false,
    target: ts.ScriptTarget.ES2022,
    module: resolution === 'NodeNext' ? ts.ModuleKind.NodeNext : ts.ModuleKind.ESNext,
    moduleResolution: resolution === 'NodeNext' ? ts.ModuleResolutionKind.NodeNext : ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    types: []
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => temp,
    getCanonicalFileName: file => file,
    getNewLine: () => '\n'
  }));
  console.log(`PASS packed consumer TypeScript (${resolution}): ${files.join(', ')}`);
  return program;
}

function declaredProperties(program, name) {
  const source = program.getSourceFile(join(temp, 'node_modules/bpmn-xyflow/types/index.d.ts'));
  const declaration = source.statements.find(statement => ts.isInterfaceDeclaration(statement) && statement.name?.text === name);
  assert.ok(declaration, `missing ${name} interface declaration`);
  const checker = program.getTypeChecker();
  return checker.getPropertiesOfType(checker.getTypeAtLocation(declaration)).map(property => property.name).sort();
}

try {
  const packed = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temp], { cwd: root, encoding: 'utf8', env: { ...process.env, npm_config_cache: join(temp, '.npm-cache') } }))[0];
  const modules = join(temp, 'node_modules');
  const packageRoot = join(modules, 'bpmn-xyflow');
  await mkdir(packageRoot, { recursive: true });
  execFileSync('tar', ['-xzf', join(temp, packed.filename), '--strip-components=1', '-C', packageRoot]);
  await writeFile(join(temp, 'package.json'), JSON.stringify({ name: 'bpmn-xyflow-consumer-smoke', private: true, type: 'module' }));
  for (const name of fixtureNames) {
    await writeFile(join(temp, name), await readFile(join(root, 'test/package/fixtures', name)));
  }
  for (const name of ['index', 'react', 'vue', 'svelte', 'svelte-component', 'wrappers']) {
    assert.ok(packed.files.some(file => file.path === `types/${name}.d.ts`), `missing packed declaration: ${name}`);
  }
  // No framework or runtime dependencies are installed yet. Root declarations
  // must compile in this empty consumer, including with skipLibCheck disabled.
  const rootProgram = checkTypes(['core.ts'], 'Bundler');
  checkTypes(['core.ts'], 'NodeNext');
  assert.ok(!rootProgram.getSourceFiles().some(file => /node_modules\/(?:@types\/)?(?:react|vue|svelte)(?:\/|$)/.test(file.fileName)), 'root declarations pulled in framework types');
  // Reuse already-installed dependencies; this smoke neither downloads nor publishes.
  for (const name of Object.keys({ ...metadata.dependencies, ...metadata.peerDependencies, '@types/react': '', '@types/react-dom': '' })) {
    const destination = join(modules, name);
    await mkdir(dirname(destination), { recursive: true });
    await symlink(join(root, 'node_modules', name), destination, 'dir');
  }
  checkTypes(fixtureNames, 'Bundler');
  checkTypes(fixtureNames, 'NodeNext');
  const entries = {
    root: `export { default, Viewer, Modeler, Renderer, CommandStack, parseBpmnXML, buildGraph } from 'bpmn-xyflow';`,
    react: `export { default, BpmnViewer, useBpmnViewer } from 'bpmn-xyflow/lib/react';`,
    vue: `export { default, BpmnViewer } from 'bpmn-xyflow/lib/vue';`,
    svelte: `export { default, BpmnViewer } from 'bpmn-xyflow/lib/svelte'; export { default as DirectBpmnViewer } from 'bpmn-xyflow/lib/svelte/BpmnViewer.svelte';`
  };
  for (const [name, source] of Object.entries(entries)) {
    const entry = join(temp, `${name}.js`);
    await writeFile(entry, source);
    const result = await build({
      configFile: false,
      root: temp,
      logLevel: 'error',
      plugins: name === 'svelte' ? [svelte({ configFile: false })] : [],
      build: { write: false, minify: false, lib: { entry, formats: ['es'] }, rolldownOptions: { output: { codeSplitting: false } } }
    });
    const outputs = (Array.isArray(result) ? result : [result]).flatMap(item => item.output);
    const chunk = outputs.find(item => item.type === 'chunk' && item.isEntry);
    assert.ok(chunk?.code.length > 100, `${name}: missing bundled entry`);
    console.log(`PASS packed consumer Vite bundle: ${name}`);
    if (name === 'root') {
      for (const peer of Object.keys(metadata.peerDependencies)) {
        assert.ok(!chunk.moduleIds.some(id => id.includes(`/node_modules/${peer}/`) || id.includes(`/.pnpm/${peer.replace('/', '+')}@`)), `root bundle unexpectedly requires optional peer ${peer}`);
      }
      // Execute the bundle made from the extracted tarball, not a source import.
      const bundleFile = join(temp, 'packed-core.mjs');
      await writeFile(bundleFile, chunk.code);
      const dom = await setupDOM();
      try {
        const api = await import(pathToFileURL(bundleFile).href);
        const viewer = new api.Viewer({ container: dom.createContainer(), fitViewOnInit: false });
        const modeler = new api.Modeler({ container: dom.createContainer(), fitViewOnInit: false, palette: false });
        try {
          for (const [className, instance] of [['Viewer', viewer], ['Modeler', modeler]]) {
            assert.deepEqual(Object.keys(instance).filter(key => !key.startsWith('_')).sort(), declaredProperties(rootProgram, className), `${className}: declared surface differs from runtime`);
          }
          const xml = await readFile(join(root, 'test/fixtures/bpmn/basic.bpmn'), 'utf8');
          const imported = await modeler.importXML(xml);
          assert.ok(imported.graph.nodes.length > 0);
          const nodes = [
            modeler.addShape('bpmn:Task', { x: 400, y: 400 }),
            modeler.addShape('bpmn:Task', { x: 600, y: 430 }),
            modeler.addShape('bpmn:Task', { x: 900, y: 450 })
          ];
          assert.ok(nodes.every(Boolean));
          modeler.updateLabel(nodes[0], 'Packed consumer task');
          assert.equal(modeler.findElements('packed consumer')[0], nodes[0]);
          assert.equal(modeler.focusElement(nodes[0].id), true);
          modeler.align(nodes, 'top');
          assert.equal(new Set(nodes.map(node => node.y)).size, 1);
          modeler.distribute(nodes, 'horizontal');
          assert.equal(nodes[1].x - nodes[0].x, nodes[2].x - nodes[1].x);
          const before = nodes.map(node => node.x);
          modeler.createSpace(nodes, 'horizontal', nodes[1].x - 1, 40, { direction: 'e' });
          assert.deepEqual(nodes.map(node => node.x), [before[0], before[1] + 40, before[2] + 40]);
          modeler.undo();
          assert.deepEqual(nodes.map(node => node.x), before);
          modeler.redo();
          assert.match((await modeler.saveSVG()).svg, /<svg/);
          await viewer.importXML(await modeler.getXML());
          assert.equal(viewer.findElements('packed consumer').length, 1);
          console.log('PASS packed consumer DOM runtime: import, model, align, distribute, space, search, SVG/XML, undo/redo');
        } finally {
          viewer.destroy();
          modeler.destroy();
        }
      } finally {
        await dom.cleanup();
      }
    }
  }
  console.log(`PASS package contents: ${packed.filename} (${packed.files.length} files)`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
