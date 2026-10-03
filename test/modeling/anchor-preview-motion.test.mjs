import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Window } from 'happy-dom';
import { CdpPage, CdpMouse, CdpKeyboard } from 'puppeteer';
import { installPreviewMotionObserver, analyzePreviewMotion, motionExpectedMarker, motionDistribution, assertMotionDelivery } from '../helpers/anchor-preview-motion.mjs';
import { previewMotionCases, previewMotionPath } from './browser-anchor-preview-motion.mjs';
import { selectFollowupShard } from '../helpers/anchor-followup-lifecycle.mjs';

function fixture() {
  const window = new Window(), saved = new Map(), callbacks = new Map();
  let next = 1;
  for (const [key, value] of Object.entries({ window, document: window.document,
    requestAnimationFrame: fn => { const id = next++; callbacks.set(id, fn); return id; },
    cancelAnimationFrame: id => callbacks.delete(id) })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  window.document.body.innerHTML = '<div id="viewer"><svg><g class="bpmn-xyflow-shape" data-element-id="A"><rect/></g><g class="bpmn-xyflow-connect-docking" data-connect-source="A"><circle class="bpmn-xyflow-connect-docking-point" cx="20" cy="0"/><line class="bpmn-xyflow-connect-tether" x1="20" y1="0" x2="20" y2="-12"/></g><g class="bpmn-xyflow-connect-handle" data-connect-source="A"><circle class="bpmn-xyflow-connect-port" cx="20" cy="-12"/></g></svg></div>';
  const root = window.document.querySelector('#viewer'), target = root.querySelector('rect');
  let appCalls = 0, laterCalls = 0;
  // Same window/capture registration order as the actual production handler.
  window.addEventListener('mousemove', e => {
    appCalls++;
    for (const selector of ['.bpmn-xyflow-connect-docking-point', '.bpmn-xyflow-connect-port'])
      root.querySelector(selector).setAttribute('cx', e.clientX);
    root.querySelector('line').setAttribute('x1', e.clientX); root.querySelector('line').setAttribute('x2', e.clientX);
  }, true);
  root.getBoundingClientRect = () => { throw Error('critical observer must not read layout'); };
  for (const e of root.querySelectorAll('*')) { e.getBoundingClientRect = root.getBoundingClientRect; e.getScreenCTM = root.getBoundingClientRect; }
  const install = Function(`return (${installPreviewMotionObserver.toString()})`)();
  install({ owner: 'A' });
  window.addEventListener('mousemove', () => { laterCalls++; }, true);
  return { window, root, target,
    move(x) { const event = new window.MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: x, clientY: 0, buttons: 0 });
      target.dispatchEvent(event); assert.equal(event.defaultPrevented, false); return event; },
    frame() { const [id, callback] = callbacks.entries().next().value; callbacks.delete(id); callback(performance.now()); },
    counts: () => ({ appCalls, laterCalls }),
    async close() { window.previewMotionObserver.stop(); await window.happyDOM.abort(); for (const [key, old] of saved) if (old) Object.defineProperty(globalThis, key, old); else delete globalThis[key]; }
  };
}

test('serialized passive observer sees completed handler attributes without layout or input interception', async () => {
  const f = fixture();
  try {
    f.window.previewMotionObserver.begin('fast'); f.move(20); f.move(30); f.frame(); f.move(40); f.frame();
    f.window.previewMotionObserver.end(); f.window.previewMotionObserver.stop();
    const trace = f.window.previewMotionObserver.read();
    assert.deepEqual(trace.errors, []); assert.deepEqual(f.counts(), { appCalls: 3, laterCalls: 3 });
    assert.deepEqual(trace.runs[0].events.map(e => e.dom.marker.x), [20, 30, 40]);
    assert.deepEqual(trace.runs[0].frames.map(e => e.dom.marker.x), [30, 40]);
    assert.equal(trace.runs[0].events[0].trusted, false, 'synthetic structural events are never relabeled native');
    assert.equal(trace.runs[0].frames[0].latestSequence, trace.runs[0].events[1].sequence);
    const length = trace.runs[0].events.length; f.move(50);
    assert.equal(f.window.previewMotionObserver.read().runs[0].events.length, length, 'stop retires every diagnostic listener');
  } finally { await f.close(); }
});

const geometry = { shape: { id: 'A', type: 'bpmn:Task', x: 0, y: 0, width: 100, height: 80 }, viewport: { x: 0, y: 0, zoom: 1 }, container: { x: 0, y: 0 } };
function validTrace() {
  const dom = x => ({ owners: ['A'], marker: { x, y: 0 }, grab: { x, y: -12 },
    tether: { x1: x, y1: 0, x2: x, y2: -12 }, readCostMs: .02 });
  const events = [20, 30, 40].map((x, i) => ({ sequence: i + 1, x, y: 0, trusted: true, buttons: 0,
    at: 100 + i, timeStamp: 99 + i, observedAt: 100.1 + i, dom: dom(x) }));
  return { owner: 'A', errors: [], longTasks: [{ startTime: 100, duration: 60, name: 'self' }],
    runs: [{ label: 'fast', dropped: 0, start: 99, end: 130, pointers: [{ trusted: true }], events,
      frames: [{ sequence: 4, at: 110, timestamp: 109, latestSequence: 3, dom: dom(40) },
        { sequence: 5, at: 126, timestamp: 125, latestSequence: 3, dom: dom(40) }] }] };
}

test('latest-frame analysis separates superseded input, timing and spatial jumps', () => {
  const trace = validTrace();
  // A large placement jump can be correct geometry yet poor perceived motion.
  trace.runs[0].events[2].dom.grab.x = 70; trace.runs[0].events[2].dom.tether.x2 = 70;
  for (const f of trace.runs[0].frames) { f.dom.grab.x = 70; f.dom.tether.x2 = 70; }
  const [r] = analyzePreviewMotion(trace, geometry);
  assert.equal(r.eventsSupersededBeforeRAF, 2); assert.equal(r.deliveredToFirstRAFMs.count, 1);
  assert.equal(r.deliveredToFirstRAFMs.max, 8); assert.equal(r.eventTimestampToObservationMs.count, 3);
  assert.equal(r.maxGrabJump.grabCss, 40); assert.equal(r.maxGrabJump.inputCss, 10); assert.equal(r.maxGrabJump.markerCss, 10);
  assert.equal(r.maxGrabJump.grabToInputRatio, 4); assert.equal(r.longTasks.length, 1);
  assert.deepEqual(motionDistribution([]), { count: 0, min: null, median: null, p95: null, max: null });
});

test('geometry, trust, frame freshness and observer corruptions cannot become a diagnostic pass', () => {
  const negatives = [
    t => { t.errors.push('observer callback failed'); },
    t => { t.runs[0].dropped++; },
    t => { t.runs[0].events[1].trusted = false; },
    t => { t.runs[0].events[1].buttons = 1; },
    t => { t.runs[0].events[1].dom.marker.x = 29; },
    t => { t.runs[0].events[1].dom.owners = ['B']; },
    t => { t.runs[0].events[1].dom.owners.push('A'); },
    t => { t.runs[0].events[1].dom.grab = null; },
    t => { t.runs[0].events[1].dom.tether.x1++; },
    t => { t.runs[0].events[1].dom.tether.x2++; },
    t => { t.runs[0].frames[0].latestSequence = 2; },
    t => { t.runs[0].frames[0].dom.marker.x = 30; },
    t => { t.runs[0].frames = []; },
    t => { t.runs[0].events[1].timeStamp = Infinity; }
  ];
  for (const corrupt of negatives) { const trace = validTrace(); corrupt(trace); assert.throws(() => analyzePreviewMotion(trace, geometry)); }
});

test('Gateway policy is explicit and independently different from continuous baseline', () => {
  const gateway = { type: 'bpmn:ExclusiveGateway', x: 100, y: 100, width: 50, height: 50 };
  const p = { x: 107, y: 117 };
  assert.deepEqual(motionExpectedMarker(gateway, p, 'vertices'), { x: 100, y: 125 });
  assert.notDeepEqual(motionExpectedMarker(gateway, p, 'continuous'), motionExpectedMarker(gateway, p, 'vertices'));
  assert.throws(() => motionExpectedMarker(gateway, p, 'auto'));
  const event = { type: 'bpmn:StartEvent', x: 0, y: 0, width: 36, height: 36 };
  const dock = motionExpectedMarker(event, { x: 5, y: 1 });
  assert.ok(Math.abs(Math.hypot(dock.x - 18, dock.y - 18) - 18) < 1e-12);
});

test('requested inputs and actual coalesced delivery remain separate, with exact final input', () => {
  const sent = [20, 25, 30, 40, 30, 25, 20].map(x => ({ x, y: 0 }));
  const events = [20, 30, 40, 30, 20].map(x => ({ x, y: 0, trusted: true }));
  assert.equal(assertMotionDelivery(sent, events).undeliveredRequests, 2);
  assert.throws(() => assertMotionDelivery(sent, [...events.slice(0, -1), { x: 19, y: 0, trusted: true }]));
  assert.throws(() => assertMotionDelivery(sent, events.map(e => ({ ...e, trusted: false }))));
  assert.throws(() => assertMotionDelivery(sent, events.slice(0, -1)));
});

test('native diagnostic has thirteen pairwise cases with bounded exhaustive shards and integer reversal paths', () => {
  const cases = previewMotionCases(); assert.equal(cases.length, 13);
  assert.equal(new Set(cases.map(c => `${c.id}/${c.name}`)).size, 13);
  for (const label of ['Task', 'Start', 'Gateway']) {
    const group = cases.filter(c => c.label === label); assert.equal(group.length, 4);
    assert.deepEqual(new Set(group.map(c => c.selected)), new Set([true, false]));
    assert.deepEqual(new Set(group.map(c => c.dpr)), new Set([1, 2]));
    assert.deepEqual(new Set(group.map(c => c.reducedMotion)), new Set([true, false]));
  }
  assert.equal(cases.at(-1).source, 'FlightTimeout'); assert.equal(cases.at(-1).selected, true);
  const shards = [0, 1].map(shardIndex => selectFollowupShard(cases, { shardIndex, shardCount: 2 }));
  assert.deepEqual(shards.map(s => s.length), [7, 6]); assert.equal(new Set(shards.flat()).size, 13);
  const points = previewMotionPath(geometry.shape, geometry);
  assert.ok(points.every(p => Number.isInteger(p.x) && Number.isInteger(p.y)));
  assert.deepEqual(points[0], points.at(-1)); assert.ok(points.some((p, i) => i && p.x < points[i - 1].x));
});

test('native runner only uses installed APIs and preserves the guarded green factory', async () => {
  const source = await readFile(new URL('./browser-anchor-preview-motion.mjs', import.meta.url), 'utf8');
  for (const m of source.matchAll(/\bpage\.(\w+)\s*\(/g)) assert.equal(typeof CdpPage.prototype[m[1]], 'function', m[1]);
  for (const [kind, prototype] of [['mouse', CdpMouse.prototype], ['keyboard', CdpKeyboard.prototype]])
    for (const m of source.matchAll(new RegExp(`\\b${kind}\\.(\\w+)\\s*\\(`, 'g'))) assert.equal(typeof prototype[m[1]], 'function', `${kind}.${m[1]}`);
  assert.doesNotMatch(source, /\.setViewport\(\s*\{\s*x:|modeler\.(?:addShape|select|importXML|setViewport)|dispatchEvent/);
  const factory = await readFile(new URL('../helpers/anchor-ux-browser.mjs', import.meta.url));
  assert.equal(createHash('sha256').update(factory).digest('hex'), 'c128050f658b7d2a9a2492431dd48b43f0dbdb5694d93213a25fe40d23f07082');
});
