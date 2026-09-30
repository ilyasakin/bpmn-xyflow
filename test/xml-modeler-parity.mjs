#!/usr/bin/env node
/** Actual Modeler command exports, independently reopened by upstream moddle. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { BpmnModdle as Oracle } from 'bpmn-moddle';
import { setupDOM } from './helpers/dom.mjs';
import { assertScenario } from './helpers/assert-scenarios.mjs';

const camunda = JSON.parse(await fs.readFile('test/fixtures/json/model/camunda.json', 'utf8'));
const oracle = new Oracle({ camunda });
const dom = await setupDOM();
const models = [];
try {
  const { default: Modeler } = await dom.loadModule('/lib/Modeler.js');
  async function model(file) {
    const modeler = new Modeler({ container: dom.createContainer(), palette: false, fitViewOnInit: false, moddleExtensions: { camunda } });
    models.push(modeler);
    await modeler.importXML(await fs.readFile(file, 'utf8'));
    return modeler;
  }
  let artifactNumber = 0;
  async function reopen(modeler) {
    const xml = await modeler.getXML();
    if (process.env.BPMN_XML_ARTIFACT_DIR) {
      await fs.mkdir(process.env.BPMN_XML_ARTIFACT_DIR, { recursive: true });
      await fs.writeFile(path.join(process.env.BPMN_XML_ARTIFACT_DIR, `rich-modeler-${ ++artifactNumber }.bpmn`), xml);
    }
    const result = await oracle.fromXML(xml);
    assert.equal(result.warnings.length, 0, result.warnings.map(warning => warning.message).join('\n'));
    return result;
  }
  function metadata(task) {
    return {
      flag: task.$attrs['vendor:flag'],
      asyncBefore: task.asyncBefore,
      listener: task.extensionElements.values[0].class,
      field: task.extensionElements.values[0].fields[0].string,
      loop: task.loopCharacteristics.isSequential,
      cardinality: task.loopCharacteristics.loopCardinality.body,
      completion: task.loopCharacteristics.completionCondition.body,
      item: task.ioSpecification.dataInputs[0].itemSubjectRef.id
    };
  }

  const m = await model('test/fixtures/xml/lossless.bpmn');
  const task = m.getElement('Script_1');
  const expected = metadata(task.businessObject);
  const script = task.businessObject.script;
  m.copy([ task ]);
  const copied = m.paste({ x: 550, y: 260 }).find(element => element.type === 'bpmn:ScriptTask');
  assert.ok(copied);
  let result = await reopen(m);
  const copy = result.elementsById[copied.id];
  assert.equal(copy.script, script);
  assert.deepEqual(metadata(copy), expected);
  assert.equal(copy.incoming?.length || 0, 0, 'copy excludes external incoming flow pointers');
  assert.equal(copy.outgoing?.length || 0, 0, 'copy excludes external outgoing flow pointers');
  assert.notEqual(copy.ioSpecification.id, result.elementsById.Script_1.ioSpecification.id);
  m.undo();
  assert.equal((await reopen(m)).elementsById[copied.id], undefined);
  m.redo();
  assert.equal((await reopen(m)).elementsById[copied.id].script, script);
  console.log('OK Modeler copy/paste and undo/redo preserve script, opaque attributes, Camunda extensions, loops and IO; external topology filtered');

  m.replace(task, 'bpmn:ServiceTask');
  result = await reopen(m);
  assert.equal(result.elementsById.Script_1.$type, 'bpmn:ServiceTask');
  assert.deepEqual(metadata(result.elementsById.Script_1), expected);
  assert.equal(result.elementsById.Shape_Script['background-color'], '#abcdef');
  assert.equal(result.elementsById.Timer_1.attachedToRef, result.elementsById.Script_1);
  assert.equal(result.elementsById.Lane_1.flowNodeRef.find(element => element.id === 'Script_1'), result.elementsById.Script_1);
  m.undo();
  result = await reopen(m);
  assert.equal(result.elementsById.Script_1.$type, 'bpmn:ScriptTask');
  assert.equal(result.elementsById.Script_1.script, script);
  m.redo();
  assert.deepEqual(metadata((await reopen(m)).elementsById.Script_1), expected);
  console.log('OK Modeler replacement and undo/redo retain compatible metadata, DI color, lane and boundary references');

  const edge = m.getElement('Flow_1');
  const moddle = m.getModdle();
  edge.businessObject.conditionExpression = moddle.create('bpmn:FormalExpression', { body: '${verified}', language: 'javascript' });
  edge.businessObject.conditionExpression.$parent = edge.businessObject;
  edge.businessObject.extensionElements = moddle.create('bpmn:ExtensionElements', { values: [ moddle.create('camunda:ExecutionListener', { event: 'take', class: 'example.FlowListener' }) ] });
  edge.businessObject.extensionElements.$parent = edge.businessObject;
  edge.businessObject.extensionElements.values[0].$parent = edge.businessObject.extensionElements;
  edge.businessObject.set('vendor:flag', 'flow-metadata');
  m.reconnect(edge, 'target', copied);
  result = await reopen(m);
  assert.equal(result.elementsById.Flow_1.targetRef.id, copied.id);
  assert.equal(result.elementsById.Flow_1.conditionExpression.body, '${verified}');
  assert.equal(result.elementsById.Flow_1.extensionElements.values[0].class, 'example.FlowListener');
  assert.equal(result.elementsById.Flow_1.$attrs['vendor:flag'], 'flow-metadata');
  m.undo();
  assert.equal((await reopen(m)).elementsById.Flow_1.targetRef.id, 'Script_1');
  m.redo();
  assert.equal((await reopen(m)).elementsById.Flow_1.extensionElements.values[0].class, 'example.FlowListener');
  console.log('OK Modeler reconnect retains conditional expressions, extension metadata and undo/redo reference identity');

  const booking = await model('test/fixtures/scenarios/booking-timeout-compensation.bpmn');
  const timer = booking.getElement('FlightTimeout');
  assert.ok(timer);
  booking.replace(timer, 'bpmn:BoundaryEvent', { name: 'One-hour reservation timeout' });
  result = await reopen(booking);
  assertScenario('booking-timeout-compensation', result.rootElement);
  booking.undo();
  assertScenario('booking-timeout-compensation', (await reopen(booking)).rootElement);
  booking.redo();
  assertScenario('booking-timeout-compensation', (await reopen(booking)).rootElement);
  console.log('OK Modeler timer replacement preserves PT1H, transaction/cancellation/compensation semantics after export and undo/redo');
} finally {
  models.forEach(modeler => modeler.destroy());
  await dom.cleanup();
}
