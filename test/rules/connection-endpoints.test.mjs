import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { BpmnModdle } from 'bpmn-moddle';
import { BpmnModdle as RetainedModdle } from '../../lib/bpmn/moddle.js';
import { canReconnect, getConnectionAttributes } from '../../lib/modeling/Rules.js';
import { loadUpstreamRules } from '../helpers/upstream-rules.mjs';

const require = createRequire(import.meta.url);
assert.equal(require('bpmn-js/package.json').version, '18.30.1');
const upstream = await loadUpstreamRules();

function model(Model) {
  const moddle = new Model();
  let next = 0;
  const make = (type, parent, extra = {}) => {
    const businessObject = moddle.create(`bpmn:${type}`, { id: `${type}_${++next}` });
    businessObject.$parent = parent?.businessObject || null;
    return { id: businessObject.id, type: businessObject.$type, businessObject, parent, ...extra };
  };
  const process = make('Process');
  const source = make('Task', process), target = make('Task', process), note = make('TextAnnotation', process);
  const edge = (type, from = source, to = target) => {
    const result = make(type, process, { source: from, target: to, waypoints: [{ x: 0, y: 0 }, { x: 100, y: 50 }] });
    result.businessObject.sourceRef = from.businessObject;
    result.businessObject.targetRef = to.businessObject;
    return result;
  };
  const owners = ['SequenceFlow', 'MessageFlow', 'Association', 'DataInputAssociation', 'DataOutputAssociation'].map(type => edge(type));
  return { process, source, target, note, edge, owners };
}

for (const [name, Model] of [['official moddle', BpmnModdle], ['retained moddle', RetainedModdle]]) {
  test(`connection endpoint creation follows actual pinned inference: ${name}`, () => {
    const { source, target, note, owners } = model(Model);
    const label = { ...note, id: 'external_label', type: 'label', labelTarget: note };
    const candidates = [source, target, note, label, ...owners];
    for (const owner of owners) for (const candidate of candidates) for (const reverse of [false, true]) {
      const [from, to] = reverse ? [candidate, owner] : [owner, candidate];
      const expected = upstream.canConnect(from, to) || null;
      assert.deepEqual(getConnectionAttributes(from, to), expected, `${from.type} -> ${to.type}`);
    }
    for (const owner of owners) {
      assert.deepEqual(getConnectionAttributes(owner, note), { type: 'bpmn:Association', associationDirection: 'None' });
      assert.deepEqual(getConnectionAttributes(note, owner), { type: 'bpmn:Association', associationDirection: 'None' });
    }
  });

  test(`reconnect onto another connection retains pinned semantic inference: ${name}`, () => {
    const { source, note, owners, edge } = model(Model);
    for (const type of ['Association', 'SequenceFlow', 'MessageFlow', 'DataInputAssociation', 'DataOutputAssociation']) {
      for (const side of ['source', 'target']) for (const opposite of [note, source, ...owners]) {
        const edited = side === 'source' ? edge(type, source, opposite) : edge(type, opposite, source);
        const oldSource = edited.source, oldTarget = edited.target;
        const points = JSON.stringify(edited.waypoints);
        for (const candidate of owners) {
          const from = side === 'source' ? candidate : edited.source;
          const to = side === 'target' ? candidate : edited.target;
          const expected = upstream.canConnect(from, to, edited)?.type || null;
          assert.equal(canReconnect(edited, side, candidate) || null, expected, `${type}.${side} -> ${candidate.type}, opposite ${opposite.type}`);
          assert.equal(edited.source, oldSource);
          assert.equal(edited.target, oldTarget);
          assert.equal(JSON.stringify(edited.waypoints), points, 'rules must not change routing');
        }
      }
    }
  });

  test(`edited connection identity and invalid reconnect arguments are rejected: ${name}`, () => {
    const { note, owners, edge } = model(Model);
    for (const side of ['source', 'target']) {
      const edited = side === 'source' ? edge('Association', owners[0], note) : edge('Association', note, owners[0]);
      // BpmnRules.canConnect is semantic inference only. The local reconnect
      // entry point also prevents creating a cycle through the edited edge.
      assert.equal(canReconnect(edited, side, edited), false);
      assert.equal(canReconnect(edited, side, owners[1]), 'bpmn:Association');
      assert.equal(canReconnect(edited, side, null), false);
      assert.equal(canReconnect(edited, 'middle', owners[1]), false);
      assert.equal(canReconnect(null, side, owners[1]), false);
      const label = { ...note, type: 'label', labelTarget: note };
      assert.equal(canReconnect(edited, side, label) || null, null);
    }
  });
}
