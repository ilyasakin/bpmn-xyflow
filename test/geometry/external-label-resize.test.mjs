import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createRequire } from 'node:module';
import { setupDOM } from '../helpers/dom.mjs';

const dom=await setupDOM();
const {externalLabelResizeBounds,layoutExternalLabelBounds}=await dom.loadModule('/lib/modeling/ExternalLabelResize.js');
const {default:LabelBehavior}=await dom.loadModule('/node_modules/bpmn-js/lib/features/modeling/behavior/LabelBehavior.js');
const {default:EventBus}=await dom.loadModule('/node_modules/diagram-js/lib/core/EventBus.js');
const require=createRequire(import.meta.url),upstreamRequire=createRequire(require.resolve('bpmn-js/package.json'));
const {default:UpstreamResize}=await dom.loadModule(upstreamRequire.resolve('diagram-js/lib/features/resize/Resize.js'));
const upstreamUtil=await dom.loadModule(upstreamRequire.resolve('diagram-js/lib/features/resize/ResizeUtil.js'));
const upstreamLayout=await dom.loadModule(upstreamRequire.resolve('diagram-js/lib/layout/LayoutUtil.js'));
const {default:TextRenderer}=await dom.loadModule('/lib/draw/TextRenderer.js');
const {BpmnModdle}=await dom.loadModule('/lib/bpmn/moddle.js');
const {default:BpmnRules}=await dom.loadModule('/node_modules/bpmn-js/lib/features/rules/BpmnRules.js');
const moddle=new BpmnModdle();
after(()=>dom.cleanup());
const bounds={x:100,y:200,width:140,height:20};
function label(text='Approve the corrected travel reservation after manager review',type='bpmn:ExclusiveGateway'){
  const businessObject=moddle.create(type,{id:'Owner',name:text}),owner={id:'Owner',type,businessObject,x:300,y:100,width:50,height:50,di:{bounds:{x:300,y:100,width:50,height:50}}};
  const result={...bounds,type:'label',id:'Owner_label',businessObject,labelTarget:owner,di:{bounds:{...bounds}},text};owner.label=result;return result;
}
function upstreamBounds(original,direction,deltaX,round=true){
  const resize=Object.create(UpstreamResize.prototype);
  const minimum=resize.computeMinResizeBox({shape:original,direction});
  const next=upstreamUtil.ensureConstraints(upstreamUtil.resizeBounds(original,direction,{x:deltaX,y:0}),{min:upstreamLayout.asTRBL(minimum)});
  return round?upstreamLayout.roundBounds(next):next;
}
function upstreamLabelBounds(shape,newBounds,renderer){const bus=new EventBus();new LabelBehavior(bus,{}, {},renderer);const context={shape,newBounds:{...newBounds}};bus.fire('commandStack.shape.resize.preExecute',{context});return context.newBounds;}

test('external-label e/w directions and 10px constraints match pinned upstream Resize',()=>{
  for(const original of [bounds,{x:100.3,y:200.7,width:140.5,height:20.4},{x:0,y:0,width:5,height:0}]){
    for(const direction of ['e','w'])for(const delta of [-300,-30.5,0,35.7,300])for(const round of [true,false]){
      assert.deepEqual(externalLabelResizeBounds(original,direction,delta,{round}),upstreamBounds(original,direction,delta,round));
    }
  }
  const shape=label();
  for(const direction of ['e','w','n','s','ne','nw','se','sw']){
    assert.equal(!!externalLabelResizeBounds(shape,direction,20),BpmnRules.prototype.canResize(shape,undefined,direction));
  }
  assert.equal(externalLabelResizeBounds(bounds,'e',-999).width,10);
  const west=externalLabelResizeBounds(bounds,'w',999);assert.equal(west.width,10);assert.equal(west.x+west.width,bounds.x+bounds.width);
});

test('explicit fractional commit rounding follows upstream without rounding live preview',()=>{
  const original={x:13.4,y:29.7,width:98.6,height:18.2};
  const preview=externalLabelResizeBounds(original,'w',12.25,{round:false}),commit=externalLabelResizeBounds(original,'w',12.25);
  assert.deepEqual(commit,upstreamLayout.roundBounds(preview));assert.ok(Object.values(commit).every(Number.isInteger));assert.notEqual(preview.x,commit.x);
});

test('real retained text layout matches upstream LabelBehavior for multiline and blank text',()=>{
  const renderer=new TextRenderer();
  for(const text of ['','Approved','Approve the corrected travel reservation after manager review','Line one\nLine two\nLine three'])for(const width of [10,40,90,140,250]){
    const shape=label(text),next={...bounds,x:80,width};
    assert.deepEqual(layoutExternalLabelBounds(shape,next,renderer),upstreamLabelBounds(shape,next,renderer));
  }
  const shape=label(),narrow=layoutExternalLabelBounds(shape,{...bounds,width:50},renderer),wide=layoutExternalLabelBounds(shape,{...bounds,width:250},renderer);
  assert.ok(narrow.height>wide.height,'narrower chosen width wraps into more lines');assert.equal(wide.width,250,'content fitting must not shrink the chosen width');
});

test('top-edge and bottom-edge anchoring match upstream height fitting',()=>{
  const renderer={getExternalStyle:()=>({fontSize:11}),getDimensions:()=>({width:99,height:37.2})},shape=label();
  for(const y of [shape.y,shape.y+8,shape.y-12]){
    const next={...bounds,x:80,y,width:160},actual=layoutExternalLabelBounds(shape,next,renderer);
    assert.deepEqual(actual,upstreamLabelBounds(shape,next,renderer));assert.equal(actual.height,38);assert.equal(actual.y,y===shape.y?shape.y:shape.y+shape.height-38);
  }
});

test('planning does not mutate label DI, owner bounds, flow anchors or semantic metadata',()=>{
  const shape=label('Only this label is resized','bpmn:SequenceFlow'),owner=shape.labelTarget;
  owner.waypoints=[{x:10,y:20},{x:200,y:20}];owner.businessObject.conditionExpression=moddle.create('bpmn:FormalExpression',{body:'approved == true',language:'juel'});
  const labelDi=shape.di,ownerDi=owner.di,oldBounds={...labelDi.bounds},oldOwner={...ownerDi.bounds},oldPoints=owner.waypoints.map(point=>({...point}));
  const next=externalLabelResizeBounds(shape,'e',70);layoutExternalLabelBounds(shape,next,new TextRenderer());
  assert.equal(shape.di,labelDi);assert.equal(owner.di,ownerDi);assert.deepEqual(labelDi.bounds,oldBounds);assert.deepEqual(ownerDi.bounds,oldOwner);assert.deepEqual(owner.waypoints,oldPoints);
  assert.equal(owner.businessObject.conditionExpression.body,'approved == true');assert.equal(owner.businessObject.conditionExpression.language,'juel');assert.equal(shape.width,bounds.width);
});

test('invalid input and owner-shape resize never enter label layout',()=>{
  const shape=label(),renderer=new TextRenderer();
  for(const original of [null,{...bounds,width:-1},{...bounds,x:Infinity}])assert.equal(externalLabelResizeBounds(original,'e',10),null);
  assert.equal(externalLabelResizeBounds(bounds,'e',NaN),null);assert.equal(externalLabelResizeBounds(bounds,'se',10),null);
  assert.equal(layoutExternalLabelBounds(shape.labelTarget,bounds,renderer),null);assert.equal(layoutExternalLabelBounds(shape,{...bounds,width:0},renderer),null);
  assert.equal(layoutExternalLabelBounds(shape,bounds,{getExternalStyle:()=>({}),getDimensions:()=>({height:NaN})}),null);
});
