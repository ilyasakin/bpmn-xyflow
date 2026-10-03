import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { BpmnModdle } from 'bpmn-moddle';
import { setupDOM } from '../helpers/dom.mjs';
import { paintReferenceExpectation } from '../helpers/connection-paint-oracles.mjs';

let dom, Upstream, Local, xml;
const gatewayId='ExclusiveGateway_murosu17_1';
const canonical=async xml=>{
  const moddle=new BpmnModdle(),parsed=await moddle.fromXML(xml);
  assert.deepEqual(parsed.warnings,[]);
  return (await moddle.toXML(parsed.rootElement,{format:true})).xml;
};
before(async()=>{
  dom=await setupDOM();
  ({default:Upstream}=await dom.loadModule('/node_modules/bpmn-js/lib/Modeler.js'));
  ({default:Local}=await dom.loadModule('/lib/Modeler.js'));
  xml=await readFile('test/fixtures/connection-paint/gateway-one-pixel-reconnected.bpmn','utf8');
});
after(()=>dom.cleanup());

test('actual pinned import of the hosted gateway export changes only its absent marker flag',async()=>{
  const modeler=new Upstream({container:dom.createContainer()});
  try {
    assert.deepEqual((await modeler.importXML(xml)).warnings,[]);
    const after=(await modeler.saveXML({format:true})).xml;
    const expected=await paintReferenceExpectation(xml,gatewayId);
    assert.equal(await canonical(after),expected.canonical,'complete model and DI, with exactly the measured marker addition');
    assert.notEqual(await canonical(xml),expected.canonical);
    assert.deepEqual(expected.adjustment,{gatewayId,diId:gatewayId+'_di',property:'isMarkerVisible',before:'absent',after:true});
    assert.equal(modeler.get('commandStack').canUndo(),false);
    // An explicit false or true remains authored, and cannot use the absent-only allowance.
    for(const value of [false,true]) {
      const explicit=xml.replace(`bpmnElement="${gatewayId}">`,`bpmnElement="${gatewayId}" isMarkerVisible="${value}">`);
      assert.notEqual(explicit,xml);
      await modeler.importXML(explicit);
      assert.equal(await canonical((await modeler.saveXML({format:true})).xml),await canonical(explicit));
      await assert.rejects(paintReferenceExpectation(explicit,gatewayId),/implicit-marker case/);
    }
  } finally {modeler.destroy();}
});

test('local reopen of the hosted export preserves its exact model without applying the reference marker addition',async()=>{
  const modeler=new Local({container:dom.createContainer(),fitViewOnInit:false,palette:false,editorActions:false});
  try {
    await modeler.importXML(xml);
    const reopened=await modeler.getXML();
    // Existing local serializer makes newly created dc:Point typing explicit.
    // Check that exact raw change, plus whole-model equality, without dropping DI.
    assert.equal(reopened,xml.replaceAll('<di:waypoint ','<di:waypoint xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="dc:Point" '));
    assert.equal(await canonical(reopened),await canonical(xml));
    assert.equal(modeler.commandStack.size(),0);
    const gateway=modeler.getElement(gatewayId);
    assert.equal(Object.hasOwn(gateway.di,'isMarkerVisible'),false);
  } finally {modeler.destroy();}
});

test('one-property reference expectation rejects unrelated DI, route, semantic and metadata loss',async()=>{
  const expected=await paintReferenceExpectation(xml,gatewayId);
  const corruptions=[
    ['waypoint',text=>text.replace('x="-140"','x="-141"')],
    ['Task bounds',text=>text.replace('x="-7" y="-178"','x="-8" y="-178"')],
    ['label bounds',text=>text.replace('x="-342"','x="-343"')],
    ['process semantic',text=>text.replace('isExecutable="false"','isExecutable="true"')],
    ['DI owner metadata',text=>text.replace(`id="${gatewayId}_di"`,`id="${gatewayId}_changed_di"`)],
    ['gateway semantic',text=>text.replace(`<bpmn:exclusiveGateway id="${gatewayId}">`,`<bpmn:exclusiveGateway id="${gatewayId}" name="unexpected">`)],
    ['waypoint metadata',text=>text.replace('<di:waypoint x="-140"','<di:waypoint xmlns:test="urn:paint-test" test:lost="value" x="-140"')]
  ];
  for(const [name,change]of corruptions) {
    const changed=change(expected.canonical);assert.notEqual(changed,expected.canonical,name+' fixture is changed');
    assert.notEqual(await canonical(changed),expected.canonical,name+' must fail complete-model equality');
  }
  await assert.rejects(paintReferenceExpectation(xml,'Task_murosu77_2'),/palette gateway/);
});
