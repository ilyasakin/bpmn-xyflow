import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertSelectedZoomGeometry, selectedHitWidthBound, svgRoundingBound } from '../helpers/selected-zoom-geometry.mjs';

function sample(modelZoom, engine = 'local', centerX = 280, translation = 140) {
  const zoom = Math.fround(modelZoom), radius = engine === 'local' ? 10 / modelZoom : 10, radiusValue = Math.fround(radius);
  return { engine, zoom, modelZoom, nativeScale: zoom, matrix: { a: zoom, b: 0, c: 0, d: zoom, e: translation, f: 148 },
    radius, radiusValue, centerX, width: 2 * radiusValue * zoom, same: true, connected: true };
}

for (const initial of [.5, 1.5]) test(`recorded native zoom ${initial} separates exact model radius from SVG float precision`, () => {
  const value = sample(initial * 2 ** .18);
  assert.ok(Math.abs(value.radius - 10 / value.zoom) > 1e-8, 'the previous CTM-derived radius assertion reproduces the failure');
  assertSelectedZoomGeometry(value);
  assert.equal(value.zoom, Math.fround(value.modelZoom));
});

test('ordinary and promoted hit geometry passes only derived coordinate-rounding limits', () => {
  for (const engine of ['local', 'upstream']) for (const zoom of [.2, .5664419426478993, 1, 1.6993258279436978, 3, 4]) {
    const value = sample(zoom, engine, 430.125, -123.75);
    const left = Math.fround(Math.fround(value.centerX - value.radiusValue) * value.zoom + value.matrix.e);
    const right = Math.fround(Math.fround(value.centerX + value.radiusValue) * value.zoom + value.matrix.e);
    value.width = Math.fround(right - left);
    assertSelectedZoomGeometry(value);
    const bad = { ...value, width: 2 * value.radiusValue * value.zoom + selectedHitWidthBound(value) * 2 };
    assert.throws(() => assertSelectedZoomGeometry(bad), assert.AssertionError);
  }
});

test('wrong radius, zoom, matrix, identity and non-finite evidence remain hard failures', () => {
  const mutations = [
    v => { v.radius += 1e-7; }, v => { v.radius = 10 / v.zoom; },
    v => { v.radiusValue += svgRoundingBound(v.radius) * 3; },
    v => { v.nativeScale += 1e-8; }, v => { v.modelZoom += 1e-6; },
    v => { v.matrix.b = .0001; }, v => { v.matrix.d += .0001; },
    v => { v.same = false; }, v => { v.connected = false; },
    v => { v.width += .01; }, v => { v.width = NaN; }, v => { v.zoom = Infinity; }
  ];
  for (const mutate of mutations) { const value = sample(.5 * 2 ** .18); mutate(value); assert.throws(() => assertSelectedZoomGeometry(value), assert.AssertionError); }
});
