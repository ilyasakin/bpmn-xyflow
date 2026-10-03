import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';

const require = createRequire(import.meta.url), upstream = createRequire(require.resolve('bpmn-js/package.json'));
const localSource = await readFile('lib/upstream/diagram-js/Text.js', 'utf8');
const referenceSource = await readFile(upstream.resolve('diagram-js/lib/util/Text.js'), 'utf8');
function measurementFunction(source) {
  const start = source.indexOf('function getTextBBox('), end = source.indexOf('\n}\n', start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end + 2);
}
function measure(source, input) {
  const calls = [], context = { measureText(text) { calls.push(text); return { width: text.length * 6, fontBoundingBoxAscent: 10, fontBoundingBoxDescent: 3 }; } };
  // Execute the actual retained function, isolating only the browser canvas.
  const getBBox = new Function('getCanvasContext', 'buildFont', 'buildLength', `${measurementFunction(source)}; return getTextBBox;`)(() => context, () => '12px sans-serif', value => value);
  return { bounds: getBBox(input, {}), calls };
}

test('actual text measurement preserves empty-line dummy and all ECMAScript trailing whitespace semantics', () => {
  const whitespace = [9,10,11,12,13,32,160,0x1680,...Array.from({length:11},(_,i)=>0x2000+i),0x2028,0x2029,0x202f,0x205f,0x3000,0xfeff].map(value => String.fromCharCode(value));
  const keep = ['\u0085','\u180e','\u200b','\u2060','\ud800','😀'];
  const cases = ['', ' ', '  label  ', 'label\r\n', ...whitespace.flatMap(w => [w, 'name'+w.repeat(32), w.repeat(32)+'X', ' A'+w+'B'+w]), ...keep.flatMap(w => ['label'+w, 'label'+w+'  '])];
  for (const value of cases) assert.deepEqual(measure(localSource, value), measure(referenceSource, value), JSON.stringify(value));
  assert.deepEqual(measure(localSource, ''), { bounds: { width: 0, height: 13 }, calls: ['dummy'] });
  assert.deepEqual(measure(localSource, '   ').calls, ['']);
  for (const value of keep) assert.deepEqual(measure(localSource, 'label'+value+'  ').calls, ['label'+value]);
});

test('adversarial whitespace plus non-whitespace completes in an isolated bounded worker', async () => {
  // A regressed regex cannot block this runner: terminate only this worker at
  // the bound. No quadratic upstream expression runs on these large inputs.
  const result = await new Promise((resolve, reject) => {
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      const calls = [];
      const context = { measureText(text) { calls.push({ length:text.length, first:text[0], last:text.at(-1) }); return { width:text.length, fontBoundingBoxAscent:10, fontBoundingBoxDescent:3 }; } };
      const getBBox = new Function('getCanvasContext','buildFont','buildLength', workerData+';return getTextBBox;')(() => context, () => '12px sans-serif', value => value);
      const size = 2 ** 20;
      for (const value of [' '.repeat(size)+'X', '\\t'.repeat(size)+'X', 'label'+' '.repeat(size)]) getBBox(value, {});
      parentPort.postMessage(calls);
    `, { eval: true, workerData: measurementFunction(localSource), resourceLimits: { maxOldGenerationSizeMb: 48 } });
    let settled = false;
    const timer = setTimeout(() => { settled = true; worker.terminate().then(() => reject(new Error('Text measurement exceeded the 3-second isolated bound'))); }, 3000);
    worker.once('message', value => { settled = true; clearTimeout(timer); worker.terminate().then(() => resolve(value)); });
    worker.once('error', error => { settled = true; clearTimeout(timer); reject(error); });
    worker.once('exit', code => { if (!settled) { clearTimeout(timer); reject(new Error(`Text measurement exited without results (${code})`)); } });
  });
  assert.deepEqual(result, [
    { length: 2 ** 20 + 1, first: ' ', last: 'X' },
    { length: 2 ** 20 + 1, first: '\t', last: 'X' },
    { length: 5, first: 'l', last: 'l' }
  ]);
});
