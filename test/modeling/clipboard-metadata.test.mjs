import test from 'node:test';
import assert from 'node:assert/strict';
import { BpmnModdle } from '../../lib/bpmn/moddle.js';
import { cloneSemanticGraph } from '../../lib/modeling/Clipboard.js';
test('generic metadata names remain own enumerable data when cloned',async()=>{
  const m=new BpmnModdle();
  const xml='<b:definitions xmlns:b="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:v="urn:vendor" targetNamespace="urn:test"><b:process id="P"><b:task id="T"><b:extensionElements><v:payload __proto__="retained" constructor="safe" get="getter-data" set="setter-data"/></b:extensionElements></b:task></b:process></b:definitions>';
  const {rootElement}=await m.fromXML(xml);
  const clone=cloneSemanticGraph(m,[rootElement]).get(rootElement);
  const payload=clone.rootElements[0].flowElements[0].extensionElements.values[0];
  for(const [key,value] of Object.entries(JSON.parse('{"__proto__":"retained","constructor":"safe","get":"getter-data","set":"setter-data"}'))) {
    assert.ok(Object.hasOwn(payload,key));assert.equal(payload[key],value);assert.ok(Object.keys(payload).includes(key));
  }
  const again=(await m.fromXML((await m.toXML(clone)).xml)).rootElement;
  assert.equal(again.rootElements[0].flowElements[0].extensionElements.values[0].__proto__,'retained');
  assert.equal(Object.getPrototypeOf(payload),Object.prototype);
});
