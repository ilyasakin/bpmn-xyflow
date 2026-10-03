import assert from 'node:assert/strict';
import { test,after } from 'node:test';
import { readFile } from 'node:fs/promises';
import { BpmnModdle } from 'bpmn-moddle';
import { setupDOM } from '../helpers/dom.mjs';
import { assertLabelReferenceImport } from '../helpers/label-reopen-oracle.mjs';
const dom=await setupDOM();after(()=>dom.cleanup());
const {default:Upstream}=await dom.loadModule('/node_modules/bpmn-js/lib/Modeler.js');
const {default:Local}=await dom.loadModule('/lib/Modeler.js');
const canonical=async xml=>{const oracle=new BpmnModdle(),result=await oracle.fromXML(xml);assert.deepEqual(result.warnings,[]);return(await oracle.toXML(result.rootElement,{format:true})).xml;};
for(const name of['approval-rejection-rework','booking-timeout-compensation'])test(`${name} local import preserves all DI while the pinned reference applies only measured normalization`,async()=>{
 const xml=await readFile(`test/fixtures/scenarios/${name}.bpmn`,'utf8'),local=new Local({container:dom.createContainer(),fitViewOnInit:false}),upstream=new Upstream({container:dom.createContainer()});
 try{await local.importXML(xml);const localXML=await local.getXML();assert.equal(await canonical(localXML),await canonical(xml));await upstream.importXML(localXML);const reference=(await upstream.saveXML({format:true})).xml;
  const changes=await assertLabelReferenceImport(localXML,reference);assert.ok(changes.some(change=>change.kind==='canvas-order'));assert.equal(changes.some(change=>change.kind==='default-marker'),name.startsWith('approval'));
  await local.importXML(localXML);assert.equal(await canonical(await local.getXML()),await canonical(localXML),'local reopen retains entire model exactly');
 }finally{local.destroy();upstream.destroy();}
});

test('reference-import allowance still rejects coordinate, reference, marker, membership and opaque metadata corruption',async()=>{
 const xml=await readFile('test/fixtures/scenarios/approval-rejection-rework.bpmn','utf8'),m=new Upstream({container:dom.createContainer()}),oracle=new BpmnModdle();
 try{
  await m.importXML(xml);const reference=(await m.saveXML({format:true})).xml;await assertLabelReferenceImport(xml,reference);
  const edits=[
    ids=>{ids.ApprovalDecision_di.bounds.x+=.125;},
    ids=>{ids.ApproveFlow.targetRef=ids.ReworkRequest;},
    ids=>{ids.ApprovalDecision_di.isMarkerVisible=false;},
    ids=>{ids.ApproveFlow_di.$parent.planeElement.splice(ids.ApproveFlow_di.$parent.planeElement.indexOf(ids.ApproveFlow_di),1);},
    ids=>{ids.ApprovalDecision.extensionElements=oracle.create('bpmn:ExtensionElements',{values:[oracle.createAny('qa:unexpected','urn:qa:unexpected',{$body:'Unexpected extension'})]});},
    ids=>{ids.ApprovalDecision_di.id='UnknownGatewayDI';}
  ];
  for(const edit of edits){const parsed=await oracle.fromXML(reference);edit(parsed.elementsById);await assert.rejects(assertLabelReferenceImport(xml,(await oracle.toXML(parsed.rootElement)).xml));}
  const reordered=await oracle.fromXML(reference);reordered.rootElement.diagrams[0].plane.planeElement.reverse();const badOrder=(await oracle.toXML(reordered.rootElement)).xml;await assert.rejects(assertLabelReferenceImport(xml,badOrder));await assert.rejects(assertLabelReferenceImport(badOrder,reference));
 }finally{m.destroy();}
});
