import assert from 'node:assert/strict';
import { after,test } from 'node:test';
import { createRequire } from 'node:module';
import { setupDOM } from '../helpers/dom.mjs';
const dom=await setupDOM(),require=createRequire(import.meta.url),up=createRequire(require.resolve('bpmn-js/package.json'));
const load=path=>dom.loadModule(up.resolve(`diagram-js/lib/${path}.js`));
const {default:EventBus}=await load('core/EventBus'),{default:Grid}=await load('features/grid-snapping/GridSnapping');
const {default:ResizeSnapping}=await load('features/snapping/ResizeSnapping'),{default:Snapping}=await load('features/snapping/Snapping');
const {default:Resize}=await load('features/resize/Resize'),util=await load('features/resize/ResizeUtil'),layout=await load('layout/LayoutUtil');
const {externalLabelResizeBounds}=await dom.loadModule('/lib/modeling/ExternalLabelResize.js');
after(()=>dom.cleanup());
function oracle(original,direction,delta,targets=[],round=true){
 const bus=new EventBus(),grid=new Grid({},bus),snapping=Object.create(Snapping.prototype);
 snapping.showSnapLine=()=>{};snapping.hide=()=>{};new ResizeSnapping(bus,snapping);grid.setActive(true);
 const shape={...original,id:'label',type:'label',labelTarget:{},parent:{id:'root',children:targets}};
 const origin=direction==='e'?shape.x+shape.width:shape.x;
 const context={shape,direction,resizeConstraints:{min:layout.asTRBL(Resize.prototype.computeMinResizeBox({shape,direction}))}};
 bus.fire('resize.start',{context,x:origin,y:shape.y+shape.height/2});
 const event=bus.createEvent({context,x:origin+delta,y:shape.y+shape.height/2,dx:delta,dy:0});
 bus.fire('resize.move',event);
 const b=util.ensureConstraints(util.resizeBounds(shape,direction,{x:event.dx,y:0}),context.resizeConstraints);
 return round?layout.roundBounds(b):b;
}
const bounds={x:519,y:200,width:203,height:20};
test('default label grid and directional minimum match actual pinned resize event pipeline',()=>{
 for(const original of [bounds,{x:547,y:200,width:48,height:20},{x:13.4,y:29.7,width:98.6,height:18.2}])for(const direction of ['e','w'])for(const delta of [-300,-88,-70,-7,-6,0,6,7,8,30.5,88,300])for(const round of [true,false]){
  const actual=externalLabelResizeBounds(original,direction,delta,{snap:true,round}),expected=oracle(original,direction,delta,[],round);
  if(round)assert.deepEqual(actual,expected,JSON.stringify({original,direction,delta,round}));
  else for(const key of ['x','y','width','height'])assert.ok(Math.abs(actual[key]-expected[key])<1e-10,`preview ${key}: ${actual[key]} vs ${expected[key]}`);
 }
 assert.equal(externalLabelResizeBounds(bounds,'e',-70,{snap:true}).width,131);
 assert.equal(externalLabelResizeBounds({x:547,y:200,width:48,height:20},'e',-88,{snap:true}).width,13);
 assert.equal(externalLabelResizeBounds({x:547,y:200,width:48,height:20},'w',88,{snap:true}).width,15);
});
test('first eligible sibling border wins before grid, with original edge snap and filtering',()=>{
 const targets=[{id:'first',x:650,y:100,width:4,height:50},{id:'second',x:648,y:0,width:2,height:50},
  {id:'hidden',x:621,y:0,width:20,height:20,hidden:true},{id:'label',x:600,y:0,width:30,height:20,type:'label',labelTarget:{}},
  {id:'edge',waypoints:[{x:0,y:0},{x:600,y:0}]}];
 for(const direction of ['e','w'])for(const delta of [-100,-75,-70,-68,-64,-7,0,7,20,100]){
  assert.deepEqual(externalLabelResizeBounds(bounds,direction,delta,{snap:true,snapTargets:targets}),oracle(bounds,direction,delta,targets));
 }
 assert.equal(externalLabelResizeBounds(bounds,'e',-70,{snap:true,snapTargets:targets}).width,135,'first right border wins, rather than nearest border');
 assert.deepEqual(externalLabelResizeBounds(bounds,'e',6,{snap:true}),bounds);
});
test('explicit unsnapped planning preserves raw preview and exact 10px minimum without mutating targets',()=>{
 const targets=[{x:650,y:100,width:4,height:50}],before=JSON.stringify(targets);
 assert.equal(externalLabelResizeBounds(bounds,'e',-70,{snap:false,snapTargets:targets}).width,133);
 assert.equal(externalLabelResizeBounds(bounds,'e',-999,{snap:false}).width,10);
 externalLabelResizeBounds(bounds,'e',-70,{snap:true,snapTargets:targets});assert.equal(JSON.stringify(targets),before);
});
