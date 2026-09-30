import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { readFile } from 'node:fs/promises';
import { setupDOM } from '../helpers/dom.mjs';
let dom, Modeler, install;
before(async()=>{dom=await setupDOM();({default:Modeler}=await dom.loadModule('/lib/Modeler.js'));({default:install}=await dom.loadModule('/lib/modeling/EditorActions.js'));});
after(async()=>{await dom.cleanup();});
async function editor() {
  const model=new Modeler({container:dom.createContainer(),palette:false,editorActions:false,fitViewOnInit:false});
  await model.importXML(await readFile('test/fixtures/bpmn/basic.bpmn','utf8'));
  const cleanup=install(model,model.viewer,{palette:false});
  return {model,cleanup};
}
test('accessible alignment/distribution controls enable by selection and preserve undo',async()=>{
  const {model:m,cleanup}=await editor();
  try {
    const a=m.getElement('Task_1'),b=m.addShape('bpmn:Task',{x:600,y:300}),c=m.addShape('bpmn:Task',{x:850,y:450});
    const align=m.getContainer().querySelector('[aria-label="Align selection"]');
    const distribute=m.getContainer().querySelector('[aria-label="Distribute selection"]');
    assert.ok(align.disabled);assert.ok(distribute.disabled);
    m.select([a.id,b.id]);assert.equal(align.disabled,false);assert.equal(distribute.disabled,true);
    const before=[a.y,b.y];align.value='top';align.dispatchEvent(new window.Event('change',{bubbles:true}));assert.equal(a.y,b.y);
    m.undo();assert.deepEqual([a.y,b.y],before);
    m.select([a.id,b.id,c.id]);assert.equal(distribute.disabled,false);
    const positions=[a.x,b.x,c.x];distribute.value='horizontal';distribute.dispatchEvent(new window.Event('change',{bubbles:true}));
    assert.equal(b.x-(a.x+a.width),c.x-(b.x+b.width));m.undo();assert.deepEqual([a.x,b.x,c.x],positions);
  } finally {cleanup();m.destroy();}
});
test('space toolbar pointer gesture commits once and Escape cancels without mutations',async()=>{
  const {model:m,cleanup}=await editor();
  try {
    const a=m.addShape('bpmn:Task',{x:600,y:300});m.clearSelection();
    const button=m.getContainer().querySelector('.bpmn-xyflow-editor-actions button');
    const mouse=(target,type,x,y)=>target.dispatchEvent(new window.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x,clientY:y}));
    const before=await m.getXML(), count=m.commandStack.size();
    button.click();assert.equal(button.getAttribute('aria-pressed'),'true');
    mouse(m.getSvg(),'mousedown',500,200);mouse(window,'mousemove',575,200);
    window.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));mouse(window,'mouseup',575,200);
    assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),count);assert.equal(m.getContainer().querySelector('.bpmn-xyflow-space-guide'),null);
    const x=a.x;button.click();mouse(m.getSvg(),'mousedown',500,200);mouse(window,'mousemove',575,200);mouse(window,'mouseup',575,200);
    assert.equal(a.x,x+75);assert.equal(m.commandStack.size(),count+1);assert.equal(button.getAttribute('aria-pressed'),'false');
    m.undo();assert.equal(await m.getXML(),before);
    button.click();window.dispatchEvent(new window.Event('blur'));assert.equal(button.getAttribute('aria-pressed'),'false');
  } finally {cleanup();m.destroy();}
});

test('history changes cancel pending space gestures and repeated activation remains safe',async()=>{
  const {model:m,cleanup}=await editor();
  try {
    const a=m.addShape('bpmn:Task',{x:600,y:300});m.clearSelection();
    const button=m.getContainer().querySelector('.bpmn-xyflow-editor-actions button');
    const mouse=(target,type,x,y)=>target.dispatchEvent(new window.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x,clientY:y}));
    for (const action of [()=>m.undo(),()=>m.redo(),()=>m.moveShape(a,{x:10,y:0}),()=>m.delete(a),()=>m.undo()]) {
      button.click();mouse(m.getSvg(),'mousedown',500,200);mouse(window,'mousemove',575,200);
      action();
      const xml=await m.getXML(), count=m.commandStack.size();
      assert.equal(button.getAttribute('aria-pressed'),'false');
      assert.equal(m.getContainer().querySelector('.bpmn-xyflow-space-guide'),null);
      mouse(window,'mouseup',575,200);
      assert.equal(await m.getXML(),xml);assert.equal(m.commandStack.size(),count);
    }
    button.click();button.click();assert.equal(button.getAttribute('aria-pressed'),'false');
    const x=a.x;button.click();mouse(m.getSvg(),'mousedown',500,200);mouse(window,'mouseup',575,200);
    assert.equal(a.x,x+75);assert.equal(button.getAttribute('aria-pressed'),'false');
  } finally {cleanup();m.destroy();}
});
