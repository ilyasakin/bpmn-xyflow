#!/usr/bin/env node
/** Independent upstream-oracle XML contract tests; no runtime upstream import. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BpmnModdle as UpstreamModdle } from 'bpmn-moddle';
import { DOMParser as XMLDOMParser } from '@xmldom/xmldom';
import { BpmnModdle } from '../lib/bpmn/moddle.js';
import { assertScenario } from './helpers/assert-scenarios.mjs';
import { cloneSemanticGraph } from '../lib/modeling/Clipboard.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensions = Object.fromEntries(await Promise.all([ 'camunda', 'custom' ].map(async name => [ name, JSON.parse(await fs.readFile(path.join(root, 'test/fixtures/json/model', name + '.json'), 'utf8')) ])));
const oracle = new UpstreamModdle(extensions);
class DOMParser extends XMLDOMParser {
  constructor() { super({ onError: (level, message) => { if (level !== 'warning') throw new Error(message); } }); }
}
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

  const formattingPackage = {
    name: 'Formatting', uri: 'urn:test:formatting', prefix: 'f', xml: { tagAlias: 'lowerCase' }, types: [
      { name: 'Empty', superClass: [ 'Element' ], properties: [ { name: 'flag', type: 'String', isAttr: true, default: 'default' } ] },
      { name: 'Text', superClass: [ 'Element' ], properties: [ { name: 'body', type: 'String', isBody: true } ] },
      { name: 'Container', superClass: [ 'Element' ], properties: [ { name: 'children', type: 'Empty', isMany: true } ] }
    ]
  };
  const emptyContentSource = `<b:definitions xmlns:b="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:f="urn:test:formatting" xmlns:v="urn:unknown:formatting" targetNamespace="urn:test:empty-content"><b:process id="EmptyP"><b:extensionElements><f:empty><!--typed-empty--><?vendor empty?></f:empty><f:text>before<!--typed-text--><?vendor text?>after</f:text><f:container><!--container--><f:empty flag="child"/><?vendor container?></f:container><v:empty><!--generic-empty--><?vendor generic?></v:empty></b:extensionElements><b:task id="EmptyA"/><b:task id="EmptyB"/><b:sequenceFlow id="EmptyFlow" sourceRef="EmptyA" targetRef="EmptyB"/></b:process><bpmndi:BPMNDiagram id="EmptyD"><bpmndi:BPMNPlane id="EmptyPlane" bpmnElement="EmptyP"><bpmndi:BPMNShape id="EmptyA_di" bpmnElement="EmptyA"><dc:Bounds x="0.25" y="1.5" width="100" height="80"><!--bounds-comment--><?vendor bounds?></dc:Bounds></bpmndi:BPMNShape><bpmndi:BPMNShape id="EmptyB_di" bpmnElement="EmptyB"><dc:Bounds x="200" y="1.5" width="100" height="80"/></bpmndi:BPMNShape><bpmndi:BPMNEdge id="EmptyFlow_di" bpmnElement="EmptyFlow"><di:waypoint x="100.25" y="41.5"><!--point-comment--><?vendor point?></di:waypoint><di:waypoint x="200" y="41.5"/></bpmndi:BPMNEdge></bpmndi:BPMNPlane></bpmndi:BPMNDiagram></b:definitions>`;
  const formattingModel = BpmnModdle({ formatting: formattingPackage });
  const formattingOracle = new UpstreamModdle({ formatting: formattingPackage });
  const emptyParsed = await formattingModel.fromXML(emptyContentSource);
  const emptyExpected = await formattingOracle.fromXML(emptyContentSource);
  assert.deepEqual(emptyParsed.warnings, []);assert.deepEqual(emptyExpected.warnings, []);
  for (const format of [ false, true ]) {
    const output = (await formattingModel.toXML(emptyParsed.rootElement, { format })).xml;
    const document = new DOMParser().parseFromString(output, 'application/xml');
    const named = (uri, localName) => document.getElementsByTagNameNS(uri, localName)[0];
    for (const element of [ named('http://www.omg.org/spec/DD/20100524/DC', 'Bounds'), named('http://www.omg.org/spec/DD/20100524/DI', 'waypoint'), named('urn:test:formatting', 'empty'), named('urn:unknown:formatting', 'empty') ]) {
      assert.equal(element.textContent, '', `${element.tagName} gains no character content from formatting`);
      assert.deepEqual(Array.from(element.childNodes).map(node => node.nodeType), [8, 7], `${element.tagName} retains comment and PI nodes`);
    }
    const text = named('urn:test:formatting', 'text');
    assert.equal(text.textContent, 'beforeafter');assert.deepEqual(Array.from(text.childNodes).map(node => node.nodeType), [3, 8, 7, 3]);
    const container = named('urn:test:formatting', 'container');
    assert.equal(container.getElementsByTagNameNS('urn:test:formatting', 'empty')[0].getAttribute('flag'), 'child');
    if (format) assert.ok(Array.from(container.childNodes).some(node => node.nodeType === 3 && node.nodeValue.includes('\n')), 'element-content descriptors still pretty-print');
    const actual = await formattingOracle.fromXML(output);assert.deepEqual(actual.warnings, []);
    assert.deepEqual(snapshot(actual.rootElement), snapshot(emptyExpected.rootElement), 'empty/body/element/opaque content descriptors retain independent semantics');
    await saveArtifact(`empty-content-${format ? 'formatted' : 'compact'}.bpmn`, output);
  }
  console.log('OK formatted empty-content Bounds/Point/custom types preserve inline comments/PI without schema-invalid text');

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

  const rawContentXML = `<b:definitions xmlns:b="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:v="urn:vendor" targetNamespace="urn:test"><b:process id="P"><b:extensionElements><v:payload>before<!--middle-->after<?vendor pi?>last</v:payload></b:extensionElements></b:process></b:definitions>`;
  const rawContent = await window.moddle.fromXML(rawContentXML);
  const originalRawNodes = new DOMParser().parseFromString(rawContentXML, 'application/xml').getElementsByTagNameNS('urn:vendor', 'payload')[0];
  const rawSequence = node => Array.from(node.childNodes).map(child => [ child.nodeType, child.nodeValue ]);
  const rawOutput = (await window.moddle.toXML(rawContent.rootElement)).xml;
  const rawNodes = new DOMParser().parseFromString(rawOutput, 'application/xml').getElementsByTagNameNS('urn:vendor', 'payload')[0];
  assert.deepEqual(rawSequence(rawNodes), rawSequence(originalRawNodes), 'generic text/comment/PI sequence is preserved without child elements');
  const rawPayload = rawContent.elementsById.get('P').extensionElements.values[0];
  rawPayload.$body = 'edited body';
  const editedRaw = (await window.moddle.toXML(rawContent.rootElement)).xml;
  assert.ok(editedRaw.includes('edited body<!--middle--><?vendor pi?>'));
  delete rawPayload.$body;
  const removedRaw = (await window.moddle.toXML(rawContent.rootElement)).xml;
  assert.ok(removedRaw.includes('<!--middle--><?vendor pi?>'));
  assert.ok(!removedRaw.includes('before') && !removedRaw.includes('edited body'));
  console.log('OK text/comment/processing-instruction order survives generic leaf roundtrip and body edits');

  const movedNamespaceXML = `<b:definitions xmlns:b="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" targetNamespace="urn:test"><b:process id="P1" xmlns:v="urn:old"><b:task id="A"><b:extensionElements><x:payload xmlns:x="urn:extension" ref="v:Thing" xsi:type="v:Custom">v:Text</x:payload></b:extensionElements></b:task></b:process><b:process id="P2" xmlns:v="urn:new"/></b:definitions>`;
  const movedNamespace = await window.moddle.fromXML(movedNamespaceXML);
  const movedTask = movedNamespace.elementsById.get('A');
  movedNamespace.elementsById.get('P1').flowElements = [];
  movedNamespace.elementsById.get('P2').flowElements = [ movedTask ];
  movedTask.$parent = movedNamespace.elementsById.get('P2');
  const movedOutput = (await window.moddle.toXML(movedNamespace.rootElement)).xml;
  const movedPayload = new DOMParser().parseFromString(movedOutput, 'application/xml').getElementsByTagNameNS('urn:extension', 'payload')[0];
  assert.equal(movedPayload.lookupNamespaceURI('v'), 'urn:old');
  assert.equal(movedPayload.getAttribute('ref'), 'v:Thing');
  assert.equal(movedPayload.textContent, 'v:Text');
  assert.equal(movedPayload.getAttributeNS('http://www.w3.org/2001/XMLSchema-instance', 'type'), 'v:Custom');
  const copiedNamespace = cloneSemanticGraph(window.moddle, [ movedTask ]).get(movedTask);
  const anotherDefinitions = window.moddle.create('bpmn:Definitions', { targetNamespace: 'urn:new-document', rootElements: [ window.moddle.create('bpmn:Process', { id: 'Target', flowElements: [ copiedNamespace ] }) ] });
  const copiedNamespaceOutput = (await window.moddle.toXML(anotherDefinitions)).xml;
  const copiedNamespacePayload = new DOMParser().parseFromString(copiedNamespaceOutput, 'application/xml').getElementsByTagNameNS('urn:extension', 'payload')[0];
  assert.equal(copiedNamespacePayload.lookupNamespaceURI('v'), 'urn:old');
  const noDefaultSource = `<b:definitions xmlns:b="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="urn:test"><b:process id="P1"><b:task id="A"><b:extensionElements><payload code="1"/></b:extensionElements></b:task></b:process><b:process id="P2" xmlns="urn:new"/></b:definitions>`;
  const noDefault = await window.moddle.fromXML(noDefaultSource);
  const noNamespaceTask = noDefault.elementsById.get('A');
  noDefault.elementsById.get('P1').flowElements = [];
  noDefault.elementsById.get('P2').flowElements = [ noNamespaceTask ];
  noNamespaceTask.$parent = noDefault.elementsById.get('P2');
  const noDefaultOutput = (await window.moddle.toXML(noDefault.rootElement)).xml;
  const noNamespacePayload = new DOMParser().parseFromString(noDefaultOutput, 'application/xml').getElementsByTagName('payload')[0];
  assert.equal(noNamespacePayload.namespaceURI || null, null, 'absent source default namespace remains absent after reparenting');
  console.log('OK reparented/copied opaque QName values retain inherited namespace meaning');

  const typedContentXML = `<b:definitions xmlns:b="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" targetNamespace="urn:test"><b:process id="P"><b:documentation>before<!--mid-->after<?p x?>last</b:documentation><b:scriptTask id="S"><b:script>before<!--mid-->after<?p x?>last</b:script></b:scriptTask><b:task id="T"/><b:sequenceFlow id="F" sourceRef="S" targetRef="T"><b:conditionExpression xsi:type="b:tFormalExpression">before<!--mid-->after<?p x?>last</b:conditionExpression></b:sequenceFlow></b:process></b:definitions>`;
  const typedContent = await window.moddle.fromXML(typedContentXML);
  const typedOriginalDOM = new DOMParser().parseFromString(typedContentXML, 'application/xml');
  const typedOutput = (await window.moddle.toXML(typedContent.rootElement)).xml;
  const typedOutputDOM = new DOMParser().parseFromString(typedOutput, 'application/xml');
  for (const name of [ 'documentation', 'script', 'conditionExpression' ]) {
    const node = document => document.getElementsByTagNameNS('http://www.omg.org/spec/BPMN/20100524/MODEL', name)[0];
    assert.deepEqual(rawSequence(node(typedOutputDOM)), rawSequence(node(typedOriginalDOM)), name + ' mixed text/PI/comment order');
  }
  typedContent.elementsById.get('P').documentation[0].text = 'edited documentation';
  typedContent.elementsById.get('S').script = 'edited script';
  typedContent.elementsById.get('F').conditionExpression.body = 'edited expression';
  const typedEdited = (await window.moddle.toXML(typedContent.rootElement)).xml;
  for (const value of [ 'edited documentation', 'edited script', 'edited expression' ]) assert.ok(typedEdited.includes(value + '<!--mid--><?p x?>'));
  delete typedContent.elementsById.get('P').documentation[0].text;
  typedContent.elementsById.get('S').script = '';
  delete typedContent.elementsById.get('F').conditionExpression.body;
  const typedDeleted = (await window.moddle.toXML(typedContent.rootElement)).xml;
  assert.ok(!typedDeleted.includes('edited') && !typedDeleted.includes('before') && !typedDeleted.includes('after') && !typedDeleted.includes('last'));
  assert.equal(typedDeleted.split('<!--mid--><?p x?>').length - 1, 3);
  delete typedContent.elementsById.get('S').script;
  const deletedProperty = (await window.moddle.toXML(typedContent.rootElement)).xml;
  assert.equal(new DOMParser().parseFromString(deletedProperty, 'application/xml').getElementsByTagNameNS('http://www.omg.org/spec/BPMN/20100524/MODEL', 'script').length, 0, 'deleted scalar property does not resurrect XML wrapper');
  console.log('OK typed documentation/expression/script comment+PI order survives roundtrip, edits and deletion');

  const malformedTypeXML = `<b:definitions xmlns:b="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" targetNamespace="urn:test"><b:process id="P"><b:sequenceFlow id="F"><b:conditionExpression xsi:type="b:tFormalExpression:Other">opaque</b:conditionExpression></b:sequenceFlow></b:process></b:definitions>`;
  const malformedType = await window.moddle.fromXML(malformedTypeXML);
  assert.equal(malformedType.elementsById.get('F').conditionExpression.$descriptor.isGeneric, true);
  const malformedTypeOutput = (await window.moddle.toXML(malformedType.rootElement)).xml;
  assert.ok(malformedTypeOutput.includes('xsi:type="b:tFormalExpression:Other"'), 'malformed xsi:type remains opaque instead of coercing to a known subtype');
  console.log('OK malformed xsi:type QName is preserved opaquely without subtype reinterpretation');

  const insertionXML = `<b:definitions xmlns:b="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="urn:test"><b:process id="P"><b:startEvent id="Start"><b:outgoing>FlowA</b:outgoing></b:startEvent><b:subProcess id="Sub"><b:incoming>FlowA</b:incoming><b:outgoing>FlowB</b:outgoing><!--retained before nested task--><b:scriptTask id="Inner"><b:script>before<!--script-comment-->after<?script instruction?></b:script></b:scriptTask></b:subProcess><b:endEvent id="End"><b:incoming>FlowB</b:incoming></b:endEvent><b:sequenceFlow id="FlowA" sourceRef="Start" targetRef="Sub"/><b:sequenceFlow id="FlowB" sourceRef="Sub" targetRef="End"/></b:process></b:definitions>`;
  const insertion = await window.moddle.fromXML(insertionXML);
  for (const id of [ 'Sub', 'Inner' ]) {
    const owner = insertion.elementsById.get(id);
    owner.extensionElements = window.moddle.create('bpmn:ExtensionElements', { values: [ window.moddle.createAny('v:payload', 'urn:added', { ref: 'metadata' }) ] });
    owner.extensionElements.$parent = owner;
    owner.extensionElements.values[0].$parent = owner.extensionElements;
  }
  insertion.elementsById.get('Sub').documentation = [ window.moddle.create('bpmn:Documentation', { text: 'new documentation' }) ];
  insertion.elementsById.get('Sub').documentation[0].$parent = insertion.elementsById.get('Sub');
  insertion.elementsById.get('Inner').loopCharacteristics = window.moddle.create('bpmn:StandardLoopCharacteristics');
  insertion.elementsById.get('Inner').loopCharacteristics.$parent = insertion.elementsById.get('Inner');
  const insertionOutput = (await window.moddle.toXML(insertion.rootElement)).xml;
  await saveArtifact('new-child-properties.bpmn', insertionOutput);
  const insertionDOM = new DOMParser().parseFromString(insertionOutput, 'application/xml');
  const elementChildren = name => Array.from(insertionDOM.getElementsByTagNameNS('http://www.omg.org/spec/BPMN/20100524/MODEL', name)[0].childNodes).filter(node => node.nodeType === 1).map(node => node.localName);
  assert.deepEqual(elementChildren('subProcess'), [ 'documentation', 'extensionElements', 'incoming', 'outgoing', 'scriptTask' ]);
  assert.deepEqual(elementChildren('scriptTask'), [ 'extensionElements', 'standardLoopCharacteristics', 'script' ]);
  assert.ok(insertionOutput.includes('<!--retained before nested task-->'));
  assert.ok(insertionOutput.includes('before<!--script-comment-->after<?script instruction?>'));
  assert.equal((await oracle.fromXML(insertionOutput)).warnings.length, 0);
  console.log('OK newly added documentation/extensions/loop properties use canonical insertion without losing retained XML content');

  const interleavedXML = `<b:definitions xmlns:b="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:v="urn:vendor" targetNamespace="urn:test"><b:process id="P"><b:extensionElements><v:a/><!--extension-between--><?extension keep?><v:b/></b:extensionElements><b:task id="A"/><!--task-between--><?process keep?><b:task id="B"/></b:process></b:definitions>`;
  const interleaved = await window.moddle.fromXML(interleavedXML);
  const structuralSequence = node => Array.from(node.childNodes).filter(child => child.nodeType !== 3 || child.nodeValue.trim()).map(child => child.nodeType === 1 ? [ 1, child.namespaceURI, child.localName, child.getAttribute('id') ] : [ child.nodeType, child.nodeValue ]);
  const sourceInterleaved = new DOMParser().parseFromString(interleavedXML, 'application/xml');
  const firstInterleavedOutput = (await window.moddle.toXML(interleaved.rootElement)).xml;
  const firstInterleavedDOM = new DOMParser().parseFromString(firstInterleavedOutput, 'application/xml');
  for (const name of [ 'process', 'extensionElements' ]) {
    const node = document => document.getElementsByTagNameNS('http://www.omg.org/spec/BPMN/20100524/MODEL', name)[0];
    assert.deepEqual(structuralSequence(node(firstInterleavedDOM)), structuralSequence(node(sourceInterleaved)), name + ' repeated children retain interleaved comments/PI');
  }
  const interleavedProcess = interleaved.elementsById.get('P');
  interleavedProcess.flowElements.splice(0, 1);
  interleavedProcess.extensionElements.values.splice(0, 1);
  const removedInterleavedOutput = (await window.moddle.toXML(interleaved.rootElement)).xml;
  assert.ok(removedInterleavedOutput.includes('<!--task-between--><?process keep?><bpmn:task id="B"'));
  assert.ok(removedInterleavedOutput.includes('<!--extension-between--><?extension keep?><v:b'));
  assert.ok(!removedInterleavedOutput.includes('id="A"') && !removedInterleavedOutput.includes('<v:a'));
  const newTask = window.moddle.create('bpmn:Task', { id: 'C' });
  newTask.$parent = interleavedProcess;
  interleavedProcess.flowElements.unshift(newTask);
  const insertedInterleavedOutput = (await window.moddle.toXML(interleaved.rootElement)).xml;
  assert.equal((await oracle.fromXML(insertedInterleavedOutput)).warnings.length, 0);
  await saveArtifact('interleaved-child-edits.bpmn', insertedInterleavedOutput);
  console.log('OK repeated semantic/extension children retain interleaved comments/PI across removal and insertion');

  const genericIdsXML = `<b:definitions xmlns:b="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:v="urn:vendor" targetNamespace="urn:test"><b:process id="P"><b:extensionElements><v:record id="same"/><v:record id="same"/></b:extensionElements></b:process></b:definitions>`;
  const genericIds = await window.moddle.fromXML(genericIdsXML);
  assert.equal(genericIds.elementsById.has('same'), false, 'opaque vendor id is not registered as a BPMN ID');
  assert.equal(genericIds.elementsById.get('P').extensionElements.values.length, 2);
  const genericIdsOutput = (await window.moddle.toXML(genericIds.rootElement)).xml;
  const genericIdsOracle = await oracle.fromXML(genericIdsOutput);
  assert.equal(genericIdsOracle.warnings.length, 0);
  assert.deepEqual(genericIdsOracle.elementsById.P.extensionElements.values.map(record => record.id), [ 'same', 'same' ]);
  const recordPackage = { name: 'Typed records', prefix: 'records', uri: 'urn:records', xml: { tagAlias: 'lowerCase' }, types: [
    { name: 'Record', superClass: [ 'Element' ], properties: [ { name: 'key', type: 'String', isAttr: true, isId: true } ] },
    { name: 'RecordTask', extends: [ 'bpmn:Task' ], properties: [ { name: 'recordRef', type: 'Record', isAttr: true, isReference: true } ] }
  ] };
  const typedRecordModel = BpmnModdle({ records: recordPackage });
  const duplicateRecords = genericIdsXML.replace('xmlns:v="urn:vendor"', 'xmlns:v="urn:records"').replaceAll('id="same"', 'key="same"');
  await assert.rejects(typedRecordModel.fromXML(duplicateRecords), /duplicate ID/);
  const referencedRecordXML = `<b:definitions xmlns:b="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:records="urn:records" targetNamespace="urn:test"><b:process id="P"><b:extensionElements><records:record key="K1"/></b:extensionElements><b:task id="T" records:recordRef="K1"/></b:process></b:definitions>`;
  const typedRecords = await typedRecordModel.fromXML(referencedRecordXML);
  assert.equal(typedRecords.elementsById.get('T').recordRef, typedRecords.elementsById.get('K1'));
  const typedRecordOutput = (await typedRecordModel.toXML(typedRecords.rootElement)).xml;
  const typedRecordOracle = await new UpstreamModdle({ records: recordPackage }).fromXML(typedRecordOutput);
  assert.equal(typedRecordOracle.warnings.length, 0);
  assert.equal(typedRecordOracle.elementsById.T.recordRef.key, 'K1');
  console.log('OK generic vendor id attributes remain ordinary data; declared custom IDs enforce uniqueness and resolve/serialize references');

  const referenceTokensXML = `<b:definitions xmlns:b="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="urn:test"><b:process id="P"><b:task id="A"><b:outgoing>F1<!--FIRST--></b:outgoing><b:outgoing>F2<!--SECOND--></b:outgoing></b:task><b:task id="B"><b:incoming>F1</b:incoming><b:incoming>F2</b:incoming></b:task><b:sequenceFlow id="F1" sourceRef="A" targetRef="B"/><b:sequenceFlow id="F2" sourceRef="A" targetRef="B"/></b:process></b:definitions>`;
  const referenceTokens = await window.moddle.fromXML(referenceTokensXML);
  for (const [ id, property ] of [ [ 'A', 'outgoing' ], [ 'B', 'incoming' ], [ 'P', 'flowElements' ] ]) referenceTokens.elementsById.get(id)[property] = referenceTokens.elementsById.get(id)[property].filter(element => element.id !== 'F1');
  const referenceTokensOutput = (await window.moddle.toXML(referenceTokens.rootElement)).xml;
  assert.ok(referenceTokensOutput.includes('>F2<!--SECOND--></bpmn:outgoing>'));
  assert.ok(!referenceTokensOutput.includes('FIRST'), 'deleted reference body comments must not migrate to remaining reference');
  assert.equal((await oracle.fromXML(referenceTokensOutput)).warnings.length, 0);
  await saveArtifact('repeated-reference-removal.bpmn', referenceTokensOutput);
  console.log('OK repeated reference body metadata follows reference identity after array removal');

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
  delete globalThis.window;
}
