import assert from 'node:assert/strict';
import { test } from 'node:test';
import { placeConnectGrab } from '../../lib/modeling/ConnectGrabPlacement.js';

function input(zoom = 1) {
  return { anchor: { x: 1176 / zoom, y: 250 / zoom }, preferred: { x: 1192 / zoom, y: 250 / zoom }, normal: { x: 1, y: 0 },
    bounds: { left: 0, top: 0, right: 1180 / zoom, bottom: 700 / zoom },
    radius: 6.75 / zoom, clearance: 10 / zoom, separation: 12 / zoom,
    regions: [{ x: 1176 / zoom, y: 250 / zoom, halfWidth: 4 / zoom, halfHeight: 4 / zoom }] };
}
function valid(result, options) {
  assert.ok(result, 'a reachable painted grab exists');
  const { bounds, radius, anchor, separation, clearance, regions } = options;
  assert.ok(result.x - radius >= bounds.left && result.x + radius <= bounds.right);
  assert.ok(result.y - radius >= bounds.top && result.y + radius <= bounds.bottom);
  assert.ok(Math.hypot(result.x - anchor.x, result.y - anchor.y) >= separation - 1e-9);
  for (const region of regions) assert.ok(region.radius === undefined ?
    Math.abs(result.x - region.x) > region.halfWidth + clearance || Math.abs(result.y - region.y) > region.halfHeight + clearance :
    Math.hypot(result.x - region.x, result.y - region.y) > region.radius + clearance);
}

test('preserves a usable preferred grab without changing its chosen anchor', () => {
  const options = input(); options.preferred = { x: 1100, y: 250 };
  const before = structuredClone(options);
  assert.equal(placeConnectGrab(options), options.preferred);
  assert.deepEqual(options, before);
});

for (const zoom of [.2, .5, 1, 2, 4]) test(`all edges and corners keep the complete painted disc visible at zoom ${zoom}`, () => {
  for (const [x, y, nx, ny] of [[4,350,-1,0],[1176,350,1,0],[590,4,0,-1],[590,696,0,1],
    [4,4,-Math.SQRT1_2,-Math.SQRT1_2],[1176,4,Math.SQRT1_2,-Math.SQRT1_2],
    [4,696,-Math.SQRT1_2,Math.SQRT1_2],[1176,696,Math.SQRT1_2,Math.SQRT1_2]]) {
    const options = input(zoom);
    options.anchor = { x: x / zoom, y: y / zoom }; options.normal = { x: nx, y: ny };
    options.preferred = { x: (x + 20 * nx) / zoom, y: (y + 20 * ny) / zoom };
    options.regions = [{ ...options.anchor, halfWidth: 4, halfHeight: 4 },
      { x: (x - nx * 50) / zoom, y: (y - ny * 50) / zoom, radius: 20 / zoom }];
    const snapshot = structuredClone(options), result = placeConnectGrab(options);
    valid(result, options); assert.deepEqual(options, snapshot);
    const delta = { x: result.x - options.anchor.x, y: result.y - options.anchor.y };
    assert.ok(Math.abs(delta.x * nx + delta.y * ny) / Math.hypot(delta.x, delta.y) >= Math.SQRT1_2 - 1e-9,
      'fallback travel does not become purely tangential to fine origin choice');
  }
});

test('palette, toolbar, minimap, logo, context pad and fitting margins exclude their complete boxes', () => {
  for (const box of [
    { x: 60, y: 350, halfWidth: 60, halfHeight: 300 },
    { x: 500, y: 25, halfWidth: 300, halfHeight: 25 },
    { x: 1080, y: 620, halfWidth: 100, halfHeight: 80 },
    { x: 1135, y: 670, halfWidth: 35, halfHeight: 15 },
    { x: 600, y: 350, halfWidth: 35, halfHeight: 85 }
  ]) {
    const options = input(); options.anchor = { x: box.x - box.halfWidth - 5, y: box.y };
    options.preferred = { x: options.anchor.x + 20, y: box.y }; options.regions = [box];
    options.bounds = { left: 12, top: 12, right: 1168, bottom: 688 };
    valid(placeConnectGrab(options), options);
  }
});

test('no-space result is explicit and malformed bounds cannot create a hidden target', () => {
  const options = input(); options.regions = [{ x: 590, y: 350, halfWidth: 590, halfHeight: 350 }];
  assert.equal(placeConnectGrab(options), null);
  assert.equal(placeConnectGrab({ ...input(), bounds: { left: 0, top: 0, right: 10, bottom: 10 } }), null);
  assert.equal(placeConnectGrab({ ...input(), bounds: { left: 0, top: 0, right: NaN, bottom: 10 } }), null);
});
