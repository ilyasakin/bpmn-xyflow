import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { readFile } from 'node:fs/promises';
import { BpmnModdle } from 'bpmn-moddle';
import { setupDOM } from '../helpers/dom.mjs';
let dom, Modeler;
before(async()=>{dom=await setupDOM();({default:Modeler}=await dom.loadModule('/lib/Modeler.js'));});
after(async()=>{await dom.cleanup();});
function random(seed) { return () => { seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296; }; }
for(const seed of [17,2026,7331]) test(`seeded repeated modeling transitions preserve semantic/graph invariants (${seed})`,async()=>{
  const model=new Modeler({container:dom.createContainer(),palette:false,fitViewOnInit:false});
  const oracle=new BpmnModdle(),next=random(seed);
  await model.importXML(await readFile('test/fixtures/bpmn/basic.bpmn','utf8'));
  const pick=list=>list[Math.floor(next()*list.length)];
  try {
    for(let step=0;step<60;step++) {
      const tasks=model.getGraph().nodes.filter(node=>node.businessObject.$instanceOf('bpmn:Task'));
      const node=pick(tasks), action=Math.floor(next()*9);
      if(action===0||!node)model.addShape('bpmn:Task',{x:200+next()*800,y:100+next()*500});
      else if(action===1)model.moveShape(node,{x:Math.round(next()*50)-25,y:Math.round(next()*50)-25});
      else if(action===2)model.updateLabel(node,`Task ${seed}/${step} & review <pending>`);
      else if(action===3)model.connect(node,pick(tasks));
      else if(action===4)model.replace(node,node.type==='bpmn:Task'?'bpmn:ServiceTask':'bpmn:Task');
      else if(action===5){model.copy([node]);model.paste({x:1000+step*10,y:200});}
      else if(action===6)model.delete(node);
      else if(action===7)model.undo();
      else model.redo();
      const graph=model.getGraph(), ids=graph.nodes.concat(graph.edges).map(element=>element.id);
      assert.equal(new Set(ids).size,ids.length,`step ${step}: duplicate graph IDs`);
      for(const shape of graph.nodes.filter(shape=>shape.type!=='label')) {
        assert.ok([shape.x,shape.y,shape.width,shape.height].every(Number.isFinite),`step ${step}: nonfinite geometry`);
        assert.equal(shape.di.bounds.x,shape.x);assert.equal(shape.di.bounds.y,shape.y);
        assert.equal(shape.di.bounds.width,shape.width);assert.equal(shape.di.bounds.height,shape.height);
        assert.equal(shape.di.bpmnElement,shape.businessObject);
        assert.ok(!shape.parent||shape.parent.children.includes(shape),`step ${step}: missing parent child link`);
      }
      for(const edge of graph.edges) {
        assert.equal(model.getElement(edge.source.id),edge.source);assert.equal(model.getElement(edge.target.id),edge.target);
        assert.equal(edge.businessObject.sourceRef,edge.source.businessObject);assert.equal(edge.businessObject.targetRef,edge.target.businessObject);
        assert.equal(edge.di.bpmnElement,edge.businessObject);
        assert.equal(edge.businessObject.$parent,edge.source.businessObject.$parent);
        assert.equal(edge.waypoints.length,edge.di.waypoint.length);
      }
      const xml=await model.getXML(), parsed=await oracle.fromXML(xml);
      assert.deepEqual(parsed.warnings,[],`step ${step}: upstream warnings`);
      if(step%20===19){
        const canonicalBefore=(await oracle.toXML(parsed.rootElement)).xml;
        await model.importXML(xml);
        const reopened=await oracle.fromXML(await model.getXML());
        assert.deepEqual(reopened.warnings,[]);
        assert.equal((await oracle.toXML(reopened.rootElement)).xml,canonicalBefore,`step ${step}: semantic save/reopen instability`);
      }
    }
  } finally {model.destroy();}
});
