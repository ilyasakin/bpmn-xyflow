import assert from 'node:assert/strict';
import { after,test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { setupDOM } from '../helpers/dom.mjs';
const dom=await setupDOM();
const {layoutImportedLabels}=await dom.loadModule('/lib/util/ImportedLabelLayout.js');
const {parseBpmnXML,buildGraph}=await dom.loadModule('/lib/Importer.js');
const {default:TextRenderer}=await dom.loadModule('/lib/draw/TextRenderer.js');
const {default:UpstreamTextRenderer}=await dom.loadModule('/node_modules/bpmn-js/lib/draw/TextRenderer.js');
const {default:UpstreamImporter}=await dom.loadModule('/node_modules/bpmn-js/lib/import/BpmnImporter.js');
const {BpmnModdle}=await dom.loadModule('/lib/bpmn/moddle.js');
const {default:Viewer}=await dom.loadModule('/lib/Viewer.js');
after(()=>dom.cleanup());
const bounds=n=>({x:n.x,y:n.y,width:n.width,height:n.height});
function upstreamLabel(owner,renderer){return UpstreamImporter.prototype.addLabel.call({_textRenderer:renderer,_elementFactory:{createLabel:data=>data},_canvas:{addShape:label=>label}},owner.businessObject,owner.di,owner);}

test('imported label display matches actual upstream addLabel for fractional and narrow DI without mutation',async()=>{
  const moddle=BpmnModdle();
  for(const type of ['bpmn:StartEvent','bpmn:ExclusiveGateway','bpmn:SequenceFlow'])for(const width of [10,40,90,240])for(const name of ['Approved','Approve every corrected travel reservation after review','Line one\nLine two']) {
    const bo=moddle.create(type,{id:'Owner',name}),di=moddle.create(type==='bpmn:SequenceFlow'?'bpmndi:BPMNEdge':'bpmndi:BPMNShape',{id:'Owner_di',bpmnElement:bo});
    const labelDi=moddle.create('bpmndi:BPMNLabel',{id:'Label_di',bounds:moddle.create('dc:Bounds',{x:500.25,y:500.5,width,height:77.25})});di.label=labelDi;
    const owner={id:bo.id,type,businessObject:bo,di,parent:{id:'Process_1'},x:200,y:200,width:50,height:50};
    if(type==='bpmn:SequenceFlow')owner.waypoints=[{x:200,y:200},{x:500,y:200}];
    const label={id:'Owner_label',type:'label',labelTarget:owner,di,businessObject:bo,x:0,y:0,width:0,height:0},graph={nodes:[owner,label]};owner.label=label;
    const saved=bounds(labelDi.bounds),array=graph.nodes;
    assert.equal(layoutImportedLabels(graph,new TextRenderer()),graph);assert.equal(graph.nodes,array);
    assert.deepEqual(bounds(label),bounds(upstreamLabel(owner,new UpstreamTextRenderer())));
    assert.deepEqual(bounds(labelDi.bounds),saved,'layout never overwrites saved narrow/fractional DI');assert.equal(di.label,labelDi);assert.equal(label.di,di);
    assert.deepEqual({x:owner.x,y:owner.y,width:owner.width,height:owner.height},{x:200,y:200,width:50,height:50});
  }
});

test('configured text styles and absent label DI use upstream display measurement',()=>{
  const moddle=BpmnModdle(),config={externalStyle:{fontSize:18,fontFamily:'Arial, sans-serif',lineHeight:1.4}};
  const bo=moddle.create('bpmn:EndEvent',{id:'End',name:'Reservations complete'}),di=moddle.create('bpmndi:BPMNShape',{id:'End_di',bpmnElement:bo});
  const owner={id:'End',type:bo.$type,businessObject:bo,di,parent:{id:'Process_1'},x:100,y:100,width:36,height:36};
  const label={id:'End_label',type:'label',businessObject:bo,labelTarget:owner,di};
  layoutImportedLabels({nodes:[owner,label]},new TextRenderer(config));
  assert.deepEqual(bounds(label),bounds(upstreamLabel(owner,new UpstreamTextRenderer(config))));assert.equal(di.label,undefined,'measurement must not synthesize BPMNLabel DI');
});

for(const name of ['approval-rejection-rework','booking-timeout-compensation'])test(`${name}: every imported external label matches upstream while serialized semantics/DI stay exact`,async()=>{
  const moddle=BpmnModdle(),xml=await readFile(`test/fixtures/scenarios/${name}.bpmn`,'utf8'),definitions=(await parseBpmnXML(xml,moddle)).rootElement;
  const graph=buildGraph(definitions),saved=(await moddle.toXML(definitions)).xml,renderer=new TextRenderer(),upstream=new UpstreamTextRenderer();
  const expected=new Map(graph.nodes.filter(n=>n.type==='label').map(label=>[label.id,bounds(upstreamLabel(label.labelTarget,upstream))]));
  assert.ok(expected.size);layoutImportedLabels(graph,renderer);
  for(const label of graph.nodes.filter(n=>n.type==='label'))assert.deepEqual(bounds(label),expected.get(label.id),label.id);
  assert.equal((await moddle.toXML(definitions)).xml,saved);layoutImportedLabels(graph,renderer);assert.equal((await moddle.toXML(definitions)).xml,saved,'repeated display layout is non-mutating');
});

test('actual Viewer import and diagram reentry use measured display bounds while preserving narrow saved DI',async()=>{
  const moddle=BpmnModdle(),definitions=(await parseBpmnXML(await readFile('test/fixtures/scenarios/approval-rejection-rework.bpmn','utf8'),moddle)).rootElement;
  const di=definitions.diagrams[0].plane.planeElement.find(d=>d.bpmnElement.id==='ApproveFlow');
  di.bpmnElement.name='Approved';di.label=moddle.create('bpmndi:BPMNLabel',{id:'NarrowLabel',bounds:moddle.create('dc:Bounds',{x:500.25,y:500.5,width:10,height:130.25})});
  const xml=(await moddle.toXML(definitions)).xml,viewer=new Viewer({container:dom.createContainer(),fitViewOnInit:false,moddle});
  const exportedXML=async()=>(await viewer.getModdle().toXML(viewer.getDefinitions())).xml;
  try{
    await viewer.importXML(xml);const owner=viewer.getElement('ApproveFlow'),label=owner.label,saved=bounds(owner.di.label.bounds),upstream=new UpstreamTextRenderer();
    assert.deepEqual(bounds(label),bounds(upstreamLabel(owner,upstream)));assert.notEqual(label.width,saved.width,'display measurement is distinct from saved chosen width');
    const before=await exportedXML();await viewer.switchDiagram(viewer.getGraph().diagram.id);
    assert.deepEqual(bounds(viewer.getElement('ApproveFlow').label),bounds(upstreamLabel(viewer.getElement('ApproveFlow'),upstream)));
    assert.deepEqual(bounds(viewer.getElement('ApproveFlow').di.label.bounds),saved);assert.equal(await exportedXML(),before);
    const reparsed=(await moddle.fromXML(await exportedXML())).rootElement;
    assert.equal((await moddle.toXML(reparsed)).xml,(await moddle.toXML(definitions)).xml,'actual import/export retains source semantics and narrow DI');
  }finally{viewer.destroy();}
});
