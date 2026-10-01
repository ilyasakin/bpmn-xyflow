import assert from 'node:assert/strict';

// Read-only browser evidence. Selected hover controls retain their original hit
// circle above the painted marker; ordinary selected controls paint it below.
// Both must identify the same selected owner/index at the exact visible waypoint.
export function collectSelectedBendpoint({ id, index }) {
  const modeler = window.modeler, container = modeler.getContainer();
  const markers = [...container.querySelectorAll('.bpmn-xyflow-bendpoints .bpmn-xyflow-bendpoint')]
    .filter(node => node.getAttribute('data-element-id') === id && node.getAttribute('data-bend-index') === String(index));
  const marker = markers[0], group = marker?.closest('.bpmn-xyflow-bendpoints');
  const coordinate = (node, key) => node?.hasAttribute(key) ? Number(node.getAttribute(key)) : null;
  const graphPoint = node => ({ x: coordinate(node, 'cx'), y: coordinate(node, 'cy') });
  const screenPoint = (node, point) => {
    const matrix = node?.getScreenCTM();
    if (!matrix || !point) return null;
    const transformed = new DOMPoint(point.x, point.y).matrixTransform(matrix);
    return { x: transformed.x, y: transformed.y };
  };
  const visible = node => {
    if (!node?.isConnected) return false;
    for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) return false;
    }
    return true;
  };
  const box = marker?.getBoundingClientRect();
  const center = box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;
  const containerBox = container.getBoundingClientRect();
  const inside = !!center && center.x >= Math.max(0, containerBox.left) && center.x < Math.min(containerBox.right, window.innerWidth) &&
    center.y >= Math.max(0, containerBox.top) && center.y < Math.min(containerBox.bottom, window.innerHeight);
  const hit = center && document.elementFromPoint(center.x, center.y);
  const style = marker && getComputedStyle(marker);
  const visiblePaint = (color, opacity) => {
    if (!color || color === 'none' || color === 'transparent' || !Number.isFinite(Number(opacity)) || Number(opacity) <= 0) return false;
    // Computed colors use rgba(..., alpha) or a slash alpha in modern CSS.
    // A transparent painted marker must not be rescued by its hit circle.
    let alpha = '1';
    if (color.includes('/')) alpha = color.slice(color.lastIndexOf('/') + 1).replace(/\)\s*$/, '').trim();
    else if (/^rgba\(/i.test(color)) alpha = color.slice(color.lastIndexOf(',') + 1).replace(/\)\s*$/, '').trim();
    const value = alpha.endsWith('%') ? Number(alpha.slice(0, -1)) / 100 : Number(alpha);
    return Number.isFinite(value) && value > 0;
  };
  const painted = !!style && (visiblePaint(style.fill, style.fillOpacity) ||
    (visiblePaint(style.stroke, style.strokeOpacity) && Number.parseFloat(style.strokeWidth) > 0));
  const waypoint = modeler.getElement(id)?.waypoints?.[index];
  const describe = node => ({
    owner: node?.getAttribute('data-element-id'), index: node?.getAttribute('data-bend-index'),
    circle: node?.tagName?.toLowerCase() === 'circle',
    visual: !!node?.classList.contains('bpmn-xyflow-bendpoint'), hit: !!node?.classList.contains('bpmn-xyflow-bendpoint-hit'),
    point: graphPoint(node), center: screenPoint(node, graphPoint(node)), radius: coordinate(node, 'r'),
    visible: visible(node), sameGroup: !!group && node?.closest('.bpmn-xyflow-bendpoints') === group
  });
  return {
    selection: modeler.getSelection(), markerCount: markers.length, zoom: modeler.getViewport().zoom,
    waypoint: waypoint ? { x: waypoint.x, y: waypoint.y } : null,
    waypointScreen: screenPoint(modeler.viewer._internals.viewport, waypoint), center, inside,
    marker: { ...describe(marker), painted, width: box?.width, height: box?.height }, actual: describe(hit)
  };
}

export function assertSelectedBendpoint(evidence, id, index) {
  const finitePoint = point => !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
  const sameScreenPoint = (actual, expected) => assert.ok(finitePoint(actual) && finitePoint(expected) &&
    Math.hypot(actual.x - expected.x, actual.y - expected.y) < 0.0001, 'control center is the visible waypoint');
  assert.ok(Number.isInteger(index) && index >= 0);
  assert.deepEqual(evidence.selection, [id], 'the intended connection is the sole selection');
  assert.equal(evidence.markerCount, 1, 'one painted selected marker identifies the waypoint');
  assert.equal(evidence.inside, true, 'the chosen visible point is inside the canvas and browser viewport');
  assert.ok(Number.isFinite(evidence.zoom) && evidence.zoom > 0);
  assert.ok(finitePoint(evidence.waypoint));
  for (const control of [evidence.marker, evidence.actual]) {
    assert.equal(control.owner, id, 'control belongs to the intended connection');
    assert.equal(control.index, String(index), 'control identifies the intended waypoint');
    assert.equal(control.circle, true); assert.equal(control.sameGroup, true);
    assert.equal(control.visible, true, 'control and its selected group are visible');
    assert.notEqual(control.visual, control.hit, 'only the painted marker or its matching hit circle is accepted');
    assert.deepEqual(control.point, evidence.waypoint, 'control geometry exactly matches the current waypoint');
    assert.ok(Number.isFinite(control.radius));
    assert.equal(control.radius, control.visual ? 4 : 10 / evidence.zoom);
    sameScreenPoint(control.center, evidence.waypointScreen);
  }
  assert.equal(evidence.marker.visual, true); assert.equal(evidence.marker.painted, true);
  assert.ok(Number.isFinite(evidence.marker.width) && evidence.marker.width > 0);
  assert.ok(Number.isFinite(evidence.marker.height) && evidence.marker.height > 0);
  sameScreenPoint(evidence.center, evidence.waypointScreen);
  return evidence.center;
}

export async function selectedBendpoint(page, id, index) {
  await page.waitForFunction(({ id, index }) => [...window.modeler.getContainer()
    .querySelectorAll('.bpmn-xyflow-bendpoints .bpmn-xyflow-bendpoint')]
    .some(node => node.getAttribute('data-element-id') === id && node.getAttribute('data-bend-index') === String(index)),
  { timeout: 10000 }, { id, index });
  const evidence = await page.evaluate(collectSelectedBendpoint, { id, index });
  try { return assertSelectedBendpoint(evidence, id, index); }
  catch (error) { error.message += `\nSelected bendpoint evidence: ${JSON.stringify(evidence)}`; throw error; }
}
