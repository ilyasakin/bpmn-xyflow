import assert from 'node:assert/strict';

// This fixed list records measured visible-tool locations. A new source-control
// hit elsewhere is a failure, never an automatic selection-parity exception.
export function visibleSourceProbe(name, probe) {
  if (name === 'target-endpoint-interior-0.65' && !probe.ring && [-6, 6, -10, 10, -6.5, 6.5].includes(probe.offset)) return 'Target';
  if (name === 'target-endpoint-interior-1.4' && !probe.ring && [6, -10, 10, -14, 14].includes(probe.offset)) return 'Target';
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
    const port = handle?.querySelector('.bpmn-xyflow-connect-port');
    const hit = handle?.querySelector('.bpmn-xyflow-connect-hit');
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
    const expectedStyle = document.createElementNS('http://www.w3.org/2000/svg', 'circle').style;
    expectedStyle.strokeWidth = String(1.5 / engine.viewport().zoom);
    return {
      owner: handle.getAttribute('data-connect-source'), zoom: engine.viewport().zoom,
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
  assert.equal(down.target.owner, owner); assert.equal(down.target.classes, 'bpmn-xyflow-connect-hit');
  assert.deepEqual(down.queried, down.target, 'actual dispatched press and elementFromPoint agree');
  assertPaintedControl(down.control, owner);
  // Pending Connect removes its control on press. Release can therefore target
  // the underlying shape; the same visible control must be restored afterward.
  assertPaintedControl(local.restoredControl, owner);
  assert.deepEqual(local.restoredControl.center, down.control.center);
}
