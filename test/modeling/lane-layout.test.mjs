import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { setupDOM } from '../helpers/dom.mjs';
import { laneSplitBounds, laneDeletionBounds } from '../../lib/modeling/LaneLayout.js';
import { BpmnModdle } from '../../lib/bpmn/moddle.js';
let dom, SplitLane;
before(async()=>{dom=await setupDOM();({default:SplitLane}=await dom.loadModule('/node_modules/bpmn-js/lib/features/modeling/cmd/SplitLaneHandler.js'));});
after(async()=>{await dom.cleanup();});
test('split lane geometry agrees with upstream SplitLaneHandler for both orientations and existing children',()=>{
 const moddle=BpmnModdle();let comparisons=0;
 for(const isHorizontal of [true,false])for(const count of [1,2,3,4])for(const existing of [0,1])for(const width of [501,600]){
  const shape={id:'Lane',type:'bpmn:Lane',businessObject:moddle.create('bpmn:Lane'),di:{isHorizontal},x:73,y:41,width,height:403,children:[]};
  shape.children=Array.from({length:existing},(_,index)=>({id:'Child'+index,type:'bpmn:Lane',businessObject:moddle.create('bpmn:Lane'),parent:shape}));
  const actual=[];const handler=new SplitLane({createShape:(_attrs,bounds)=>actual.push(bounds),resizeShape:(_node,bounds)=>actual.push(bounds)});
  handler.preExecute({shape,count});assert.deepEqual(laneSplitBounds(shape,count),actual);comparisons++;
 }
 assert.equal(comparisons,32);
});
test('lane deletion balances adjacent lane bounds without moving their child elements',()=>{
 const parent={di:{isHorizontal:true}};
 const before={parent,di:parent.di,x:30,y:0,width:600,height:120};
 const lane={parent,di:parent.di,x:30,y:120,width:600,height:80};
 const after={parent,di:parent.di,x:30,y:200,width:600,height:120};
 assert.deepEqual(laneDeletionBounds(lane,[before,after]).map(p=>p.bounds),[
  {x:30,y:0,width:600,height:160},{x:30,y:160,width:600,height:160}
 ]);
});
