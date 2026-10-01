import assert from 'node:assert/strict';

// Half a normal float32 ULP (or half its subnormal spacing). SVG numeric
// matrices/lengths and Chromium FloatRect edges may round at these boundaries.
export function svgRoundingBound(value) {
  assert.ok(Number.isFinite(value));
  return 2 ** Math.max(-150, Math.floor(Math.log2(Math.abs(value) || Number.MIN_VALUE)) - 24);
}

export function selectedHitWidthBound({ radiusValue, centerX, zoom, matrix }) {
  const left = centerX - radiusValue, right = centerX + radiusValue;
  const width = 2 * radiusValue * zoom;
  // Cover rounded graph-space bounds, transformed left/right FloatRect edges,
  // and the final width subtraction. This scales with the actual coordinates;
  // it does not allow an arbitrary pixel drift or wrong model-space radius.
  return Math.abs(zoom) * (svgRoundingBound(left) + svgRoundingBound(right) + svgRoundingBound(2 * radiusValue)) +
    svgRoundingBound(left * zoom + matrix.e) + svgRoundingBound(right * zoom + matrix.e) + svgRoundingBound(width) +
    4 * Number.EPSILON * Math.max(1, Math.abs(left * zoom + matrix.e), Math.abs(right * zoom + matrix.e));
}

export function assertSelectedZoomGeometry(geometry) {
  try {
    const { engine, zoom, modelZoom, nativeScale, matrix, radius, radiusValue, centerX, width } = geometry;
    assert.ok(engine === 'local' || engine === 'upstream');
    assert.equal(geometry.same, true, 'zoom retains the selected endpoint SVG node');
    assert.equal(geometry.connected, true);
    for (const value of [zoom, radius, radiusValue, centerX, width, ...Object.values(matrix)]) assert.ok(Number.isFinite(value));
    assert.ok(zoom > 0 && radius > 0 && radiusValue > 0 && width > 0);
    assert.equal(matrix.a, zoom); assert.equal(matrix.d, zoom); assert.equal(matrix.b, 0); assert.equal(matrix.c, 0);
    if (engine === 'local') {
      assert.ok(Number.isFinite(modelZoom) && modelZoom > 0 && Number.isFinite(nativeScale));
      assert.equal(radius, 10 / modelZoom, 'selected local radius uses the public double-precision zoom exactly');
      assert.equal(zoom, nativeScale, 'screen CTM agrees with the actual numeric SVG matrix factory');
      assert.ok(Math.abs(zoom - modelZoom) <= svgRoundingBound(modelZoom), 'SVG zoom differs only by float32 rounding');
    } else assert.equal(radius, 10, 'pinned selected radius stays in graph units');
    assert.ok(Math.abs(radiusValue - radius) <= svgRoundingBound(radius), 'SVG radius value differs only by float32 rounding');
    const expectedWidth = 2 * radiusValue * zoom, widthBound = selectedHitWidthBound(geometry);
    assert.ok(Math.abs(width - expectedWidth) <= widthBound, 'rendered width follows rounded SVG radius, matrix and bounds');
    return { expectedWidth, widthBound };
  } catch (error) {
    error.message += `\nSelected zoom geometry: ${JSON.stringify(geometry)}`;
    throw error;
  }
}
