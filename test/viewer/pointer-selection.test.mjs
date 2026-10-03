import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { setupDOM } from '../helpers/dom.mjs';

// Structural event-state tests. Real touch streams are checked separately by
// the same-input upstream/local Chromium touch baseline, not simulated here.
const dom=await setupDOM();
const {default:Viewer}=await dom.loadModule('/lib/Viewer.js');
const xml=await readFile('test/fixtures/bpmn/basic.bpmn','utf8');
const viewers=[];
async function create(){const viewer=new Viewer({container:dom.createContainer(),fitViewOnInit:false});viewers.push(viewer);await viewer.importXML(xml);return viewer;}
const graphic=(viewer,id='Task_1')=>viewer.getSvg().querySelector(`[data-element-id="${id}"]`);
function pointer(target,type,id,{x=100,y=100,pointerType='touch',...options}={}){
  const event=new dom.window.PointerEvent(type,{bubbles:true,cancelable:true,pointerId:id,pointerType,clientX:x,clientY:y,button:0,...options});target.dispatchEvent(event);return event;
}
function tap(viewer,id='Task_1',pointerId=1,options){const target=graphic(viewer,id);pointer(target,'pointerdown',pointerId,options);pointer(target,'pointerup',pointerId,options);}
after(async()=>{for(const viewer of viewers)viewer.destroy();await dom.cleanup();});

test('single touch and mouse selection retain modifier and background semantics',async()=>{
  const viewer=await create(),clicks=[];viewer.on('element.click',event=>clicks.push(event.id));
  const down=pointer(graphic(viewer),'pointerdown',7);assert.equal(down.defaultPrevented,false,'selection observation never consumes touch input');
  pointer(graphic(viewer),'pointerup',7);assert.deepEqual(viewer.getSelection(),['Task_1']);
  tap(viewer,'StartEvent_1',1,{pointerType:'mouse',ctrlKey:true});assert.deepEqual(viewer.getSelection().sort(),['StartEvent_1','Task_1']);
  tap(viewer,'Task_1',1,{pointerType:'mouse',ctrlKey:true});assert.deepEqual(viewer.getSelection(),['StartEvent_1']);
  pointer(viewer.getSvg(),'pointerdown',1,{pointerType:'mouse'});pointer(viewer.getSvg(),'pointerup',1,{pointerType:'mouse'});assert.deepEqual(viewer.getSelection(),[]);
  assert.deepEqual(clicks,['Task_1','StartEvent_1','Task_1',null]);
});

test('two stationary contacts cannot select on partial release in either order',async()=>{
  for(const releaseFirst of [11,12]){
    const viewer=await create(),clicks=[];viewer.select('StartEvent_1');viewer.on('element.click',event=>clicks.push(event.id));
    const targets=new Map([[11,graphic(viewer)],[12,graphic(viewer,'StartEvent_1')]]);
    pointer(targets.get(11),'pointerdown',11);pointer(targets.get(12),'pointerdown',12,{x:200});
    pointer(targets.get(releaseFirst),'pointerup',releaseFirst,{x:releaseFirst===11?100:200});
    assert.deepEqual(viewer.getSelection(),['StartEvent_1'],'selection is stable while the other contact remains');assert.deepEqual(clicks,[]);
    const last=releaseFirst===11?12:11;pointer(targets.get(last),'pointerup',last,{x:last===11?100:200});assert.deepEqual(clicks,[],'last contact of the same stream is suppressed too');
    tap(viewer,'Task_1',13);assert.deepEqual(viewer.getSelection(),['Task_1']);assert.deepEqual(clicks,['Task_1'],'a fresh single touch works after all fingers lift');
  }
});

test('unknown pointerup cannot finish a different pointer and dragged input is not a tap',async()=>{
  const viewer=await create(),clicks=[];viewer.on('element.click',event=>clicks.push(event.id));
  pointer(graphic(viewer),'pointerdown',21);pointer(graphic(viewer),'pointerup',99);assert.deepEqual(clicks,[]);
  pointer(graphic(viewer),'pointerup',21);assert.deepEqual(clicks,['Task_1']);
  pointer(graphic(viewer),'pointerdown',22);pointer(graphic(viewer),'pointerup',22,{x:130});assert.deepEqual(clicks,['Task_1']);
});

test('cancel and lost capture invalidate remaining contacts until the stream finishes',async()=>{
  for(const type of ['pointercancel','lostpointercapture']){
    const viewer=await create(),clicks=[];viewer.on('element.click',event=>clicks.push(event.id));
    pointer(graphic(viewer),'pointerdown',31);pointer(graphic(viewer,'StartEvent_1'),'pointerdown',32);
    pointer(graphic(viewer,'StartEvent_1'),type,32);pointer(graphic(viewer),'pointerdown',33);pointer(graphic(viewer),'pointerup',33);
    pointer(graphic(viewer),'pointerup',31);pointer(graphic(viewer,'StartEvent_1'),'pointerup',32);assert.deepEqual(clicks,[]);
    tap(viewer,'Task_1',1,{pointerType:'mouse'});assert.deepEqual(clicks,['Task_1'],'mouse selection works immediately after the cancelled touch stream');
    pointer(graphic(viewer),'pointerdown',34);pointer(graphic(viewer),type,34);pointer(graphic(viewer),'pointerup',34);assert.deepEqual(clicks,['Task_1']);
  }
});

test('outside releases and an outside second contact cannot create stale selection',async()=>{
  const viewer=await create(),clicks=[];viewer.on('element.click',event=>clicks.push(event.id));
  pointer(graphic(viewer),'pointerdown',41);pointer(document.body,'pointerup',41);assert.deepEqual(clicks,[]);
  pointer(graphic(viewer),'pointerdown',42);pointer(document.body,'pointerdown',43);pointer(document.body,'pointerup',43);pointer(graphic(viewer),'pointerup',42);assert.deepEqual(clicks,[]);
  tap(viewer,'Task_1',44);assert.deepEqual(clicks,['Task_1']);
});

test('lost capture keeps a held contact active until its real release or cancellation',async()=>{
  for(const release of ['pointerup','pointercancel']){
    const viewer=await create(),clicks=[];viewer.select('StartEvent_1');viewer.on('element.click',event=>clicks.push(event.id));
    pointer(graphic(viewer,'StartEvent_1'),'pointerdown',71);pointer(graphic(viewer,'StartEvent_1'),'lostpointercapture',71);
    tap(viewer,'Task_1',72);assert.deepEqual(clicks,[],'second finger must not click while the first is physically held');assert.deepEqual(viewer.getSelection(),['StartEvent_1']);
    pointer(document.body,release,71);assert.deepEqual(clicks,[]);
    // Browsers normally emit lost capture after up. That stale notification
    // must neither block nor consume the next genuinely single-pointer tap.
    pointer(document.body,'lostpointercapture',71);tap(viewer,'Task_1',73);
    assert.deepEqual(clicks,['Task_1']);assert.deepEqual(viewer.getSelection(),['Task_1']);
  }
});

test('import, clear and blur invalidate pending taps without blocking fresh input',async()=>{
  for(const action of ['import','clear','blur']){
    const viewer=await create(),clicks=[];viewer.on('element.click',event=>clicks.push(event.id));pointer(graphic(viewer),'pointerdown',51);
    if(action==='import')await viewer.importXML(xml);
    if(action==='clear'){viewer.clear();await viewer.importXML(xml);}
    if(action==='blur')dom.window.dispatchEvent(new dom.window.Event('blur'));
    pointer(graphic(viewer),'pointerup',51);assert.deepEqual(clicks,[],`${action} cancels pending selection`);
    tap(viewer,'Task_1',52);assert.deepEqual(clicks,['Task_1']);
  }
});

test('multiple viewers do not select each other and suppress cross-view two-finger taps',async()=>{
  const left=await create(),right=await create();
  tap(left,'Task_1',61);assert.deepEqual(left.getSelection(),['Task_1']);assert.deepEqual(right.getSelection(),[]);
  tap(right,'StartEvent_1',62);assert.deepEqual(left.getSelection(),['Task_1']);assert.deepEqual(right.getSelection(),['StartEvent_1']);
  pointer(graphic(left,'StartEvent_1'),'pointerdown',63);pointer(graphic(right),'pointerdown',64);
  pointer(graphic(right),'pointerup',64);pointer(graphic(left,'StartEvent_1'),'pointerup',63);
  assert.deepEqual(left.getSelection(),['Task_1']);assert.deepEqual(right.getSelection(),['StartEvent_1']);
  left.destroy();tap(right,'Task_1',1,{pointerType:'mouse'});assert.deepEqual(right.getSelection(),['Task_1']);
});

test('destroy removes every window-level pointer observer',async()=>{
  const types=new Set(['pointerdown','pointerup','pointercancel','lostpointercapture','blur']),added=[],removed=[];
  const add=dom.window.addEventListener,remove=dom.window.removeEventListener;
  dom.window.addEventListener=function(type,listener,options){if(types.has(type))added.push([type,listener,options]);return add.call(this,type,listener,options);};
  dom.window.removeEventListener=function(type,listener,options){if(types.has(type))removed.push([type,listener,options]);return remove.call(this,type,listener,options);};
  try{
    const viewer=await create();viewer.destroy();viewer.destroy();
    for(const [type,listener,options] of added)assert.ok(removed.some(entry=>entry[0]===type&&entry[1]===listener&&entry[2]===options),`${type} observer was removed`);
    assert.ok(added.some(entry=>entry[0]==='pointercancel'));
  }finally{dom.window.addEventListener=add;dom.window.removeEventListener=remove;}
});
