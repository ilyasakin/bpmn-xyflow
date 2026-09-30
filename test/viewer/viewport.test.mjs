import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getGraphBounds, fitViewport } from '../../lib/util/ViewportUtil.js';

test('fitPadding is pixels and keeps basic task readable at reported canvas dimensions', () => {
  const bounds = { x: 173, y: 80, width: 280, height: 80 };
  const viewport = fitViewport(bounds, 1188, 762, 0.2, 4, 20);
  assert.equal(viewport.zoom, 4);
  assert.equal(100 * viewport.zoom, 400);
  assert.ok(bounds.x * viewport.zoom + viewport.x >= 20);
});

test('explicit pixel padding and zoom limits are respected', () => {
  const v = fitViewport({ x: 0, y: 0, width: 1000, height: 600 }, 1200, 800, 0.2, 4, 100);
  assert.equal(v.zoom, 1);
  assert.equal(v.x, 100);
  assert.equal(v.y, 100);
});

test('hidden edges and collapsed descendant geometry do not shrink fit', () => {
  const bounds = getGraphBounds({ nodes: [
    { x: 100, y: 200, width: 100, height: 80 },
    { x: 100000, y: 0, width: 100, height: 80, hidden: true }
  ], edges: [ { hidden: true, waypoints: [ { x: -100000, y: -100000 } ] } ] });
  assert.deepEqual(bounds, { x: 100, y: 200, width: 100, height: 80 });
});

test('empty, invalid, point and hidden-container bounds stay finite', () => {
  assert.equal(getGraphBounds({ nodes: [], edges: [] }), null);
  assert.equal(getGraphBounds({ nodes: [ { x: NaN, y: Infinity } ], edges: [] }), null);
  const point = getGraphBounds({ nodes: [], edges: [ { waypoints: [ { x: 5, y: 5 } ] } ] });
  assert.deepEqual(point, { x: 5, y: 5, width: 1, height: 1 });
  assert.equal(fitViewport(point, 0, 800, 0.2, 4), null);
});

test('fit keeps every diagram edge inside the chrome-free safe area', () => {
  const bounds = { x: 173, y: 80, width: 280, height: 80 };
  const insets = { left: 128, bottom: 196, right: 0, top: 0 };
  const viewport = fitViewport(bounds, 1188, 762, 0.01, 4, 20, insets);
  const left = bounds.x * viewport.zoom + viewport.x;
  const top = bounds.y * viewport.zoom + viewport.y;
  const right = (bounds.x + bounds.width) * viewport.zoom + viewport.x;
  const bottom = (bounds.y + bounds.height) * viewport.zoom + viewport.y;
  assert.ok(left >= insets.left + 20 - 0.01);
  assert.ok(right <= 1188 - 20 + 0.01);
  assert.ok(top >= 20 - 0.01);
  assert.ok(bottom <= 762 - insets.bottom - 20 + 0.01);
});

test('large HR diagram fits mobile safe area at the default minimum zoom', () => {
  const bounds = { x: 104, y: 65, width: 5122, height: 1822 };
  const insets = { left: 128, bottom: 196, top: 15, right: 0 };
  const viewport = fitViewport(bounds, 390, 700, 0.01, 4, 20, insets);
  assert.ok(bounds.x * viewport.zoom + viewport.x >= 148 - 0.01);
  assert.ok((bounds.x + bounds.width) * viewport.zoom + viewport.x <= 370 + 0.01);
  assert.ok(bounds.y * viewport.zoom + viewport.y >= 35 - 0.01);
  assert.ok((bounds.y + bounds.height) * viewport.zoom + viewport.y <= 484 + 0.01);
  assert.ok(viewport.zoom < 0.2);
});

test('fully obscured or invalid usable viewport does not produce a transform', () => {
  assert.equal(fitViewport({ x: 0, y: 0, width: 10, height: 10 }, 100, 100, 0.01, 4, 20, { left: 120 }), null);
});
