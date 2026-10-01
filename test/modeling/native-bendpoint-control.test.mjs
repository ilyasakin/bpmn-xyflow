import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertSelectedBendpoint, collectSelectedBendpoint } from '../helpers/native-bendpoint-control.mjs';

// Assertion-policy tests, not browser hit-test evidence. The native suites
// collect these fields from the visible SVG and the actual elementFromPoint.
function evidence(zoom, promoted) {
  const point = { x: 430.125, y: 240.75 }, center = { x: 160 + point.x * zoom, y: 120 + point.y * zoom };
  const marker = { owner: 'Flow', index: '1', circle: true, visual: true, hit: false, point,
    center, radius: 4, visible: true, sameGroup: true, painted: true, width: 8 * zoom, height: 8 * zoom };
  return { selection: ['Flow'], markerCount: 1, zoom, waypoint: point, waypointScreen: center, center, inside: true,
    marker, actual: promoted ? { ...marker, visual: false, hit: true, radius: 10 / zoom } : { ...marker } };
}

for (const zoom of [.2, 1, 3]) for (const promoted of [false, true]) {
  test(`selected ${promoted ? 'promoted hit' : 'painted marker'} at zoom ${zoom} keeps exact owner and waypoint`, () => {
    const value = evidence(zoom, promoted), before = structuredClone(value);
    assert.deepEqual(assertSelectedBendpoint(value, 'Flow', 1), value.center);
    assert.deepEqual(value, before, 'validation never alters geometry');
  });
}

test('selected control validation rejects unrelated, hidden, displaced and malformed evidence', () => {
  const corruptions = [
    value => { value.selection = ['Other']; },
    value => { value.selection.push('Other'); },
    value => { value.markerCount = 0; },
    value => { value.markerCount = 2; },
    value => { value.inside = false; },
    value => { value.marker.painted = false; },
    value => { value.marker.width = 0; },
    value => { value.marker.height = NaN; },
    value => { value.zoom = 0; },
    value => { value.zoom = Infinity; },
    value => { value.center = { x: value.center.x + 1, y: value.center.y }; },
    value => { value.waypointScreen = null; }
  ];
  for (const field of ['marker', 'actual']) corruptions.push(
    value => { value[field].owner = 'Other'; },
    value => { value[field].index = '2'; },
    value => { value[field].circle = false; },
    value => { value[field].sameGroup = false; },
    value => { value[field].visible = false; },
    value => { value[field].radius += .1; },
    value => { value[field].radius = NaN; },
    value => { value[field].point = { x: 430.125, y: 241.75 }; },
    value => { value[field].center = { x: NaN, y: 0 }; },
    value => { value[field].center = { x: value[field].center.x + 1, y: value[field].center.y }; },
    value => { value[field].visual = false; value[field].hit = false; },
    value => { value[field].visual = true; value[field].hit = true; }
  );
  for (const zoom of [.2, 1, 3]) for (const promoted of [false, true]) for (const corrupt of corruptions) {
    const value = structuredClone(evidence(zoom, promoted)); corrupt(value);
    assert.throws(() => assertSelectedBendpoint(value, 'Flow', 1), assert.AssertionError);
  }
});

test('collector rejects transparent paint and hidden ancestors using computed styles', () => {
  // Only this collector boundary is mocked; this is not native SVG evidence.
  const originals = new Map(['window', 'document', 'getComputedStyle', 'DOMPoint'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const point = { x: 430.125, y: 240.75 }, zoom = .2;
  const matrix = { a: zoom, b: 0, c: 0, d: zoom, e: 160, f: 120 };
  const group = { isConnected: true, parentElement: null, style: { display: 'inline', visibility: 'visible', opacity: '1' } };
  const makeCircle = (name, radius) => ({
    isConnected: true, parentElement: group, tagName: 'circle',
    style: { display: 'inline', visibility: 'visible', opacity: '1', fill: 'rgb(255, 255, 255)', fillOpacity: '1', stroke: 'none', strokeOpacity: '1', strokeWidth: '1px' },
    classList: { contains: candidate => candidate === name },
    getAttribute: key => ({ 'data-element-id': 'Flow', 'data-bend-index': '1', cx: String(point.x), cy: String(point.y), r: String(radius) })[key] ?? null,
    hasAttribute: key => ['data-element-id', 'data-bend-index', 'cx', 'cy', 'r'].includes(key),
    closest: () => group,
    getScreenCTM: () => matrix,
    getBoundingClientRect: () => ({ x: 160 + (point.x - radius) * zoom, y: 120 + (point.y - radius) * zoom, width: 2 * radius * zoom, height: 2 * radius * zoom })
  });
  const marker = makeCircle('bpmn-xyflow-bendpoint', 4), hit = makeCircle('bpmn-xyflow-bendpoint-hit', 10 / zoom);
  const modeler = { getContainer: () => ({ querySelectorAll: () => [marker], getBoundingClientRect: () => ({ left: 0, top: 0, right: 1800, bottom: 1200 }) }), getElement: () => ({ waypoints: [null, point] }),
    getSelection: () => ['Flow'], getViewport: () => ({ zoom }), viewer: { _internals: { viewport: { getScreenCTM: () => matrix } } } };
  try {
    Object.assign(globalThis, { window: { modeler, innerWidth: 1800, innerHeight: 1200 }, document: { elementFromPoint: () => hit }, getComputedStyle: node => node.style,
      DOMPoint: class { constructor(x, y) { this.x = x; this.y = y; } matrixTransform(m) { return { x: m.a * this.x + m.c * this.y + m.e, y: m.b * this.x + m.d * this.y + m.f }; } } });
    const collect = () => collectSelectedBendpoint({ id: 'Flow', index: 1 });
    assertSelectedBendpoint(collect(), 'Flow', 1);
    for (const fill of ['transparent', 'none', 'rgba(255, 255, 255, 0)', 'rgb(255 255 255 / 0)', 'color(srgb 1 1 1 / 0%)']) {
      marker.style.fill = fill;
      assert.equal(collect().marker.painted, false, fill);
      assert.throws(() => assertSelectedBendpoint(collect(), 'Flow', 1), assert.AssertionError);
    }
    marker.style.fill = 'rgba(255, 255, 255, 0)'; marker.style.stroke = 'rgba(0, 0, 255, 0)';
    assert.equal(collect().marker.painted, false, 'transparent outline cannot rescue transparent fill');
    marker.style.stroke = 'rgba(0, 0, 255, 0.5)'; assertSelectedBendpoint(collect(), 'Flow', 1);
    for (const [key, hidden] of [['display', 'none'], ['visibility', 'hidden'], ['opacity', '0']]) {
      const prior = group.style[key]; group.style[key] = hidden;
      assert.equal(collect().marker.visible, false); assert.equal(collect().actual.visible, false);
      assert.throws(() => assertSelectedBendpoint(collect(), 'Flow', 1), assert.AssertionError); group.style[key] = prior;
    }
  } finally {
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
});
