import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { loadRuleModule } from '../helpers/upstream-rules.mjs';
import { BpmnModdle } from '../../lib/bpmn/moddle.js';

const { normalizeLogicalDocking, layoutConnection, remapDocking, cropConnection, projectDocking } = await loadRuleModule('lib/modeling/ConnectionRouting.js');
const { default: ImportDockingFix } = await loadRuleModule('node_modules/bpmn-js/lib/features/modeling/behavior/ImportDockingFix.js');
const { default: Renderer } = await loadRuleModule('lib/draw/BpmnRenderer.js');
const { default: Layouter } = await loadRuleModule('node_modules/bpmn-js/lib/features/modeling/BpmnLayouter.js');
const require = createRequire(import.meta.url), referenceRequire = createRequire(require.resolve('bpmn-js/package.json'));
const diagramPackage = referenceRequire.resolve('diagram-js/package.json');
assert.equal(referenceRequire('diagram-js/package.json').version, '15.27.1');
const { default: Docking } = await loadRuleModule(path.join(path.dirname(diagramPackage), 'lib/layout/CroppingConnectionDocking.js'));
const renderer = { getShapePath: Renderer.prototype.getShapePath };
const moddle = new BpmnModdle();
const shape = (type, x, y, width, height) => ({ type: `bpmn:${type}`, businessObject: moddle.create(`bpmn:${type}`), di: {}, x, y, width, height });
const xy = points => points.map(({ x, y }) => ({ x, y }));
const center = shape => ({ x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 });

function reference(points, source, target) {
  let added;
  new ImportDockingFix({ on(event, callback) { assert.equal(event, 'bpmnElement.added'); added = callback; } });
  const edge = { waypoints: structuredClone(points), source, target };
  added({ element: edge });
  return edge.waypoints;
}

test('logical endpoints follow the actual pinned import center-cross construction without rounding visible DI', () => {
  const source = shape('Task', 10.125, 20.25, 100, 80), target = shape('EndEvent', 259, 101, 36, 36);
  for (const points of [
    [{ x: 110.125, y: 41.75 }, { x: 200, y: 41.75 }, { x: 200, y: 109.37218800914619 }, { x: 261.7912776253634, y: 109.37218800914619 }],
    [{ x: 60.125, y: 20.25 }, { x: 60.125, y: -30 }, { x: 270.25, y: -30 }, { x: 270.25, y: 102.3139280194706 }],
    [{ x: 110.125, y: 50.25 }, { x: 264.27207793864216, y: 106.27207793864214 }],
  ]) {
    const before = structuredClone(points), actual = normalizeLogicalDocking(points, source, target), expected = reference(points, source, target);
    assert.deepEqual(points, before); assert.deepEqual(xy(actual), points);
    for (const index of [0, points.length - 1]) {
      assert.notEqual(actual[index], points[index]);
      for (const axis of ['x', 'y']) assert.ok(Math.abs(actual[index].original[axis] - expected[index].original[axis]) <= .5);
    }
  }
});

test('logical seeding preserves intentional originals, metadata, owned-edge endpoints and duplicate terminal legs', () => {
  const source = shape('Task', 0, 0, 100, 80), target = shape('EndEvent', 259, 101, 36, 36);
  const points = [{ x: 100, y: 20, vendor: 'source', original: { x: 62.25, y: 20, vendor: 'logical' } },
    { x: 100, y: 20 }, { x: 200, y: 20, vendor: 'bend' }, { x: 200, y: 119 }, { x: 259, y: 119 }, { x: 259, y: 119 }];
  const before = structuredClone(points), actual = normalizeLogicalDocking(points, source, target);
  assert.deepEqual(points, before); assert.deepEqual(actual[0], before[0]); assert.notEqual(actual[0].original, points[0].original);
  assert.deepEqual(actual.at(-1).original, center(target)); assert.deepEqual(actual.slice(1, -1), points.slice(1, -1));
  const owner = { waypoints: [{ x: 1, y: 2 }, { x: 3, y: 4 }] };
  assert.deepEqual(normalizeLogicalDocking([{ x: 2, y: 3 }, { x: 259, y: 119 }], owner, target)[0], { x: 2, y: 3 });
  const sparse = []; sparse.length = 2; sparse[1] = { x: 2, y: 3 };
  for (const route of [[null, { x: 2, y: 3 }], sparse, [{ x: 1, y: 2, original: { x: Infinity, y: 1 } }, { x: 2, y: 3 }]])
    assert.throws(() => normalizeLogicalDocking(route, source, target), error => error.code === 'UNROUTABLE_DOCKING');
  assert.deepEqual(normalizeLogicalDocking([{ x: 1, y: 2 }, { x: 1, y: 2 }], source, target), [{ x: 1, y: 2 }, { x: 1, y: 2 }]);
  for (const malformed of [{ ...source, x: Infinity }, { ...source, x: 1.5e308, width: 1.5e308 }, { ...source, width: 0 }])
    assert.throws(() => layoutConnection({ source: malformed, target, waypoints: points }, { connectionStart: { x: Infinity, y: 10 } }), error => error.code === 'UNROUTABLE_DOCKING');
});

function hasInterior(a, b, shape) {
  const c = center(shape), vx = b.x - a.x, vy = b.y - a.y;
  if (shape.type.endsWith('Event')) {
    const t = Math.max(0, Math.min(1, ((c.x - a.x) * vx + (c.y - a.y) * vy) / (vx * vx + vy * vy || 1)));
    return Math.hypot(a.x + t * vx - c.x, a.y + t * vy - c.y) < shape.width / 2 - 1e-7;
  }
  // Both the diamond and rectangular interior are convex intersections of
  // half-planes. Clip the segment to their strict interior independently of
  // the production route/crop helpers.
  const planes = shape.type.endsWith('Gateway')
    ? [[1 / (shape.width / 2), 1 / (shape.height / 2), 1], [1 / (shape.width / 2), -1 / (shape.height / 2), 1], [-1 / (shape.width / 2), 1 / (shape.height / 2), 1], [-1 / (shape.width / 2), -1 / (shape.height / 2), 1]]
    : [[1, 0, shape.width / 2 - 10], [-1, 0, shape.width / 2 - 10], [0, 1, shape.height / 2], [0, -1, shape.height / 2]];
  let low = 0, high = 1;
  for (const [nx, ny, limit] of planes) {
    const offset = nx * (a.x - c.x) + ny * (a.y - c.y), rate = nx * vx + ny * vy, inside = limit - 1e-7;
    if (!rate) { if (offset >= inside) return false; }
    else if (rate > 0) high = Math.min(high, (inside - offset) / rate);
    else low = Math.max(low, (inside - offset) / rate);
  }
  return low < high;
}
function clear(points, source, target) {
  for (let i = 1; i < points.length; i++) for (const endpoint of [source, target])
    assert.equal(hasInterior(points[i - 1], points[i], endpoint), false, JSON.stringify({ points: xy(points), endpoint }));
}

for (const type of ['EndEvent', 'ExclusiveGateway']) test(`${type}: moved source can change docking side without crossing either endpoint interior`, () => {
  const before = shape('Task', 80, 79, 100, 80), target = type === 'EndEvent' ? shape(type, 259, 101, 36, 36) : shape(type, 252, 94, 50, 50);
  const y = 109.37218800914619, x = type === 'EndEvent' ? 277 - Math.sqrt(18 ** 2 - (y - 119) ** 2) : 252 + Math.abs(y - 119);
  for (const manual of [false, true]) for (const delta of [{ x: 20, y: 40 }, { x: 0, y: -100 }, { x: 400, y: 0 }]) {
    const raw = manual ? [{ x: 180, y: 119 }, { x: 205, y: 119 }, { x: 205, y: 170 }, { x: 230, y: 170 }, { x: 230, y }, { x, y }]
      : [{ x: 180, y }, { x, y }];
    const snapshot = structuredClone(raw), points = normalizeLogicalDocking(raw, before, target), source = { ...before, x: before.x + delta.x, y: before.y + delta.y };
    const start = remapDocking(points[0], before, source).original;
    const result = layoutConnection({ source, target, type: 'bpmn:SequenceFlow', waypoints: points }, { connectionStart: start }, renderer);
    clear(result, source, target); assert.deepEqual(raw, snapshot);
    const end = result.at(-1), c = center(target);
    const onOutline = type === 'EndEvent' ? Math.hypot(end.x - c.x, end.y - c.y) / 18 : Math.abs(end.x - c.x) / 25 + Math.abs(end.y - c.y) / 25;
    assert.ok(Math.abs(onOutline - 1) < 1e-8);
    if (delta.x === 400) assert.ok(end.x > c.x, 'crossover legitimately redocks on the right');
  }
});

test('explicit create and redock coordinates stay precise while future moves have interior originals', () => {
  const source = shape('Task', 136, 80, 100, 80), target = shape('EndEvent', 259, 101, 36, 36);
  const start = { x: 236, y: 120 }, end = { x: 261.7912776253634, y: 109.37218800914619 };
  const points = layoutConnection({ source, target, type: 'bpmn:SequenceFlow', waypoints: [] }, { connectionStart: start, connectionEnd: end, preserveDocking: 'both' }, renderer);
  assert.deepEqual(xy([points[0], points.at(-1)]), [start, end]);
  assert.deepEqual(points[0].original, { x: 186, y: 120 }); assert.deepEqual(points.at(-1).original, { x: 277, y: end.y });
  assert.deepEqual(projectDocking(shape('Task', 800, 100, 100, 80), { x: 899.9999999999999, y: 130 }), { x: 900, y: 130 }, 'axis-aligned borders still snap transformed pointer roundoff exactly');
  const invalid = structuredClone(points); invalid.at(-1).original.x = NaN;
  assert.throws(() => cropConnection(invalid, source, target), error => error.code === 'UNROUTABLE_DOCKING');
  const authored = [{ x: 350, y: 300, original: { x: 300, y: 330 } }, { x: 500, y: 390 }, { x: 650, y: 300, original: { x: 700, y: 270, note: 'authored opposite' }, note: 'visible metadata' }];
  const oldSource = shape('Task', 250, 260, 100, 80), oldTarget = shape('Task', 650, 260, 100, 80), newSource = shape('Task', 450, 50, 100, 80);
  const redocked = layoutConnection({ source: oldSource, target: oldTarget, type: 'bpmn:SequenceFlow', waypoints: authored },
    { source: newSource, connectionStart: { x: 550, y: 90 }, connectionEnd: authored.at(-1), preserveDocking: 'both' }, renderer);
  assert.deepEqual(redocked.at(-1), authored.at(-1), 'unchanged opposite logical docking and metadata survive explicit route rebuilding');
});

test('circle/diamond terminal repair is symmetric under all rotations and either connection direction', () => {
  for (const type of ['IntermediateThrowEvent', 'ExclusiveGateway']) for (const reverse of [false, true]) for (let turn = 0; turn < 4; turn++) {
    const rotate = point => { let { x, y } = point; for (let i = 0; i < turn; i++) [x, y] = [-y, x]; return { x, y }; };
    const rotateShape = item => {
      const corners = [rotate(item), rotate({ x: item.x + item.width, y: item.y + item.height })];
      return { ...item, x: Math.min(...corners.map(p => p.x)), y: Math.min(...corners.map(p => p.y)), width: Math.abs(corners[0].x - corners[1].x), height: Math.abs(corners[0].y - corners[1].y) };
    };
    const old = rotateShape(shape('Task', 80, 79, 100, 80)), curved = rotateShape(type.endsWith('Event') ? shape(type, 259, 101, 36, 36) : shape(type, 252, 94, 50, 50));
    const y = 109.37218800914619, x = type.endsWith('Event') ? 277 - Math.sqrt(18 ** 2 - (y - 119) ** 2) : 252 + Math.abs(y - 119);
    const raw = [{ x: 180, y: 119 }, { x: 205, y: 119 }, { x: 205, y: 170 }, { x: 230, y: 170 }, { x: 230, y }, { x, y }].map(rotate);
    if (reverse) raw.reverse();
    const points = normalizeLogicalDocking(raw, reverse ? curved : old, reverse ? old : curved), delta = rotate({ x: 400, y: 0 });
    const task = { ...old, x: old.x + delta.x, y: old.y + delta.y }, source = reverse ? curved : task, target = reverse ? task : curved;
    const moved = remapDocking(points[reverse ? points.length - 1 : 0], old, task);
    const result = layoutConnection({ source, target, type: 'bpmn:SequenceFlow', waypoints: points }, { [reverse ? 'connectionEnd' : 'connectionStart']: moved.original }, renderer);
    clear(result, source, target);
    const endpoint = result[reverse ? 0 : result.length - 1], c = center(curved);
    assert.ok((endpoint.x - c.x) * delta.x + (endpoint.y - c.y) * delta.y > 0, 'redocking faces the moved task');
  }
});

test('boundary-host and corner layouts keep the full pinned layouter/cropping contract', () => {
  const layouter = new Layouter({ find() {} }), docking = new Docking({}, {
    getShapePath: renderer.getShapePath,
    getConnectionPath: edge => edge.waypoints.map((p, i) => { const logical = p.original || p; return `${i ? 'L' : 'M'}${logical.x},${logical.y}`; }).join(''),
  });
  let cases = 0;
  for (const isHorizontal of [true, false]) {
    const parent = shape('Participant', 0, 0, 800, 700); parent.di.isHorizontal = isHorizontal;
    const host = shape('Task', 300, 300, 100, 80); host.parent = parent;
    for (const [cx, cy] of [[300, 300], [350, 300], [400, 300], [400, 340], [400, 380], [350, 380], [300, 380], [300, 340]]) {
      const source = shape('BoundaryEvent', cx - 18, cy - 18, 36, 36); source.host = host; source.parent = parent;
      for (const target of [host, ...[[100, 100], [350, 100], [600, 100], [600, 300], [600, 500], [350, 500], [100, 500], [100, 300]].map(([x, y]) => shape('Task', x, y, 100, 80))]) {
        target.parent = parent;
        const edge = { source, target, type: 'bpmn:SequenceFlow', businessObject: moddle.create('bpmn:SequenceFlow'), waypoints: [] };
        const expected = docking.getCroppedWaypoints({ ...edge, waypoints: layouter.layoutConnection(edge) }), actual = layoutConnection(edge, {}, renderer);
        assert.equal(actual.length, expected.length, JSON.stringify({ cx, cy, target: bounds(target), isHorizontal }));
        for (let i = 0; i < actual.length; i++) for (const axis of ['x', 'y'])
          assert.ok(Math.abs(actual[i][axis] - expected[i][axis]) <= (i === 0 || i === actual.length - 1 ? .51 : 1e-8), 'only pinned endpoint rounding differs');
        cases++;
      }
    }
  }
  assert.equal(cases, 144);
});

function bounds(shape) { return { x: shape.x, y: shape.y, width: shape.width, height: shape.height }; }

test('automatic overlapping Task layout selects exposed ports while explicit inaccessible ports still refuse', () => {
  const source = shape('ServiceTask', 500, 415, 120, 80), target = shape('Task', 540, 480, 100, 80);
  const edge = { source, target, type: 'bpmn:SequenceFlow', businessObject: moddle.create('bpmn:SequenceFlow'), waypoints: [] };
  const actual = layoutConnection(edge, {}, renderer);
  assert.ok(actual.length >= 4); clear(actual, source, target);
  const expected = new Layouter({ find() {} }).layoutConnection(edge);
  const docking = new Docking({}, { getShapePath: renderer.getShapePath,
    getConnectionPath: edge => edge.waypoints.map((p, i) => { const q = p.original || p; return `${i ? 'L' : 'M'}${q.x},${q.y}`; }).join('') });
  const reference = docking.getCroppedWaypoints({ ...edge, waypoints: expected });
  assert.deepEqual(xy(reference), [{ x: 560, y: 415 }, { x: 560, y: 395 }, { x: 590, y: 395 }, { x: 590, y: 480 }]);
  assert.ok(reference.slice(1).some((p, i) => hasInterior(reference[i], p, source)), 'reference connection is allowed but its automatic route crosses the overlapping source');
  assert.throws(() => layoutConnection(edge, { connectionStart: { x: 600, y: 495 }, connectionEnd: { x: 540, y: 490 }, preserveDocking: 'both' }, renderer), error => error.code === 'UNROUTABLE_DOCKING');
});
