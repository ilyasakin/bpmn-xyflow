import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reconcileGraph } from '../../lib/util/GraphUtil.js';

test('diagram reconciliation preserves command graph identities and refreshes relationships', () => {
  const root = { id: 'P', isRoot: true };
  const task = { id: 'T', parent: root, stale: true };
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
  assert.equal(edge.source, task);
});
