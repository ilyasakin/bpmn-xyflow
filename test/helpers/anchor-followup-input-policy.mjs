import assert from "node:assert/strict";

/** Native mouse coordinates are integer CSS pixels. Avoid <=3px click-like pans. */
export function integerPanSteps(requestedDelta) {
  if (!Number.isFinite(requestedDelta)) throw Error("Pan delta must be finite");
  const target = Math.round(requestedDelta);
  if (!Number.isSafeInteger(target)) throw Error("Pan delta must be a safe integer");
  if (!target) return [];
  const sign = Math.sign(target),
    distance = Math.abs(target);
  if (distance <= 3) return [sign * 10, target - sign * 10];
  const count = Math.ceil(distance / 100);
  if (count > 100) throw Error("Requested pan exceeds this bounded viewport setup");
  const step = Math.floor(distance / count),
    remainder = distance % count;
  return Array.from({ length: count }, (_, index) => sign * (step + (index < remainder ? 1 : 0)));
}

export async function panNativeExact(h, page, requestedDelta) {
  const before = await h.state(page),
    steps = integerPanSteps(requestedDelta),
    evidence = [];
  for (const delta of steps) {
    const current = await h.raw(page),
      candidate = await h.blank(page);
    const point = { x: Math.round(candidate.x), y: Math.round(candidate.y) };
    const end = { x: point.x + delta, y: point.y };
    await page.mouse.move(point.x, point.y);
    await page.evaluate(() => {
      window.anchorFollowupPanStart = window.anchorInput.at(-1);
    });
    await page.mouse.down({ button: "middle" });
    try {
      await page.mouse.move(end.x, end.y, { steps: 6 });
    } finally {
      await page.mouse.up({ button: "middle" });
    }
    await h.settle(page);
    const after = await h.raw(page);
    const events = await page.evaluate(() => {
      const marker = window.anchorFollowupPanStart;
      const index = marker ? window.anchorInput.indexOf(marker) : -1;
      if (marker && index < 0) throw Error("Pan input marker was lost before readback");
      delete window.anchorFollowupPanStart;
      return window.anchorInput.slice(index + 1);
    });
    const down = events.find((e) => e.type === "mousedown"),
      up = events.findLast((e) => e.type === "mouseup");
    assert.equal(down?.trusted, true);
    assert.equal(up?.trusted, true);
    assert.deepEqual([down.button, up.button], [1, 1]);
    assert.deepEqual({ x: down.x, y: down.y }, point);
    assert.deepEqual({ x: up.x, y: up.y }, end);
    assert.equal(
      after.viewport.x,
      current.viewport.x + delta,
      "camera follows the delivered integer mouse displacement",
    );
    assert.equal(after.viewport.y, current.viewport.y);
    assert.equal(after.viewport.zoom, before.viewport.zoom);
    assert.equal(after.xml, before.xml);
    assert.deepEqual(after.history, before.history);
    assert.deepEqual(after.selection, before.selection, "a real pan preserves source selection");
    evidence.push({ down, up, viewport: after.viewport });
  }
  const after = await h.state(page),
    deliveredDelta = steps.reduce((sum, value) => sum + value, 0);
  const expectedX = steps.reduce((x, delta) => x + delta, before.viewport.x);
  assert.equal(after.viewport.x, expectedX);
  assert.equal(deliveredDelta, Math.round(requestedDelta) || 0);
  return {
    requestedDelta,
    deliveredDelta,
    steps,
    evidence,
    expectedViewport: { ...before.viewport, x: expectedX },
    before: { viewport: before.viewport, container: before.container },
  };
}
