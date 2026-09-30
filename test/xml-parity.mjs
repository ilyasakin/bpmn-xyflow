#!/usr/bin/env node
/** Independent upstream-oracle XML contract tests; no runtime upstream import. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BpmnModdle as UpstreamModdle } from 'bpmn-moddle';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { BpmnModdle } from '../lib/bpmn/moddle.js';
import { assertScenario } from './helpers/assert-scenarios.mjs';
import { cloneSemanticGraph } from '../lib/modeling/Clipboard.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensions = Object.fromEntries(await Promise.all([ 'camunda', 'custom' ].map(async name => [ name, JSON.parse(await fs.readFile(path.join(root, 'test/fixtures/json/model', name + '.json'), 'utf8')) ])));
const oracle = new UpstreamModdle(extensions);
globalThis.DOMParser = class extends DOMParser {
  constructor() { super({ onError: (level, message) => { if (level !== 'warning') throw new Error(message); } }); }
};
globalThis.XMLSerializer = XMLSerializer;
globalThis.window = {};
const runInDom = (callback, value) => callback(value);
const artifactDirectory = process.env.BPMN_XML_ARTIFACT_DIR;
async function saveArtifact(name, xml) {
  if (!artifactDirectory) return;
  await fs.mkdir(artifactDirectory, { recursive: true });
  await fs.writeFile(path.join(artifactDirectory, name), xml);
}


function snapshot(element, renamed = new Map()) {
  if (element == null || typeof element !== 'object') return element;
  if (Array.isArray(element)) return element.map(item => snapshot(item, renamed));
  const descriptor = element.$descriptor;
  const result = { $type: element.$type };
  for (const key of [ ...new Set([ ...Object.keys(element), ...(descriptor?.properties || []).filter(prop => Object.prototype.hasOwnProperty.call(element, prop.name)).map(prop => prop.name) ]) ].sort()) {
    if (key === '$type' || key === '$parent' || key.startsWith('xmlns')) continue;
    if (key.startsWith('$') && key !== '$body' && key !== '$children') continue;
    const value = element[key];
    const prop = descriptor?.propertiesByName?.[key];
    if (prop?.isVirtual) continue;
    const referenceId = reference => renamed.get(reference?.id || reference) || reference?.id || reference;
    if (prop?.isReference) result[key] = Array.isArray(value) ? value.map(referenceId) : referenceId(value);
    else if (key === 'id') result[key] = renamed.get(value) || value;
    else result[key] = snapshot(value, renamed);
  }
  const attrs = Object.fromEntries(Object.entries(element.$attrs || {}).filter(([ key ]) => !key.startsWith('xmlns') && key !== 'xsi:type').sort(([ a ], [ b ]) => a.localeCompare(b)));
  if (attrs['xsi:schemaLocation']) attrs['xsi:schemaLocation'] = attrs['xsi:schemaLocation'].trim().replace(/\s+/g, ' ');
  if (Object.keys(attrs).length) result.$attrs = attrs;
  return result;
}

try {
  window.moddle = BpmnModdle(extensions);
  window.BpmnModdle = BpmnModdle;
  const fixture = await fs.readFile(path.join(root, 'test/fixtures/xml/lossless.bpmn'), 'utf8');
  const original = await oracle.fromXML(fixture);
  assert.equal(original.warnings.length, 0, 'rich fixture must itself pass the independent oracle');
  const result = await runInDom(async xml => {
    const parsed = await window.moddle.fromXML(xml);
    const { rootElement, elementsById: ids, warnings } = parsed;
    if (warnings.length) throw new Error(warnings.map(w => w.message).join('\n'));
    if (ids.get('Script_1').script.indexOf('  if') !== 0) throw new Error('script whitespace lost');
    if (ids.get('TimerDefinition_1').timeDuration.body !== 'PT1H') throw new Error('timer expression lost');
    if (ids.get('Flow_1').sourceRef !== ids.get('Start_1')) throw new Error('reference identity lost');
    if (!ids.get('Script_1').isSequential && ids.get('Script_1').loopCharacteristics.isSequential !== true) throw new Error('loop boolean not typed');
    const unchanged = (await window.moddle.toXML(rootElement, { format: true })).xml;
    ids.get('Script_1').name = 'Edited & named';
    ids.get('Shape_Script').bounds.x += 42;
    const edited = (await window.moddle.toXML(rootElement, { format: false })).xml;
    return { unchanged, edited };
  }, fixture);
  await saveArtifact('lossless-roundtrip.bpmn', result.unchanged);
  await saveArtifact('lossless-edited.bpmn', result.edited);
  const unchanged = await oracle.fromXML(result.unchanged);
  assert.equal(unchanged.warnings.length, 0, 'export must produce no oracle warnings');
  assert.deepEqual(snapshot(unchanged.rootElement), snapshot(original.rootElement), 'complete semantic/DI/extension graph matches independent upstream oracle');
  const edited = await oracle.fromXML(result.edited);
  original.elementsById.Script_1.name = 'Edited & named';
  original.elementsById.Shape_Script.bounds.x += 42;
  assert.deepEqual(snapshot(edited.rootElement), snapshot(original.rootElement), 'semantic/geometry edits preserve unrelated content');
  assert.ok(!/text="Annotation/.test(result.edited), 'annotation body must not become an attribute');
  console.log('OK rich BPMN semantics, DI, namespaces, script whitespace, extensions and edit preservation (upstream oracle)');

  async function filesIn(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return (await Promise.all(entries.map(entry => entry.isDirectory() ? filesIn(path.join(directory, entry.name)) : path.join(directory, entry.name)))).flat();
  }
  const files = (await filesIn(path.join(root, 'test/fixtures/bpmn'))).filter(file => file.endsWith('.bpmn') && !file.includes('/error/') && !file.endsWith('custom-override.bpmn'));
  let checked = 0;
  for (const file of files) {
    let xml = await fs.readFile(file, 'utf8');
    const before = await oracle.fromXML(xml);
    const exported = await runInDom(async xml => {
      const { rootElement } = await window.moddle.fromXML(xml);
      return (await window.moddle.toXML(rootElement)).xml;
    }, xml).catch(error => { error.message = path.relative(root, file) + ': ' + error.message; throw error; });
    const after = await oracle.fromXML(exported);
    assert.deepEqual(snapshot(after.rootElement), snapshot(before.rootElement), path.relative(root, file));
    checked++;
  }
  console.log(`OK ${ checked } existing BPMN fixtures preserve the independent upstream semantic graph`);

  const overrideExtensions = { ...extensions, custom: JSON.parse(await fs.readFile(path.join(root, 'test/fixtures/json/model/custom-override.json'), 'utf8')) };
  const overrideXML = await fs.readFile(path.join(root, 'test/fixtures/bpmn/extension/custom-override.bpmn'), 'utf8');
  const overrideOracle = new UpstreamModdle(overrideExtensions);
  const overrideModel = BpmnModdle(overrideExtensions);
  const overrideBefore = await overrideOracle.fromXML(overrideXML);
  const overrideExport = await overrideModel.toXML((await overrideModel.fromXML(overrideXML)).rootElement);
  const overrideAfter = await overrideOracle.fromXML(overrideExport.xml);
  assert.deepEqual(snapshot(overrideAfter.rootElement), snapshot(overrideBefore.rootElement));
  console.log('OK alternate custom descriptor fixture preserves upstream semantics');

  for (const file of (await filesIn(path.join(root, 'test/fixtures/scenarios'))).filter(file => file.endsWith('.bpmn'))) {
    const source = await fs.readFile(file, 'utf8');
    const expected = await oracle.fromXML(source);
    assert.equal(expected.warnings.length, 0, path.basename(file) + ' upstream input warnings');
    const parsed = await window.moddle.fromXML(source);
    assert.equal(parsed.warnings.length, 0, path.basename(file) + ' custom input warnings');
    const exported = await window.moddle.toXML(parsed.rootElement, { format: true });
    const actual = await oracle.fromXML(exported.xml);
    assert.equal(actual.warnings.length, 0, path.basename(file) + ' upstream export warnings');
    assertScenario(path.basename(file, '.bpmn'), actual.rootElement);
    assert.deepEqual(snapshot(actual.rootElement), snapshot(expected.rootElement), path.basename(file) + ' full semantic graph');
    const process = parsed.rootElement.rootElements.find(element => element.$type === 'bpmn:Process');
    process.name = 'Updated business process';
    expected.elementsById[process.id].name = process.name;
    const shape = [ ...parsed.elementsById.values() ].find(element => element.$type === 'bpmndi:BPMNShape');
    shape.bounds.x += 25;
    expected.elementsById[shape.id].bounds.x += 25;
    const reopened = await window.moddle.fromXML((await window.moddle.toXML(parsed.rootElement)).xml);
    const finalExport = (await window.moddle.toXML(reopened.rootElement)).xml;
    await saveArtifact(path.basename(file), finalExport);
    const afterEdits = await oracle.fromXML(finalExport);
    assert.equal(afterEdits.warnings.length, 0);
    assertScenario(path.basename(file, '.bpmn'), afterEdits.rootElement);
    assert.deepEqual(snapshot(afterEdits.rootElement), snapshot(expected.rootElement), path.basename(file) + ' edit/save/reopen semantic graph');
    console.log(`OK business scenario ${ path.basename(file) }: upstream import, edit, save and reopen`);
  }

  const clipboardModel = BpmnModdle(extensions);
  const clipboardSource = await clipboardModel.fromXML(fixture);
  let copyId = 0;
  const entireCopy = cloneSemanticGraph(clipboardModel, [ clipboardSource.rootElement ], { newId: () => 'Copy_' + ++copyId });
  const renamed = new Map([ ...entireCopy ].filter(([ original ]) => original.id).map(([ original, copy ]) => [ original.id, copy.id ]));
  const copiedDefinitions = entireCopy.get(clipboardSource.rootElement);
  const copiedXML = (await clipboardModel.toXML(copiedDefinitions, { format: true })).xml;
  await saveArtifact('lossless-clipboard.bpmn', copiedXML);
  const copiedOracle = await oracle.fromXML(copiedXML);
  const sourceOracle = await oracle.fromXML(fixture);
  assert.equal(copiedOracle.warnings.length, 0);
  assert.deepEqual(snapshot(copiedOracle.rootElement), snapshot(sourceOracle.rootElement, renamed), 'clipboard clone preserves entire typed/opaque graph and remaps all references');
  assert.equal(entireCopy.get(clipboardSource.elementsById.get('Timer_1')).attachedToRef, entireCopy.get(clipboardSource.elementsById.get('Script_1')));
  assert.equal(entireCopy.get(clipboardSource.elementsById.get('Flow_1')).sourceRef, entireCopy.get(clipboardSource.elementsById.get('Start_1')));
  const processSource = clipboardSource.elementsById.get('Process_1');
  const partialCopy = cloneSemanticGraph(clipboardModel, [ processSource ], { newId: () => 'Partial_' + ++copyId });
  const copiedProcess = partialCopy.get(processSource);
  assert.equal(partialCopy.get(clipboardSource.elementsById.get('EventDefinition_1')).messageRef, clipboardSource.elementsById.get('Message_1'), 'external definition reference retained by identity');
  copiedProcess.$parent = clipboardSource.rootElement;
  clipboardSource.rootElement.rootElements.push(copiedProcess);
  const partialOracle = await oracle.fromXML((await clipboardModel.toXML(clipboardSource.rootElement)).xml);
  assert.equal(partialOracle.warnings.length, 0);
  const partialNames = new Map([ ...partialCopy ].filter(([ original ]) => original.id).map(([ original, copy ]) => [ original.id, copy.id ]));
  const expectedPartial = snapshot(sourceOracle.rootElement);
  expectedPartial.rootElements.push(snapshot(sourceOracle.elementsById.Process_1, partialNames));
  assert.deepEqual(snapshot(partialOracle.rootElement), expectedPartial, 'partial copy keeps definition references, nested extension/script/timer metadata and source graph');
  console.log('OK semantic clipboard full/partial clones preserve opaque metadata, scripts, timers, DI and internal/external references (upstream oracle)');

  const genericResult = await runInDom(async () => {
    const xml = `<b:definitions xmlns:b="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:v="urn:vendor" targetNamespace="urn:test"><b:process id="P"><b:extensionElements><v:payload v:attr="&lt;&amp;&quot;">before <v:child>inner</v:child> after<!--keep--><![CDATA[ <script>alert(1)</script> ]]></v:payload></b:extensionElements><b:task id="T" v:flag="1"><v:unknown>retained</v:unknown></b:task><b:sequenceFlow id="F" sourceRef="T" targetRef="missing" /></b:process></b:definitions>`;
    const parsed = await window.BpmnModdle().fromXML(xml);
    const exported = (await window.BpmnModdle().toXML(parsed.rootElement)).xml;
    const document = new DOMParser().parseFromString(exported, 'application/xml');
    const payload = document.getElementsByTagNameNS('urn:vendor', 'payload')[0];
    return {
      text: payload.textContent,
      attr: payload.getAttributeNS('urn:vendor', 'attr'),
      unknown: document.getElementsByTagNameNS('urn:vendor', 'unknown')[0]?.textContent,
      unresolved: document.getElementsByTagNameNS('http://www.omg.org/spec/BPMN/20100524/MODEL', 'sequenceFlow')[0]?.getAttribute('targetRef'),
      comment: exported.includes('<!--keep-->'),
      executable: exported.includes('<script>'),
      warnings: parsed.warnings.map(w => w.message)
    };
  });
  assert.equal(genericResult.text, 'before inner after <script>alert(1)</script> ');
  assert.equal(genericResult.attr, '<&"');
  assert.equal(genericResult.unknown, 'retained');
  assert.equal(genericResult.unresolved, 'missing');
  assert.equal(genericResult.comment, true);
  assert.equal(genericResult.executable, false);
  assert.ok(genericResult.warnings.some(warning => warning.includes('unresolved reference')));
  console.log('OK unknown namespaces, mixed XML content, comments, escaping and unresolved references survive');

  const namespaceResult = await runInDom(async () => {
    const xml = `<m:definitions xmlns:m="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmn="urn:root-vendor" xmlns:xtype="http://www.w3.org/2001/XMLSchema-instance" xmlns:v="urn:vendor" targetNamespace="urn:test"><m:process id="P"><m:task id="A"/><m:task id="B"/><m:sequenceFlow id="F" sourceRef="A" targetRef="B"><m:conditionExpression xmlns:bpmn1="urn:local-vendor" xtype:type="v:Expression" v:hint="bpmn1:symbol">a &lt; 3</m:conditionExpression></m:sequenceFlow><m:extensionElements><v:payload xmlns:v="urn:nested-vendor" v:value="bpmn:symbol"/></m:extensionElements></m:process></m:definitions>`;
    const { rootElement } = await window.BpmnModdle().fromXML(xml);
    const exported = (await window.BpmnModdle().toXML(rootElement, { format: true })).xml;
    const document = new DOMParser().parseFromString(exported, 'application/xml');
    const expression = document.getElementsByTagNameNS('http://www.omg.org/spec/BPMN/20100524/MODEL', 'conditionExpression')[0];
    const payload = document.getElementsByTagNameNS('urn:nested-vendor', 'payload')[0];
    return {
      type: expression?.getAttributeNS('http://www.w3.org/2001/XMLSchema-instance', 'type'),
      hint: expression?.getAttributeNS('urn:vendor', 'hint'),
      localBinding: expression?.lookupNamespaceURI('bpmn1'),
      rootBinding: payload?.lookupNamespaceURI('bpmn'),
      payload: payload?.getAttributeNS('urn:nested-vendor', 'value')
    };
  });
  assert.deepEqual(namespaceResult, { type: 'v:Expression', hint: 'bpmn1:symbol', localBinding: 'urn:local-vendor', rootBinding: 'urn:root-vendor', payload: 'bpmn:symbol' });
  console.log('OK opaque xsi:type, prefix collisions, local namespace rebinding and QName values preserved');

  const errorNamedPayload = `<b:definitions xmlns:b="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="urn:test"><b:process id="P"><b:extensionElements><parsererror xmlns="urn:vendor">ordinary payload</parsererror></b:extensionElements></b:process></b:definitions>`;
  const acceptedPayload = await window.moddle.fromXML(errorNamedPayload);
  const acceptedXML = (await window.moddle.toXML(acceptedPayload.rootElement)).xml;
  assert.equal(new DOMParser().parseFromString(acceptedXML, 'application/xml').getElementsByTagNameNS('urn:vendor', 'parsererror')[0].textContent, 'ordinary payload');
  console.log('OK vendor element named parsererror remains valid XML content');

  const adversarial = `<b:definitions xmlns:b="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:v="urn:v" targetNamespace="urn:here"><b:process id="P"><b:task id="A"/><b:sequenceFlow id="F" sourceRef="v:A"><b:conditionExpression xsi:type="v:Expression">before<v:child>inner</v:child>after</b:conditionExpression></b:sequenceFlow><b:extensionElements><v:payload xsi:type="b:tFormalExpression">text</v:payload></b:extensionElements></b:process></b:definitions>`;
  const adversarialParsed = await window.moddle.fromXML(adversarial);
  assert.equal(adversarialParsed.elementsById.get('F').sourceRef, 'v:A', 'a qualified external reference must never bind to an unrelated local ID');
  assert.ok(adversarialParsed.warnings.some(warning => warning.message.includes('v:A')));
  const adversarialXML = (await window.moddle.toXML(adversarialParsed.rootElement)).xml;
  const adversarialDOM = new DOMParser().parseFromString(adversarialXML, 'application/xml');
  const opaqueExpression = adversarialDOM.getElementsByTagNameNS('http://www.omg.org/spec/BPMN/20100524/MODEL', 'conditionExpression')[0];
  assert.equal(opaqueExpression.textContent, 'beforeinnerafter', 'opaque wrapper preserves mixed-content ordering');
  assert.equal(opaqueExpression.getAttributeNS('http://www.w3.org/2001/XMLSchema-instance', 'type'), 'v:Expression');
  const payload = adversarialDOM.getElementsByTagNameNS('urn:v', 'payload')[0];
  assert.ok(payload, 'generic extension QName takes priority over xsi:type');
  assert.equal(payload.textContent, 'text');
  assert.equal(payload.getAttributeNS('http://www.w3.org/2001/XMLSchema-instance', 'type'), 'b:tFormalExpression');
  assert.equal(adversarialDOM.getElementsByTagNameNS('http://www.omg.org/spec/BPMN/20100524/MODEL', 'formalExpression').length, 0);
  console.log('OK adversarial QName references, generic xsi:type and opaque mixed-content wrapper regressions');

  const created = BpmnModdle(extensions);
  const defs = created.create('bpmn:Definitions', { id: 'NewDefinitions', targetNamespace: 'urn:new' });
  const process = created.create('bpmn:Process', { id: 'NewProcess' });
  defs.get('rootElements').push(process);
  const task = created.create('bpmn:ServiceTask', { id: 'NewTask' });
  task.set('camunda:asyncBefore', true);
  const ext = created.create('bpmn:ExtensionElements');
  const listener = created.create('camunda:ExecutionListener', { event: 'start', class: 'example.Listener' });
  const generic = created.createAny('vendor:payload', 'urn:created-vendor', { enabled: 'yes', $body: 'exact body' });
  ext.get('values').push(listener, generic);
  task.extensionElements = ext;
  process.get('flowElements').push(task);
  assert.equal(task.get('camunda:asyncBefore'), true);
  assert.equal(task.$instanceOf('camunda:AsyncCapable'), true);
  assert.equal(task.$instanceOf('bpmn:FlowNode'), true);
  assert.equal(created.create('bpmn:StartEvent').isInterrupting, true);
  const createdXML = (await created.toXML(defs)).xml;
  const createdOracle = await oracle.fromXML(createdXML);
  assert.equal(createdOracle.warnings.length, 0);
  assert.equal(createdOracle.elementsById.NewTask.asyncBefore, true);
  assert.equal(createdOracle.elementsById.NewTask.extensionElements.values[0].class, 'example.Listener');
  assert.equal(createdOracle.elementsById.NewTask.extensionElements.values[1].$body, 'exact body');
  console.log('OK new model creation, custom descriptor traits, defaults, lazy collections and vendor extensions');

  const invalid = await runInDom(async () => {
    const values = [ '<broken>', '<html/>', '<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///etc/passwd">]><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">&secret;</bpmn:definitions>', '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"><bpmn:process id="same"/><bpmn:process id="same"/></bpmn:definitions>' ];
    return Promise.all(values.map(async xml => { try { await window.moddle.fromXML(xml); return false; } catch { return true; } }));
  });
  assert.ok(invalid.every(Boolean), 'malformed XML, wrong roots, external entities and duplicate IDs reject');
  console.log('OK malformed XML, invalid roots, external entities and duplicate IDs rejected');
} finally {
  delete globalThis.DOMParser;
  delete globalThis.XMLSerializer;
  delete globalThis.window;
}
