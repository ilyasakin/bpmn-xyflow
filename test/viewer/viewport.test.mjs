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
