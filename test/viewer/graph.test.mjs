import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reconcileGraph } from '../../lib/util/GraphUtil.js';

test('diagram reconciliation preserves command graph identities and refreshes relationships', () => {
  const root = { id: 'P', isRoot: true };
  const task = { id: 'T', parent: root, stale: true, attachers: [] };
  root.children = [task];
  const rootChildren = root.children, taskAttachers = task.attachers;
  const old = { nodes: [ task ], edges: [], roots: [ root ], elementsById: new Map([ ['P', root], ['T', task] ]), warnings: [] };
  const freshRoot = { id: 'P', isRoot: true };
  const freshTask = { id: 'T', x: 123, parent: freshRoot };
  const child = { id: 'C', parent: freshRoot };
  const edge = { id: 'E', source: freshTask, target: child, parent: freshRoot };
  freshRoot.children = [ freshTask, child ];
  const nodes = old.nodes, edges = old.edges, lookup = old.elementsById;
  const result = reconcileGraph(old, { nodes: [freshTask, child], edges: [edge], roots: [freshRoot], elementsById: new Map([ ['P', freshRoot], ['T', freshTask], ['C', child], ['E', edge] ]), warnings: [] });
  assert.equal(result, old);
  assert.equal(old.nodes, nodes);
  assert.equal(old.edges, edges);
  assert.equal(old.elementsById, lookup);
  assert.equal(old.nodes[0], task);
  assert.equal(task.x, 123);
  assert.equal(task.stale, undefined);
  assert.equal(task.parent, root);
  assert.equal(root.children[0], task);
  assert.equal(root.children, rootChildren);
  assert.equal(task.attachers, taskAttachers);
  assert.deepEqual(taskAttachers, []);
  assert.equal(edge.source, task);
});

test('unchanged routes preserve original docking hints; edited topology, geometry and DI reject stale hints', () => {
  const sourceBO = { id: 'S' }, targetBO = { id: 'T' }, edgeBO = { id: 'E' }, di = {};
  const build = (original = false) => {
    const source = { id: 'S', businessObject: sourceBO, x: 10, y: 20, width: 100, height: 80 };
    const target = { id: 'T', businessObject: targetBO, x: 250, y: 20, width: 100, height: 80 };
    const edge = { id: 'E', businessObject: edgeBO, di, source, target, waypoints: [{ x: 110, y: 60 }, { x: 250, y: 60 }] };
    if (original) edge.waypoints.forEach((p, i) => { p.original = { x: i ? 300 : 60, y: 60, tag: `anchor-${i}` }; });
    return { nodes: [source, target], edges: [edge], roots: [], elementsById: new Map([['S', source], ['T', target], ['E', edge]]), warnings: [] };
  };
  const old = build(true), fresh = build(), expected = old.edges[0].waypoints.map(p => ({ ...p }));
  reconcileGraph(old, fresh); assert.deepEqual(old.edges[0].waypoints, expected);
  for (const change of [
    graph => { graph.edges[0].waypoints[0].x += .001; },
    graph => { graph.edges[0].waypoints.push({ x: 300, y: 60 }); },
    graph => { graph.edges[0].businessObject = { id: 'E' }; },
    graph => { graph.edges[0].di = {}; },
    graph => { graph.nodes[0].businessObject = { id: 'S' }; },
    graph => { graph.nodes[1].businessObject = { id: 'T' }; },
    graph => { graph.nodes[0].x++; },
    graph => { graph.nodes[1].height++; }
  ]) {
    const previous = build(true), next = build(); change(next); reconcileGraph(previous, next);
    assert.ok(previous.edges[0].waypoints.every(point => !Object.hasOwn(point, 'original')), 'changed route context must discard cached docking');
  }
  const withFreshHint = build(); withFreshHint.edges[0].waypoints[0].original = { x: 11, y: 12 };
  const prior = build(true); reconcileGraph(prior, withFreshHint); assert.deepEqual(prior.edges[0].waypoints[0].original, { x: 11, y: 12 });
});
