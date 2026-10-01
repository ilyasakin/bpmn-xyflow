import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {setupDOM} from '../helpers/dom.mjs';
const dom=await setupDOM(),require=createRequire(import.meta.url),up=createRequire(require.resolve('bpmn-js/package.json'));
const {default:TextRenderer}=await dom.loadModule('/lib/draw/TextRenderer.js'),{default:Reference}=await dom.loadModule('/node_modules/bpmn-js/lib/draw/TextRenderer.js');
after(()=>dom.cleanup());
test('retained Text helper has only the documented security patch; MIT license is exact pinned source',async()=>{
 const provenance=JSON.parse(await readFile('lib/upstream/diagram-js/PROVENANCE.json','utf8'));assert.equal(provenance.version,'15.27.1');
 for(const [file,info]of Object.entries(provenance.files)){
  const bytes=await readFile('lib/upstream/diagram-js/'+file),original=await readFile(up.resolve('diagram-js/'+info.source));assert.equal(createHash('sha256').update(bytes).digest('hex'),info.sha256);
  if(file==='Text.js'){
   assert.equal(createHash('sha256').update(original).digest('hex'),info.upstreamSha256);
   const from="text.replace(/\\s+$/, '')";assert.equal(original.toString().split(from).length-1,1);
   assert.equal(bytes.toString(),original.toString().replace(from,'text.trimEnd()'),'only the trailing-whitespace operation differs from pinned upstream');
  }else assert.deepEqual(bytes,original);
 }
});
test('Group title at exact measured width fits one line and matches current reference around the boundary',()=>{
 const local=new TextRenderer(),reference=new Reference(),text='Review category';
 for(const width of [89,89.999,90,90.001,91,180]){
  const options={box:{width,height:80},style:local.getExternalStyle()};
  assert.deepEqual(local.getDimensions(text,options),reference.getDimensions(text,options));
  assert.equal(local.createText(text,options).outerHTML,reference.createText(text,options).outerHTML);
 }
 const at=local.getDimensions(text,{box:{width:90,height:80},style:local.getExternalStyle()}),below=local.getDimensions(text,{box:{width:89.999,height:80},style:local.getExternalStyle()});
 assert.equal(at.width,90);assert.ok(below.height>at.height,'only a box strictly narrower than the measured title wraps');
});
test('rendered label text, wrapping and dimensions retain pinned whitespace behavior',()=>{
 const local=new TextRenderer(),reference=new Reference();
 for(const text of ['', ' ', 'Review category   ', '\t leading and trailing\u00a0', 'Two\nlines\u2003', 'Emoji 😀\ufeff', 'A\u00adB  ', ' '.repeat(64)+'X'])for(const width of [90,1000]){
  const options={box:{width,height:80},style:local.getExternalStyle()};
  assert.deepEqual(local.getDimensions(text,options),reference.getDimensions(text,options));
  assert.equal(local.createText(text,options).outerHTML,reference.createText(text,options).outerHTML);
 }
});
