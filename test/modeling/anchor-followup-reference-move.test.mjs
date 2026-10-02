import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { BpmnModdle } from 'bpmn-moddle';
import { setupDOM } from '../helpers/dom.mjs';
import { assertReferenceBodyMove } from '../helpers/anchor-followup-reference-move.mjs';

let dom, Modeler; const oracle = new BpmnModdle(), h = { oracle };
before(async()=>{dom=await setupDOM();globalThis.MouseEvent=dom.window.MouseEvent;({default:Modeler}=await dom.loadModule('/node_modules/bpmn-js/lib/Modeler.js'));});
after(async()=>{delete globalThis.MouseEvent;await dom.cleanup();});
const fixture=loop=>`<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:v="urn:keep" id="Defs" targetNamespace="urn:test"><bpmn:process id="Process" v:keep="yes"><bpmn:${loop?'task':'startEvent'} id="Source">${loop?'<bpmn:incoming>Loop</bpmn:incoming><bpmn:outgoing>Loop</bpmn:outgoing>':''}</bpmn:${loop?'task':'startEvent'}><bpmn:task id="Target" name="Preserve this"/>${loop?'<bpmn:sequenceFlow id="Loop" sourceRef="Source" targetRef="Source"/>':''}</bpmn:process><bpmndi:BPMNDiagram id="Diagram"><bpmndi:BPMNPlane id="Plane" bpmnElement="Process"><bpmndi:BPMNShape id="Source_di" bpmnElement="Source"><dc:Bounds x="100" y="100" width="${loop?100:36}" height="${loop?80:36}"/></bpmndi:BPMNShape><bpmndi:BPMNShape id="Target_di" bpmnElement="Target"><dc:Bounds x="440" y="100" width="100" height="80"/></bpmndi:BPMNShape>${loop?'<bpmndi:BPMNEdge id="Loop_di" bpmnElement="Loop"><di:waypoint x="200" y="140"/><di:waypoint x="240" y="140"/><di:waypoint x="240" y="220"/><di:waypoint x="150" y="220"/><di:waypoint x="150" y="180"/></bpmndi:BPMNEdge>':''}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`;

for(const loop of [false,true])test(`pinned ${loop?'self-loop Task':'StartEvent'} move has one exact DI ordering change and reversible full-model history`,async()=>{
  const m=new Modeler({container:dom.createContainer()});
  try{
    assert.deepEqual((await m.importXML(fixture(loop))).warnings,[]);const save=async()=>(await m.saveXML({format:true})).xml;
    const before={xml:await save()},shape=m.get('elementRegistry').get('Source');m.get('modeling').moveElements([shape],{x:40,y:40},shape.parent);const after={xml:await save()};
    await assertReferenceBodyMove(h,before,after,'Source');
    const malformed=await oracle.fromXML(before.xml),items=malformed.rootElement.diagrams[0].plane.planeElement;
    malformed.rootElement.diagrams[0].plane.planeElement=loop?[items[2],items[0],items[1]]:[items[1],items[0]];
    await assert.rejects(assertReferenceBodyMove(h,{xml:(await oracle.toXML(malformed.rootElement,{format:true})).xml},after,'Source'),/fresh/);
    const p=await oracle.fromXML(after.xml);assert.deepEqual(p.rootElement.diagrams[0].plane.planeElement.map(d=>d.id),['Target_di','Source_di',...(loop?['Loop_di']:[])]);
    for(const mutate of [p=>{p.elementsById.Target_di.bounds.x++;},p=>{p.elementsById.Process.$attrs['v:keep']='changed';},p=>{p.elementsById.Source.name='unexpected';},p=>{p.rootElement.diagrams[0].plane.planeElement.reverse();}]){
      const changed=await oracle.fromXML(after.xml);mutate(changed);await assert.rejects(assertReferenceBodyMove(h,before,{xml:(await oracle.toXML(changed.rootElement,{format:true})).xml},'Source'));
    }
    for(let i=0;i<3;i++){m.get('commandStack').undo();assert.equal(await save(),before.xml);m.get('commandStack').redo();assert.equal(await save(),after.xml);}
  }finally{m.destroy();}
});

test('fresh Task then EndEvent movement retains its already-correct DI order',async()=>{
  const xml=fixture(false).replaceAll('bpmn:startEvent','bpmn:task').replace('<bpmn:task id="Target" name="Preserve this"/>','<bpmn:endEvent id="Target"/>').replace('x="100" y="100" width="36" height="36"','x="100" y="100" width="100" height="80"').replace('x="440" y="100" width="100" height="80"','x="440" y="100" width="36" height="36"');
  const m=new Modeler({container:dom.createContainer()});
  try{
    await m.importXML(xml);const save=async()=>(await m.saveXML({format:true})).xml,before={xml:await save()},target=m.get('elementRegistry').get('Target');
    m.get('modeling').moveElements([target],{x:0,y:60},target.parent);const after={xml:await save()};await assertReferenceBodyMove(h,before,after,'Target');
    const parsed=await oracle.fromXML(after.xml);assert.deepEqual(parsed.rootElement.diagrams[0].plane.planeElement.map(d=>d.id),['Source_di','Target_di']);
    m.get('commandStack').undo();assert.equal(await save(),before.xml);m.get('commandStack').redo();assert.equal(await save(),after.xml);
  }finally{m.destroy();}
});

test('installed GlobalConnect activates a refused same-pool return even when its preview collapses to zero length',async()=>{
  const m=new Modeler({container:dom.createContainer(),autoScroll:{scrollThresholdIn:[0,0,0,0],scrollThresholdOut:[0,0,0,0]}});
  try{
    await m.importXML(await readFile('test/fixtures/scenarios/order-payment-delivery.bpmn','utf8'));
    const pool=m.get('elementRegistry').get('BuyerPool'),gfx=m.get('elementRegistry').getGraphics(pool),dragging=m.get('dragging'),point={x:30,y:90};
    const event=(type,p)=>new MouseEvent(type,{clientX:p.x,clientY:p.y,button:0,buttons:type==='mouseup'?0:1,bubbles:true,cancelable:true,view:window});
    const before=(await m.saveXML({format:true})).xml;
    m.get('globalConnect').start(event('mousedown',{x:44,y:180}),true);
    dragging.hover({element:pool,gfx});dragging.move(event('mousemove',point));dragging.end(event('mouseup',point));
    m.get('eventBus').fire('element.out',{element:pool,gfx,originalEvent:event('mousemove',{x:390,y:230})});
    dragging.move(event('mousemove',{x:390,y:230}));dragging.hover({element:pool,gfx});dragging.move(event('mousemove',point));
    const d=dragging.context(),c=d.data.context;assert.equal(d.active,true);assert.equal(d.prefix,'connect');assert.equal(c.canExecute,false);assert.equal(c.start,pool);assert.equal(c.hover,pool);
    const path=m.get('canvas').getActiveLayer().querySelector('.djs-dragger > path');assert.equal(path?.getAttribute('d'),'M30,90L30,90');
    dragging.end(event('mouseup',point));assert.equal((await m.saveXML({format:true})).xml,before);assert.equal(m.get('commandStack').canUndo(),false);
  }finally{m.destroy();}
});
