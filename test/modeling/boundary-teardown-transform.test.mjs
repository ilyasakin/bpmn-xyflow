import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { instrumentBoundaryTeardown,boundaryTeardownPlugin,TEARDOWN_STATEMENT } from '../helpers/boundary-teardown-transform.mjs';

const read=path=>readFile(new URL(`../../${path}`,import.meta.url),'utf8');
const sha=text=>createHash('sha256').update(text).digest('hex');

test('served transform inserts only after the unique original removals, retaining all library bytes',async()=>{
  const original=await read('lib/Modeler.js'), result=instrumentBoundaryTeardown(original);
  assert.equal(result.code.replace(result.trace,''),original);
  assert.ok(result.code.includes(TEARDOWN_STATEMENT+result.trace));
  assert.equal(result.sourceSha256,sha(original));assert.equal(result.servedSha256,sha(result.code));
  assert.equal(await read('lib/Modeler.js'),original);
  const plugin=boundaryTeardownPlugin(fileURLToPath(new URL('../../',import.meta.url)));
  assert.equal(plugin.transform(original,'/unrelated/Modeler.js'),null);
  assert.equal(plugin.transform(original,new URL('../../lib/Modeler.js',import.meta.url).pathname+'?v=1').code,result.code);
  assert.throws(()=>instrumentBoundaryTeardown(original.replace(TEARDOWN_STATEMENT,'changed')),/one exact/);
  assert.throws(()=>instrumentBoundaryTeardown(original+original),/one exact/);
});

test('actual transformed teardown logs after all removals and preserves resets even when its callback throws',async()=>{
  const source=await read('lib/Modeler.js'), result=instrumentBoundaryTeardown(source);
  const start=result.code.indexOf('  function destroyConnectHandle() {');
  const block=result.code.slice(start,result.code.indexOf('\n\n  function connectDocking',start));
  const execute=Function('globalThis','callback',`
    const removed=[];
    const element=name=>({name,isConnected:true,remove(){this.isConnected=false;removed.push(name);}});
    let connectHandle=element('handle'),connectOutline=element('outline'),connectDockingMarker=element('marker');
    let hoveredForConnect={id:'FlightTimeout'},connectPort={x:678.3370087109132,y:315.18639520580945},connectGrab={x:655.6204680086178,y:350.88780013241137};
    let connectApproach={point:{x:655.752978637531,y:351.3257930120346},origin:{x:678.3370087109132,y:315.18639520580945},acquired:true,travelling:true,reachedGrab:true};
    globalThis.__bpmnBoundaryTeardownRecord=record=>callback(record,removed);
    ${block}
    function originalCaller(){destroyConnectHandle();}
    originalCaller();
    return {removed,values:[connectHandle,connectOutline,connectDockingMarker,hoveredForConnect,connectPort,connectGrab,connectApproach]};
  `);
  for(const shouldThrow of [false,true]){
    const global={},records=[];
    const output=execute(global,(record,removed)=>{
      assert.deepEqual(removed,['handle','outline','marker']);assert.equal(record.handle.isConnected,false);
      assert.equal(record.owner,'FlightTimeout');assert.equal(record.sourceSha256,sha(source));
      assert.match(record.stack,/originalCaller/);assert.equal(record.acquisition.reachedGrab,true);
      assert.deepEqual(record.acquisition.origin,{x:678.3370087109132,y:315.18639520580945});
      assert.deepEqual(record.anchor,{x:678.3370087109132,y:315.18639520580945});
      assert.deepEqual(record.grab,{x:655.6204680086178,y:350.88780013241137});records.push(record);
      if(shouldThrow)throw Error('injected diagnostic callback failure');
    });
    assert.equal(records.length,1);assert.deepEqual(output.values,Array(7).fill(null));
    if(shouldThrow)assert.match(global.__bpmnBoundaryTeardownErrors[0].message,/injected diagnostic callback failure/);
    else assert.equal(global.__bpmnBoundaryTeardownErrors,undefined);
  }
});

test('diagnostic server keeps every normal route/plugin/root and factory default startup unchanged',async()=>{
  const normal=await read('lib/demo/serve.mjs');
  const diagnostic=(await read('test/helpers/boundary-diagnostic-server.mjs'))
    .replace("\nimport { boundaryTeardownPlugin } from './boundary-teardown-transform.mjs';",'')
    .replace("const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');\nconst __dirname = path.join(repoRoot, 'lib/demo');", "const __dirname = path.dirname(fileURLToPath(import.meta.url));\nconst repoRoot = path.resolve(__dirname, '../..');")
    .replace('    boundaryTeardownPlugin(repoRoot),\n','');
  assert.equal(diagnostic,normal,'only trace plugin and relocated entrypoint path differ');
  const factory=await read('test/helpers/anchor-ux-browser.mjs');
  const restored=factory
    .replace('export function createAnchorHarness({ port, output, serverEntry = "lib/demo/serve.mjs" }) {\nassert.ok(["lib/demo/serve.mjs", "test/helpers/boundary-diagnostic-server.mjs"].includes(serverEntry), "known owned test server entry");','export function createAnchorHarness({ port, output }) {')
    .replace('[serverEntry], {','["lib/demo/serve.mjs"], {');
  assert.equal(sha(restored),'aea11672e6030610abeb3c404942dc63bed01d24080d94602fd4bebb37181c7a','all original factory gesture/assertion/lifecycle bytes retained');
  assert.equal(sha(await read('test/modeling/browser-anchor-ux.mjs')),'d72578ae9c9900367734faaba7ad73ea40bec1df274197d3dde4996ff54a7c23','original native39 bytes retained');
  const {createAnchorHarness}=await import('../helpers/anchor-ux-browser.mjs');
  assert.throws(()=>createAnchorHarness({port:1,output:'unused',serverEntry:'/unowned/server.mjs'}),/known owned/);
});
