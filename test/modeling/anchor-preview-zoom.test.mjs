import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { motionWheelCalibration, motionWheelPlan, zoomPreviewMotion } from '../helpers/anchor-preview-zoom.mjs';

function replay(wanted, dpr) {
  let zoom = 4, calibration = null, budget = 1;
  const steps = [];
  for (let index = 0; index < budget; index++) {
    const plan = motionWheelPlan(zoom, wanted, calibration); if (plan.done) break;
    const delivered = Math.fround(plan.requested / dpr), before = zoom;
    zoom *= 2 ** (-delivered * .002);
    const measured = motionWheelCalibration(before, zoom, plan.requested, delivered);
    steps.push({ requested: plan.requested, delivered, before, after: zoom });
    if (!calibration) { calibration = measured; budget = index + 1 + motionWheelPlan(zoom, wanted, calibration).budget; }
  }
  assert.equal(motionWheelPlan(zoom, wanted, calibration).done, true);
  return { steps, zoom, budget };
}

test('observed native DPR scaling determines remaining camera inputs and finite budget', () => {
  for (const dpr of [1, 2]) for (const wanted of [.5, .82737, 1, 2]) {
    const result = replay(wanted, dpr);
    assert.equal(result.steps[0].requested, 60); assert.equal(result.steps[0].delivered, 60 / dpr);
    assert.ok(Math.abs(Math.log(result.zoom / wanted)) <= .001);
    assert.ok(result.steps.length <= result.budget); assert.ok(result.budget < 32);
  }
  const retina = replay(1, 2);
  assert.equal(retina.steps[0].after, 3.8370564773010574, 'exact hosted first tick');
  assert.equal(retina.steps[1].requested, 120, 'correct magnitude follows measured camera gain, not extra blind retries');
});

test('dropped, reversed, invalid or unbounded calibration cannot produce setup success', () => {
  for (const args of [[4,4,60,30], [4,5,60,30], [4,3,60,-30], [4,3,0,30], [4,3,60,0], [4,NaN,60,30]])
    assert.throws(() => motionWheelCalibration(...args));
  assert.throws(() => motionWheelPlan(4, 1, { gain: -1e-20 }));
  assert.throws(() => motionWheelPlan(0, 1));
  assert.equal(motionWheelPlan(1, 1).done, true);
  assert.equal(motionWheelPlan(4, 1.8150383106343206).done, false, 'failed hosted setup is not accepted as loading or close enough');
});

test('diagnostic setup retains native wheel, exact no-op guards and readback on every outcome', async () => {
  const helper = await readFile(new URL('../helpers/anchor-preview-zoom.mjs', import.meta.url), 'utf8');
  const runner = await readFile(new URL('./browser-anchor-preview-motion.mjs', import.meta.url), 'utf8');
  assert.match(helper, /page\.mouse\.wheel\(\{ deltaY: plan\.requested \}\)/);
  assert.match(helper, /assert\.equal\(after\.xml, before\.xml\)/);
  assert.match(helper, /assert\.deepEqual\(after\.history, before\.history\)/);
  assert.match(helper, /assert\.deepEqual\(after\.selection, before\.selection\)/);
  assert.match(helper, /finally[\s\S]*evidence\.delivered/);
  assert.doesNotMatch(helper, /setViewport|dispatchEvent|setTimeout/);
  assert.match(runner, /finally \{ await writeFile\(`\$\{h\.output\}\/\$\{key\}-zoom-setup\.json`/);
});

async function mockedNativeZoom(wanted, { dpr = 2, corrupt = null } = {}) {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'window'), listeners = new Set();
  const window = { addEventListener(type, callback) { assert.equal(type, 'wheel'); listeners.add(callback); },
    removeEventListener(type, callback) { assert.equal(type, 'wheel'); listeners.delete(callback); } };
  Object.defineProperty(globalThis, 'window', { value: window, configurable: true });
  const state = { xml: '<bpmn/>', selection: ['A'], history: { size: 3, undo: true, redo: false },
    viewport: { x: 100, y: 50, zoom: 4 } };
  const evidence = {}, keys = [], calls = [];
  let control = false;
  const page = {
    evaluate: async (fn, value) => fn(value),
    keyboard: { down: async key => { keys.push(`down:${key}`); control = true; },
      up: async key => { keys.push(`up:${key}`); control = false; } },
    mouse: { move: async (x, y) => { calls.push(['move', x, y]); }, wheel: async ({ deltaY }) => {
      assert.equal(control, true); calls.push(['wheel', deltaY]);
      const delivered = Math.fround(deltaY / dpr);
      // Explicit driver mock, not a synthetic event presented as native evidence.
      const event = { isTrusted: true, ctrlKey: true, deltaY: delivered, deltaMode: 0,
        clientX: 30, clientY: 40, target: { getAttribute: () => 'canvas' } };
      if (corrupt === 'untrusted') event.isTrusted = false;
      for (const callback of listeners) callback(event);
      if (corrupt !== 'unchanged-camera') state.viewport.zoom *= 2 ** (-delivered * .002);
      if (corrupt === 'model') state.xml = '<changed/>';
      if (corrupt === 'history') state.history.size++;
      if (corrupt === 'selection') state.selection = [];
    } }
  };
  const h = { state: async () => structuredClone(state), raw: async () => structuredClone(state),
    blank: async () => ({ x: 30, y: 40 }), settle: async () => {} };
  try {
    if (corrupt) await assert.rejects(zoomPreviewMotion(h, page, wanted, evidence));
    else await zoomPreviewMotion(h, page, wanted, evidence);
    assert.equal(listeners.size, 0); assert.equal(window.previewMotionZoom, undefined);
    assert.equal(control, false); assert.equal(keys.length % 2, 0);
    assert.ok(keys.every((key, i) => key === `${i % 2 ? 'up' : 'down'}:Control`));
    assert.equal(evidence.steps.length, calls.filter(call => call[0] === 'wheel').length);
    assert.equal(evidence.delivered.length, evidence.steps.length);
    return evidence;
  } finally {
    if (prior) Object.defineProperty(globalThis, 'window', prior); else delete globalThis.window;
  }
}

test('actual setup orchestration calibrates both input scales and retires listeners/modifiers on failure', async () => {
  for (const dpr of [1, 2]) {
    const evidence = await mockedNativeZoom(.82737, { dpr });
    assert.ok(Math.abs(Math.log(evidence.after.viewport.zoom / .82737)) <= .001);
    assert.equal(evidence.calibration.deliveredRatio, 1 / dpr);
    assert.deepEqual(evidence.after.history, evidence.before.history);
    assert.deepEqual(evidence.after.selection, evidence.before.selection);
    assert.ok(evidence.steps.every(step => step.events[0].trusted && step.events[0].control));
  }
  for (const corrupt of ['untrusted', 'unchanged-camera', 'model', 'history', 'selection'])
    await mockedNativeZoom(1, { corrupt });
  const atTarget = await mockedNativeZoom(4);
  assert.equal(atTarget.steps.length, 0);
});
