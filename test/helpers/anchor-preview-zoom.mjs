import assert from 'node:assert/strict';

/** Native setup only. Calibrate against delivered input, never DPR assumptions. */
export function motionWheelCalibration(before, after, requested, delivered) {
  assert.ok([before, after, requested, delivered].every(Number.isFinite));
  assert.ok(before > 0 && after > 0 && requested !== 0 && delivered !== 0);
  assert.ok(Math.sign(requested) === Math.sign(delivered), 'delivered wheel keeps its requested direction');
  const gain = Math.log(after / before) / requested;
  assert.ok(gain < 0, 'native wheel changed camera in the expected direction');
  return { gain, deliveredRatio: delivered / requested };
}

export function motionWheelPlan(current, wanted, calibration = null) {
  assert.ok([current, wanted].every(v => Number.isFinite(v) && v > 0));
  const error = Math.log(wanted / current);
  // A narrow setup band also keeps the .82737 boundary comparison meaningful.
  if (Math.abs(error) <= .001) return { done: true, requested: 0, budget: 0 };
  if (!calibration) return { done: false, requested: -Math.sign(error) * 60, budget: 1 };
  assert.ok(Number.isFinite(calibration.gain) && calibration.gain < 0);
  const requested = Math.sign(error / calibration.gain) * Math.min(120, Math.abs(error / calibration.gain));
  const budget = Math.ceil(Math.abs(error / (calibration.gain * 120))) + 2;
  assert.ok(budget <= 128, 'measured native gain yields a bounded setup');
  return { done: false, requested, budget };
}

function installWheelTrace() {
  if (window.previewMotionZoom) throw Error('Zoom trace already installed');
  const events = [];
  const onWheel = e => { events.push({ at: performance.now(), trusted: e.isTrusted === true,
    deltaY: e.deltaY, deltaMode: e.deltaMode, control: e.ctrlKey, x: e.clientX, y: e.clientY,
    target: e.target?.getAttribute?.('class') || null }); };
  window.addEventListener('wheel', onWheel, { capture: true, passive: true });
  window.previewMotionZoom = { events, stop() { window.removeEventListener('wheel', onWheel, true); } };
}

export async function zoomPreviewMotion(h, page, wanted, evidence) {
  const before = await h.state(page);
  Object.assign(evidence, { wanted, before: { viewport: before.viewport, selection: before.selection, history: before.history }, steps: [] });
  await page.evaluate(installWheelTrace);
  let calibration = null, budget = 1;
  try {
    for (let index = 0; index < budget; index++) {
      const current = await h.raw(page), plan = motionWheelPlan(current.viewport.zoom, wanted, calibration);
      if (plan.done) break;
      const point = await h.blank(page); await page.mouse.move(point.x, point.y);
      const count = await page.evaluate(() => window.previewMotionZoom.events.length);
      await page.keyboard.down('Control');
      try { await page.mouse.wheel({ deltaY: plan.requested }); }
      finally { await page.keyboard.up('Control'); }
      await h.settle(page);
      const events = await page.evaluate(count => window.previewMotionZoom.events.slice(count), count);
      const after = await h.raw(page);
      evidence.steps.push({ requested: plan.requested, point, events, before: current.viewport, after: after.viewport });
      assert.equal(events.length, 1, 'one requested wheel tick is delivered');
      const [event] = events;
      assert.equal(event.trusted, true); assert.equal(event.control, true); assert.equal(event.deltaMode, 0);
      const measured = motionWheelCalibration(current.viewport.zoom, after.viewport.zoom, plan.requested, event.deltaY);
      if (!calibration) {
        calibration = measured;
        budget = index + 1 + motionWheelPlan(after.viewport.zoom, wanted, calibration).budget;
        evidence.calibration = calibration; evidence.budget = budget;
      } else {
        assert.ok(Math.abs(measured.gain - calibration.gain) <= 1e-10, 'later camera response agrees with measured native calibration');
        assert.ok(Math.abs(measured.deliveredRatio - calibration.deliveredRatio) <= 1e-6, 'later delivered input agrees with native scale');
      }
      assert.equal(after.xml, before.xml); assert.deepEqual(after.history, before.history);
      assert.deepEqual(after.selection, before.selection);
    }
    const after = await h.state(page);
    evidence.after = { viewport: after.viewport, selection: after.selection, history: after.history };
    assert.equal(motionWheelPlan(after.viewport.zoom, wanted, calibration).done, true, 'calibrated native wheel reaches requested camera band');
    assert.equal(after.xml, before.xml); assert.deepEqual(after.history, before.history); assert.deepEqual(after.selection, before.selection);
    return evidence;
  } finally {
    evidence.delivered = await page.evaluate(() => {
      const trace = window.previewMotionZoom; trace.stop(); delete window.previewMotionZoom; return trace.events;
    });
  }
}
