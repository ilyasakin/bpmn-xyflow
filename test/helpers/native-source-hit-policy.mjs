import assert from 'node:assert/strict';

// This fixed list records measured visible-tool locations. A new source-control
// hit elsewhere is a failure, never an automatic selection-parity exception.
export function visibleSourceProbe(name, probe) {
  if (name === 'target-endpoint-interior-0.65' && !probe.ring && [-6, 6, -10, 10, -6.5, 6.5].includes(probe.offset)) return 'Target';
  if (name === 'target-endpoint-interior-1.4' && !probe.ring && [6, -10, 10, -14, 14].includes(probe.offset)) return 'Target';
  if (name === 'exclusiveGateway-crossing-0.2' && !probe.ring && [-6, 6].includes(probe.offset)) return 'Crossing';
  if (name === 'booking-attached-boundary' && probe.ring === true && probe.offset === 0) return 'FlightTimeout';
  return null;
}

// Serialized by Puppeteer. All dependencies deliberately live inside this
// function, and observers return void so they cannot alter event propagation.
export function installNativeSourceHitCapture() {
  const engine = window.hitEngine;
  const describe = target => ({
    id: target?.closest?.('[data-element-id]')?.getAttribute('data-element-id') || null,
    owner: target?.closest?.('.bpmn-xyflow-connect-handle')?.getAttribute('data-connect-source') || null,
    classes: target?.getAttribute?.('class') || null,
  });
  const visiblePaint = (color, opacity) => {
    if (!color || color === 'none' || color === 'transparent' || !(Number(opacity) > 0)) return false;
    let alpha = '1';
    if (color.includes('/')) alpha = color.slice(color.lastIndexOf('/') + 1).replace(/\)\s*$/, '').trim();
    else if (/^rgba\(/i.test(color)) alpha = color.slice(color.lastIndexOf(',') + 1).replace(/\)\s*$/, '').trim();
    return (alpha.endsWith('%') ? Number(alpha.slice(0, -1)) / 100 : Number(alpha)) > 0;
  };
  const control = (target, point) => {
    const handle = target?.closest?.('.bpmn-xyflow-connect-handle');
    if (!handle) return null;
    const fixed = target?.closest?.('.bpmn-xyflow-connect-fixed-anchor');
    const port = fixed || handle?.querySelector('.bpmn-xyflow-connect-port');
    const hit = fixed || handle?.querySelector('.bpmn-xyflow-connect-hit');
    if (!port || !hit) return null;
    const matrix = port.getScreenCTM(), style = getComputedStyle(port);
    const local = new DOMPoint(point.x, point.y).matrixTransform(matrix.inverse());
    const rect = port.getBoundingClientRect();
    let visible = rect.width > 0 && rect.height > 0;
    for (let element = port; element && visible; element = element.parentElement) {
      const s = getComputedStyle(element);
      visible = s.display !== 'none' && s.visibility === 'visible' && Number(s.opacity) > 0;
    }
    const inFill = port.isPointInFill(local), inStroke = port.isPointInStroke(local);
    // CSSOM serializes lengths at browser precision; compare against its own
    // detached canonical representation of the exact prescribed stroke.
    // tiny-svg writes numeric stroke widths as px lengths, not unitless values.
    const expectedStyle = document.createElementNS('http://www.w3.org/2000/svg', 'circle').style;
    expectedStyle.strokeWidth = `${(fixed ? 1 : 1.5) / engine.viewport().zoom}px`;
    const owner = handle.getAttribute('data-connect-source'), node = fixed && engine.node(owner);
    return {
      owner, zoom: engine.viewport().zoom, kind: fixed ? 'fixed-marker' : 'grab',
      ...(fixed ? { index: Number(fixed.getAttribute('data-anchor-index')), tag: fixed.tagName.toLowerCase(),
        ownerShape: { id: node.id, type: node.type, x: node.x, y: node.y, width: node.width, height: node.height },
        screenMatrix: Object.fromEntries(['a','b','c','d','e','f'].map(key => [key, matrix[key]])) } : {}),
      center: { x: Number(port.getAttribute('cx')), y: Number(port.getAttribute('cy')) },
      hitCenter: { x: Number(hit.getAttribute('cx')), y: Number(hit.getAttribute('cy')) },
      localPoint: { x: local.x, y: local.y },
      radius: Number(port.getAttribute('r')), strokeWidth: parseFloat(port.style.strokeWidth),
      strokeWidthCSS: port.style.strokeWidth, expectedStrokeWidthCSS: expectedStyle.strokeWidth,
      hitRadius: Number(hit.getAttribute('r')), hitPointerEvents: getComputedStyle(hit).pointerEvents,
      visible, paintedAtPoint: (inFill && visiblePaint(style.fill, style.fillOpacity)) || (inStroke && visiblePaint(style.stroke, style.strokeOpacity)),
      fill: style.fill, stroke: style.stroke,
      inFill, inStroke,
    };
  };
  const capture = { events: [], describe, control };
  window.nativeHitCapture = capture;
  for (const type of ['mousemove', 'mousedown', 'mouseup']) document.addEventListener(type, event => {
    if (!engine.container.contains(event.target)) return;
    const point = { x: event.clientX, y: event.clientY };
    capture.events.push({ type, trusted: event.isTrusted, point, target: describe(event.target),
      queried: describe(document.elementFromPoint(point.x, point.y)), control: control(event.target, point) });
  }, true);
}

function assertPaintedControl(control, owner) {
  assert.ok(control, 'native press must expose its actual source-control geometry');
  assert.equal(control.owner, owner);
  assert.ok(Number.isFinite(control.zoom) && control.zoom > 0);
  assert.equal(control.radius, 5 / control.zoom, 'painted radius retains five CSS pixels');
  assert.equal(control.strokeWidthCSS, control.expectedStrokeWidthCSS, 'stroke matches native CSSOM serialization of 1.5 CSS pixels');
  assert.equal(control.strokeWidth, parseFloat(control.strokeWidthCSS));
  assert.ok(Number.isFinite(control.strokeWidth) && control.strokeWidth > 0);
  assert.equal(control.hitRadius, 5.75 / control.zoom, 'hit radius is exactly coextensive with painted fill and stroke');
  assert.equal(control.hitPointerEvents, 'all');
  assert.deepEqual(control.hitCenter, control.center);
  assert.equal(control.visible, true);
  assert.equal(control.paintedAtPoint, true, 'actual visible fill/stroke covers the delivered point');
  assert.ok(control.fill && control.fill !== 'none' && control.fill !== 'transparent');
  assert.ok(control.stroke && control.stroke !== 'none' && control.stroke !== 'transparent');
  for (const p of [control.center, control.localPoint]) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  assert.ok(Math.hypot(control.localPoint.x - control.center.x, control.localPoint.y - control.center.y) <= control.radius + control.strokeWidth / 2,
    'delivered pointer lies inside actual visible paint, not invisible padding');
  assert.ok(control.inFill || control.inStroke, 'native SVG paint query must agree');
}

function assertPaintedFixedMarker(control, index, point) {
  assert.ok(control, 'native marker press exposes its own paint rather than displaced-grab geometry');
  assert.equal(control.kind, 'fixed-marker'); assert.equal(control.tag, 'circle');
  assert.equal(control.owner, 'Crossing'); assert.equal(control.zoom, .2); assert.equal(control.index, index);
  assert.deepEqual(control.ownerShape, { id: 'Crossing', type: 'bpmn:ExclusiveGateway', x: 405, y: 215, width: 50, height: 50 });
  const center = { x: 430, y: index === 0 ? 215 : 265 };
  assert.deepEqual(control.center, center); assert.deepEqual(control.hitCenter, center);
  assert.equal(control.radius, 2 / control.zoom, 'fixed marker retains its two-CSS-pixel fill radius');
  assert.equal(control.hitRadius, control.radius, 'the hit-tested element is the painted marker itself');
  assert.equal(control.hitPointerEvents, 'visiblepainted');
  assert.equal(control.strokeWidthCSS, control.expectedStrokeWidthCSS);
  assert.equal(control.strokeWidth, 1 / control.zoom, 'fixed marker stroke is exactly one CSS pixel');
  assert.equal(control.visible, true); assert.equal(control.paintedAtPoint, true);
  assert.ok(control.inFill || control.inStroke, 'actual native SVG paint contains the delivered point');
  assert.ok(control.fill && !['none','transparent'].includes(control.fill));
  assert.ok(control.stroke && !['none','transparent'].includes(control.stroke));
  const p = control.localPoint, matrix = control.screenMatrix;
  assert.ok(p && Number.isFinite(p.x) && Number.isFinite(p.y));
  for (const key of ['a','b','c','d','e','f']) assert.ok(Number.isFinite(matrix?.[key]));
  assert.ok(matrix.a*matrix.d-matrix.b*matrix.c !== 0, 'native transform is invertible');
  for (const [axis, terms] of [['x',[matrix.a*p.x,matrix.c*p.y,matrix.e]],['y',[matrix.b*p.x,matrix.d*p.y,matrix.f]]]) {
    const projected = terms.reduce((a,b)=>a+b,0), roundoff = 32*Number.EPSILON*Math.max(1,...terms.map(Math.abs),Math.abs(point[axis]));
    assert.ok(Math.abs(projected-point[axis]) <= roundoff, 'native local paint query belongs to the exact delivered client point');
  }
  assert.ok(Math.hypot(p.x-center.x,p.y-center.y) <= control.radius+control.strokeWidth/2,
    'marker press lies inside its painted2.5CSS extent, never a widened approach region');
}

export function assertVisibleSourceProbe(name, upstream, local) {
  const owner = visibleSourceProbe(name, upstream);
  assert.ok(owner, 'only a named measured visible-tool probe can differ');
  assert.deepEqual(upstream.selection, [owner], 'pinned upstream selects the exact underlying shape');
  assert.equal(upstream.target.id, owner);
  assert.deepEqual(local.selection, [], 'stationary visible source-tool press preserves empty selection');
  assert.deepEqual(local.selectionBefore, []);
  assert.deepEqual(local.historyAfter, local.historyBefore, 'stationary source-tool press adds no history');
  const downs = local.input.filter(e => e.type === 'mousedown'), ups = local.input.filter(e => e.type === 'mouseup');
  assert.equal(downs.length, 1); assert.equal(ups.length, 1);
  const down = downs[0], up = ups[0];
  assert.equal(down.trusted, true); assert.equal(up.trusted, true);
  assert.deepEqual(up.point, down.point, 'stationary native release uses the delivered press coordinates');
  const fixed = name === 'exclusiveGateway-crossing-0.2';
  if (fixed) assert.deepEqual(down.point, { x: 226, y: upstream.offset === -6 ? 190 : 202 }, 'exact measured fixed-marker native press');
  assert.equal(down.target.owner, owner); assert.equal(down.target.classes, fixed ? 'bpmn-xyflow-connect-fixed-anchor' : 'bpmn-xyflow-connect-hit');
  assert.deepEqual(down.queried, down.target, 'actual dispatched press and elementFromPoint agree');
  const assertControl = control => fixed
    ? assertPaintedFixedMarker(control, upstream.offset === -6 ? 0 : 2, down.point)
    : assertPaintedControl(control, owner);
  assertControl(down.control);
  // Pending Connect removes its control on press. Release can therefore target
  // the underlying shape; the same visible control must be restored afterward.
  assertControl(local.restoredControl);
  assert.deepEqual(local.restoredControl.center, down.control.center);
}
