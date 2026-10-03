/** Native diagnostic, prepared/unrun. A pass is not a latency or paint-time claim. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createAnchorHarness } from '../helpers/anchor-ux-browser.mjs';
import { runFollowupCases, assertFollowupPortClosed, selectFollowupShard } from '../helpers/anchor-followup-lifecycle.mjs';
import { collectPreviewOutline, validatePreviewOutline } from '../helpers/anchor-preview-outline.mjs';
import { zoomPreviewMotion } from '../helpers/anchor-preview-zoom.mjs';
import { installPreviewMotionObserver, collectPreviewMotionStyles, analyzePreviewMotion, assertMotionDelivery } from '../helpers/anchor-preview-motion.mjs';

const conditions = [
  { name: 'unselected-normal', selected: false, zoom: 1, dpr: 1, reducedMotion: false },
  { name: 'selected-low', selected: true, zoom: .5, dpr: 1, reducedMotion: false },
  { name: 'unselected-high-retina-reduced', selected: false, zoom: 2, dpr: 2, reducedMotion: true },
  { name: 'selected-normal-retina-reduced', selected: true, zoom: 1, dpr: 2, reducedMotion: true }
];

/** Integer native delivery, forward then reverse; no synthetic dispatch. */
export function previewMotionPath(shape, state, { boundary = false } = {}) {
  const { x, y, width: w, height: h, type } = shape, cx = x + w / 2, cy = y + h / 2;
  const points = Array.from({ length: 65 }, (_, i) => {
    const t = i / 64; let p;
    if (type.endsWith('Event')) {
      const angle = (boundary ? 170 + 40 * t : 200 + 140 * t) * Math.PI / 180;
      p = { x: cx + Math.cos(angle) * w / 2, y: cy + Math.sin(angle) * w / 2 };
    } else if (type.endsWith('Gateway')) {
      const f = .15 + .7 * t; p = { x: x + w / 2 * f, y: cy - h / 2 * f };
    } else p = { x: x + w * (.2 + .6 * t), y };
    return { x: Math.round(state.container.x + state.viewport.x + p.x * state.viewport.zoom),
      y: Math.round(state.container.y + state.viewport.y + p.y * state.viewport.zoom) };
  }).filter((p, i, a) => !i || p.x !== a[i - 1].x || p.y !== a[i - 1].y);
  assert.ok(points.length >= 4, 'path has several distinct delivered pixels');
  return [...points, ...points.slice(0, -1).reverse()];
}

async function styleSnapshot(page, id) { return page.evaluate(collectPreviewMotionStyles, id); }
async function stopAndRead(page) {
  return page.evaluate(() => {
    const observer = window.previewMotionObserver;
    if (!observer) return null;
    observer.stop(); return observer.read();
  });
}

export async function previewMotionWorkflow(h, page, key, config, gatewayPolicy, outlinePolicy = 'baseline') {
  await page.setViewport({ width: 1800, height: 1200, deviceScaleFactor: config.dpr });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: config.reducedMotion ? 'reduce' : 'no-preference' }]);
  await h.settle(page);
  let source = config.source;
  if (!source) {
    const first = await h.state(page), start = first.nodes.find(n => n.type === 'bpmn:StartEvent');
    assert.ok(start, 'visible empty sample starts with one StartEvent');
    await h.selectNode(page, start.id); await page.keyboard.press('Delete'); await h.settle(page);
    assert.equal((await h.raw(page)).nodes.some(n => n.id === start.id), false);
    source = null;
  }
  const zoomEvidence = {};
  try { await zoomPreviewMotion(h, page, config.zoom, zoomEvidence); }
  finally { await writeFile(`${h.output}/${key}-zoom-setup.json`, JSON.stringify(zoomEvidence, null, 2)); }
  if (!source) {
    source = await h.palette(page, config.label, { x: 900, y: 650 });
  }
  await h.blank(page, { click: true });
  if (config.selected) await h.selectNode(page, source);
  const before = await h.state(page), shape = h.node(before, source);
  assert.deepEqual(before.selection, config.selected ? [source] : []);
  const geometry = { shape, viewport: before.viewport, container: before.container };
  const points = previewMotionPath(shape, before, { boundary: !!config.source });
  for (const p of points) assert.ok(p.x > 0 && p.x < 1800 && p.y > before.container.y && p.y < 1200, 'motion path is inside the visible editor');
  await page.mouse.move(points[0].x, points[0].y, { steps: 6 }); await h.settle(page);
  const control = await page.$(`.bpmn-xyflow-connect-handle[data-connect-source="${source}"]`);
  assert.ok(control, 'native approach exposes the requested source before observation');
  const environment = await styleSnapshot(page, source);
  assert.equal(environment.dpr, config.dpr); assert.equal(environment.reducedMotion, config.reducedMotion);
  if (config.source) {
    const marker = environment.elements.find(e => e.selector === '.bpmn-xyflow-connect-docking-point');
    const grab = environment.elements.find(e => e.selector === '.bpmn-xyflow-connect-port');
    const center = e => ({ x: e.box.x + e.box.width / 2, y: e.box.y + e.box.height / 2 });
    assert.ok(marker?.box && grab?.box, 'boundary motion records both visible control locations');
    assert.ok(Math.hypot(center(marker).x - center(grab).x, center(marker).y - center(grab).y) > 8.75,
      'boundary risk pair exercises a visibly displaced grab, not the previous coincident .955 setup');
  }
  const setup = await h.noChange(page, before, 'native approach is model/history neutral');
  assert.deepEqual(setup.selection, before.selection); assert.deepEqual(setup.viewport, before.viewport);
  const outlineEvidence = await page.evaluate(collectPreviewOutline, { owner: source, zoom: geometry.viewport.zoom, shape, outlinePolicy });
  await writeFile(`${h.output}/${key}-outline.json`, JSON.stringify({ outlinePolicy, gatewayPolicy, shape, zoom: geometry.viewport.zoom, evidence: outlineEvidence }, null, 2));
  const outlineCheck = validatePreviewOutline(outlineEvidence, shape, geometry.viewport.zoom, { outlinePolicy, gatewayPolicy });
  const installed = await page.evaluate(installPreviewMotionObserver, { owner: source });
  const phases = [];
  let trace;
  try {
    for (const [label, intervalMs] of [['slow-reversal', 24], ['fast-reversal', 0]]) {
      const stylesBefore = await styleSnapshot(page, source), metricsBefore = await page.metrics();
      await page.evaluate(label => window.previewMotionObserver.begin(label), label);
      const sent = [];
      for (const p of points) {
        const started = performance.now();
        await page.mouse.move(p.x, p.y);
        sent.push({ ...p, sentAt: started, resolvedAt: performance.now() });
        if (intervalMs) await delay(intervalMs);
      }
      // Two RAFs after final input ensure its final pre-paint state is observable.
      // No browser evaluate, style read or artifact dump occurs between path inputs.
      await h.settle(page);
      await page.evaluate(() => window.previewMotionObserver.end());
      const metricsAfter = await page.metrics(), stylesAfter = await styleSnapshot(page, source);
      const metricsDelta = Object.fromEntries(['LayoutCount', 'RecalcStyleCount', 'LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration', 'TaskDuration']
        .map(name => [name, metricsAfter[name] - metricsBefore[name]]));
      phases.push({ label, intervalMs, sent, stylesBefore, stylesAfter, metricsBefore, metricsAfter, metricsDelta });
    }
  } finally {
    trace = await stopAndRead(page);
    await writeFile(`${h.output}/${key}-motion-trace.json`, JSON.stringify({ config, gatewayPolicy, geometry, installed, environment, phases, trace }, null, 2));
  }
  const after = await h.noChange(page, before, 'hover motion changes no semantic model, DI or history');
  assert.deepEqual(after.selection, before.selection); assert.deepEqual(after.viewport, before.viewport);
  assert.equal(trace.runs.length, 2); assert.equal(trace.stopped, true);
  for (const [i, run] of trace.runs.entries()) {
    phases[i].delivery = assertMotionDelivery(phases[i].sent, run.events);
    assert.ok(run.pointers.length > 0 && run.pointers.every(e => e.trusted && e.pointerType === 'mouse'));
  }
  const summaries = analyzePreviewMotion(trace, geometry, { gatewayPolicy });
  return { diagnosticOnly: true, performanceAccepted: false, source, config, gatewayPolicy, geometry,
    environment, installed, summaries, phases, trace, zoomEvidence, outlineCheck,
    limitations: ['RAF is not compositor presentation', 'shared factory performs CTM reads on mousemove',
      'CDP throughput is not physical input sampling', 'layout metric deltas are process totals, not per-handler attribution'] };
}

export function previewMotionCases(gatewayPolicy = 'continuous', outlinePolicy = 'baseline') {
  assert.ok(['baseline', 'outward'].includes(outlinePolicy), 'explicit visual outline policy');
  assert.ok(['continuous', 'vertices'].includes(gatewayPolicy), 'explicit gateway policy');
  const cases = ['Task', 'Start', 'Gateway'].flatMap(label => conditions.map(config => ({ ...config, label,
    id: `MOTION-${label}`, name: config.name, gatewayPolicy, outlinePolicy, engine: 'local', sample: 'Empty diagram',
    run: (h, page, key) => previewMotionWorkflow(h, page, key, { ...config, label }, gatewayPolicy, outlinePolicy) })));
  const boundary = { name: 'selected-booking-boundary', selected: true, zoom: .82737, dpr: 1, reducedMotion: false, source: 'FlightTimeout' };
  cases.push({ ...boundary, id: 'MOTION-Boundary', gatewayPolicy, outlinePolicy, engine: 'local', sample: 'Booking, timeout and compensation',
    run: (h, page, key) => previewMotionWorkflow(h, page, key, boundary, gatewayPolicy, outlinePolicy) });
  return cases;
}

export async function runPreviewMotion({ gatewayPolicy = process.env.BPMN_MOTION_GATEWAY_POLICY || 'continuous',
  outlinePolicy = process.env.BPMN_MOTION_OUTLINE_POLICY || 'baseline', shardIndex = 0, shardCount = 1, output = 'test-artifacts/anchor-preview-motion', basePort = 5410 } = {}) {
  const cases = selectFollowupShard(previewMotionCases(gatewayPolicy, outlinePolicy), { shardIndex, shardCount });
  if (shardCount > 1) output += `-${shardIndex + 1}-of-${shardCount}`;
  await mkdir(output, { recursive: true });
  const source = { head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    changed: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }), sha256: {} };
  for (const path of ['lib/Modeler.js', 'lib/Viewer.js', 'lib/modeling/ConnectGrabPlacement.js', 'test/helpers/anchor-ux-browser.mjs'])
    source.sha256[path] = createHash('sha256').update(await readFile(path)).digest('hex');
  for (const path of ['lib/modeling/ConnectOutline.js', 'lib/modeling/ConnectionAnchors.js']) {
    try { source.sha256[path] = createHash('sha256').update(await readFile(path)).digest('hex'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; source.sha256[path] = null; }
  }
  await writeFile(`${output}/source.json`, JSON.stringify({ ...source, gatewayPolicy, outlinePolicy, shardIndex, shardCount }, null, 2));
  const persist = (name, value, signal) => writeFile(`${output}/${name}`, JSON.stringify(value, null, 2), { signal });
  const results = await runFollowupCases(cases, {
    createHarness: (_c, i) => createAnchorHarness({ port: basePort + i, output }),
    verifyStopped: (_h, _c, i) => assertFollowupPortClosed(basePort + i),
    captureFailure: async (h, page, key, error, signal) => {
      const trace = await stopAndRead(page); signal.throwIfAborted();
      await persist(`${key}-observer-failure.json`, { error: String(error), trace }, signal);
      await page.screenshot({ path: `${output}/${key}-failure.png`, fullPage: false }); signal.throwIfAborted();
      const state = await h.raw(page); signal.throwIfAborted();
      await persist(`${key}-failure.json`, { error: String(error), state }, signal);
      await writeFile(`${output}/${key}-failure.bpmn`, state.xml, { signal });
    },
    persistProgress: (value, i, signal) => persist(`results-progress-${i + 1}.json`, value, signal),
    persistAggregate: (value, signal) => persist('results.json', value, signal)
  });
  assert.equal(results.length, cases.length);
  assert.equal(results.filter(r => r.status !== 'passed').length, 0, `Native motion diagnostic failed; see ${output}/results.json`);
  console.log(`Motion diagnostic: ${results.length} cases recorded; no blanket latency acceptance claim`);
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--list')) console.log(JSON.stringify(previewMotionCases().map(({ run: _run, ...c }) => ({ ...c, status: 'prepared-unrun' })), null, 2));
  else await runPreviewMotion();
}
