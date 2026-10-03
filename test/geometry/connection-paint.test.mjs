import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Window } from 'happy-dom';
import { loadRuleModule } from '../helpers/upstream-rules.mjs';

const window = new Window();
globalThis.window = window;
globalThis.document = window.document;
const { connectionPath } = await loadRuleModule('lib/draw/ConnectionPath.js');
const { layoutConnection } = await loadRuleModule('lib/modeling/ConnectionRouting.js');
const require = createRequire(import.meta.url);
const reference = createRequire(require.resolve('bpmn-js/package.json'));
assert.equal(reference('diagram-js/package.json').version, '15.27.1');
const { createLine } = await loadRuleModule(path.join(path.dirname(reference.resolve('diagram-js/package.json')), 'lib/util/RenderUtil.js'));
test.after(() => window.happyDOM.close());

// An independent SVG command reader: monotone control polygons imply monotone
// cubic curves, and also expose backwards straight pieces between corners.
const commands = value => [...value.matchAll(/([MLC])([^MLC]+)/g)].map(([,kind,body]) => ({
  kind, points: body.split(',').map(Number).reduce((out, number, index, values) =>
    index % 2 ? out : [...out, { x: number, y: values[index + 1] }], [])
}));
function monotone(value, direction) {
  const points = commands(value).flatMap(command => command.points);
  for (let i = 1; i < points.length; i++) for (const axis of ['x', 'y']) {
    const bound = 8 * Number.EPSILON * Math.max(1, Math.abs(points[i][axis]), Math.abs(points[i - 1][axis]));
    const delta = (points[i][axis] - points[i - 1][axis]) * direction[axis];
    assert.ok(delta >= -bound, `paint reverses ${axis}: ${value}`);
  }
}

test('actual native one-pixel Gateway→Task wrinkle is shared by pinned renderer and corrected without changing waypoints', () => {
  const points = [{ x: 615, y: 232 }, { x: 698, y: 232 }, { x: 698, y: 233 }, { x: 780, y: 233 }];
  const before = structuredClone(points);
  const upstream = createLine(points, {}, 5).getAttribute('d');
  assert.equal(upstream, 'M615,232L697,232C697.5,232,698,232.5,698,233L698,232C698,232.5,698.5,233,699,233L780,233');
  assert.throws(() => monotone(upstream, { x: 1, y: 1 }), /paint reverses y/);
  const actual = connectionPath(points);
  assert.equal(actual, 'M615,232L697.5,232C697.75,232,698,232.25,698,232.5L698,232.5C698,232.75,698.25,233,698.5,233L780,233');
  monotone(actual, { x: 1, y: 1 });
  assert.deepEqual(points, before);
});

test('short horizontal/vertical bends remain monotone in every direction, including fractional diagram coordinates', () => {
  for (const length of [Number.EPSILON * 1024, .001, .25, 1, 2, 5, 9, 10, 11])
    for (const signX of [-1, 1]) for (const signY of [-1, 1]) for (const transpose of [false, true]) {
      const points = [[0, 0], [100, 0], [100, length], [200, length]].map(([x, y]) => {
        const p = { x: 600.125 + x * signX, y: 200.25 + y * signY };
        return transpose ? { x: p.y, y: p.x } : p;
      });
      const direction = transpose ? { x: signY, y: signX } : { x: signX, y: signY };
      const value = connectionPath(points);
      monotone(value, direction);
      const parsed = commands(value);
      assert.deepEqual(parsed[0].points[0], points[0]);
      assert.deepEqual(parsed.at(-1).points.at(-1), points.at(-1));
      const reversed = connectionPath(points.slice().reverse());
      monotone(reversed, { x: -direction.x, y: -direction.y });
    }
});

test('uncontested corners, straight/diagonal lines, duplicates and authored reversals retain the existing path', () => {
  for (const points of [
    [{ x: .125, y: .25 }, { x: 210.125, y: .25 }],
    [{ x: .125, y: .25 }, { x: .125, y: 210.25 }],
    [{ x: .125, y: .25 }, { x: 210.125, y: 110.75 }],
    [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 50 }, { x: 100, y: 50 }],
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 6 }, { x: 100, y: 6 }],
    [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }],
    [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 60, y: 0 }],
  ]) {
    assert.equal(connectionPath(points), createLine(points, {}, 5).getAttribute('d'));
  }
});

test('contested neighboring corners keep finite paint and do not mutate frozen route metadata', () => {
  const points = [{ x: 0, y: 0, original: { x: -10, y: 0 } },
    { x: 100, y: 0, vendor: 'bend' }, { x: 100, y: 3 }, { x: 102, y: 3 }, { x: 102, y: 4 }, { x: 200, y: 4 }];
  const before = structuredClone(points);
  for (const point of points) { if (point.original) Object.freeze(point.original); Object.freeze(point); }
  Object.freeze(points);
  const value = connectionPath(points);
  monotone(value, { x: 1, y: 1 });
  assert.ok(!/NaN|Infinity/.test(value));
  assert.deepEqual(points, before);
  assert.equal(connectionPath(points, 0), 'M0,0L100,0L100,3L102,3L102,4L200,4');
});

test('risk-based element families with aligned explicit facing dockings retain exact two-point routes', () => {
  const families = [
    ['Task','Task','SequenceFlow'], ['Task','ExclusiveGateway','SequenceFlow'],
    ['ParallelGateway','Task','SequenceFlow'], ['StartEvent','Task','SequenceFlow'],
    ['Task','EndEvent','SequenceFlow'], ['BoundaryEvent','Task','SequenceFlow'],
    ['IntermediateThrowEvent','InclusiveGateway','SequenceFlow'],
    ['SubProcess','Task','SequenceFlow'], ['Transaction','Task','SequenceFlow'],
    ['CallActivity','Task','SequenceFlow'], ['Participant','Participant','MessageFlow'],
    ['Task','TextAnnotation','Association'], ['DataObjectReference','Task','DataInputAssociation'],
    ['Task','DataStoreReference','DataOutputAssociation']
  ];
  const bounds = type => type.endsWith('Event') ? [36,36] : type.endsWith('Gateway') ? [50,50] : [100,80];
  for (const [sourceType,targetType,connectionType] of families) for (const vertical of [false,true]) {
    const shape = (type,center) => {
      const [width,height] = bounds(type);
      return {type:`bpmn:${type}`,x:center.x-width/2,y:center.y-height/2,width,height};
    };
    const source = shape(sourceType,{x:300.125,y:250.75});
    const target = shape(targetType,vertical ? {x:300.125,y:600.75} : {x:650.125,y:250.75});
    const start = vertical ? {x:300.125,y:source.y+source.height} : {x:source.x+source.width,y:250.75};
    const end = vertical ? {x:300.125,y:target.y} : {x:target.x,y:250.75};
    const points = layoutConnection({source,target,type:`bpmn:${connectionType}`},
      {connectionStart:start,connectionEnd:end,preserveDocking:'both'});
    assert.deepEqual(points.map(({x,y})=>({x,y})),[start,end],`${sourceType}→${targetType} ${vertical?'vertical':'horizontal'}`);
    assert.equal(connectionPath(points),`M${start.x},${start.y}L${end.x},${end.y}`);
  }
});
