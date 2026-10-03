import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { setupDOM } from '../helpers/dom.mjs';
const dom=await setupDOM();after(()=>dom.cleanup());
const {dependentConnectionClosure,adjustDependentWaypoints}=await dom.loadModule('/lib/modeling/ConnectionDependents.js');
const {getConnectionAdjustment}=await dom.loadModule('/node_modules/bpmn-js/lib/features/modeling/behavior/util/ConnectionLayoutUtil.js');
const old=[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:200,y:100}];
const edge=()=>({waypoints:[{x:50,y:0,original:{x:50.25,y:0.5,tag:'original'},tag:'source'},{x:50,y:-40,tag:'manual'},{x:80,y:-40,tag:'target'}]});
test('closure handles both endpoint directions, transitive owners, shared dependents and cycles once',()=>{
 const root={},a={source:root},b={target:root},c={source:a,target:b},d={source:c};root.target=d;
 assert.deepEqual(dependentConnectionClosure([root],[d,c,b,a,root]),[b,a,c,d]);
 assert.deepEqual(dependentConnectionClosure([root,a],[d,c,b,a,root]),[b,c,d]);
 assert.deepEqual(dependentConnectionClosure([],[]),[]);
});
test('targeted source adjustment matches pinned utility without mutating input or manual geometry',()=>{
 const source=edge(),next=[{x:0,y:20},{x:100,y:20},{x:100,y:100},{x:200,y:100}],before=JSON.stringify({source,old,next});
 const out=adjustDependentWaypoints(source,'source',old,next,{segmentMove:{segmentStartIndex:0,newSegmentStartIndex:0}});
 assert.deepEqual({x:out[0].x,y:out[0].y},getConnectionAdjustment(source.waypoints[0],next,old,{segmentMove:{segmentStartIndex:0,newSegmentStartIndex:0}}));
 assert.deepEqual(out.slice(1),source.waypoints.slice(1));assert.equal(out[0].tag,'source');assert.deepEqual(out[0].original,{x:50.25,y:20.5,tag:'original'});assert.equal(JSON.stringify({source,old,next}),before);
});
test('target-side adjustment keeps source docking and interior bends exactly',()=>{
 const source=edge();source.waypoints.reverse();const next=old.map(p=>({...p,y:p.y+30}));
 const out=adjustDependentWaypoints(source,'target',old,next,{moveDelta:{x:0,y:30}});
 assert.deepEqual(out.slice(0,-1),source.waypoints.slice(0,-1));assert.equal(out.at(-1).y,30);assert.equal(out.at(-1).original.y,30.5);
});
test('identical fractional owner routes preserve exact docking without upstream rounding',()=>{
 const source=edge();source.waypoints[0].x=50.123456789;const out=adjustDependentWaypoints(source,'source',old,old.map(p=>({...p})));
 assert.deepEqual(out,source.waypoints);assert.notEqual(out,source.waypoints);assert.notEqual(out[0].original,source.waypoints[0].original);
});
test('verified fractional whole-route translation moves anchor and original precisely',()=>{
 const source=edge(),delta={x:0.125,y:-0.375},next=old.map(p=>({x:p.x+delta.x,y:p.y+delta.y}));
 const out=adjustDependentWaypoints(source,'source',old,next,{moveDelta:delta});assert.equal(out[0].x,50.125);assert.equal(out[0].y,-0.375);assert.equal(out[0].original.x,50.375);
 assert.equal(adjustDependentWaypoints(source,'source',old,next,{moveDelta:{x:2,y:3}}),null);
});
test('segment and bend insert/remove hints match the real pinned function',()=>{
 const cases=[
  {next:[{x:0,y:0},{x:60,y:20},{x:100,y:0},{x:100,y:100},{x:200,y:100}],hints:{bendpointMove:{insert:true,bendpointIndex:1}}},
  {next:[{x:0,y:0},{x:100,y:100},{x:200,y:100}],hints:{bendpointMove:{insert:false,bendpointIndex:1}}},
  {next:[{x:0,y:0},{x:0,y:30},{x:100,y:30},{x:100,y:100},{x:200,y:100}],hints:{segmentMove:{segmentStartIndex:0,newSegmentStartIndex:1}}}
 ];
 for(const {next,hints} of cases){const source=edge(),out=adjustDependentWaypoints(source,'source',old,next,hints);assert.ok(out);assert.deepEqual({x:out[0].x,y:out[0].y},getConnectionAdjustment(source.waypoints[0],next,old,hints));}
});
test('malformed routes and hints are refused without input mutation',()=>{
 const source=edge(),sparse=new Array(3);sparse[0]={x:0,y:0};sparse[2]={x:1,y:1};
 for(const bad of [null,[],[{x:0,y:0}],sparse,[{x:0,y:0},{x:NaN,y:1}],[{x:0,y:0},{x:0,y:0}]]){
  assert.equal(adjustDependentWaypoints(source,'source',bad,old),null);assert.equal(adjustDependentWaypoints(source,'source',old,bad),null);
 }
 for(const hints of [null,[],{moveDelta:null},{segmentMove:null},{segmentMove:{segmentStartIndex:999,newSegmentStartIndex:0}},{bendpointMove:{insert:true,bendpointIndex:old.length}},{connectionStart:1}])assert.equal(adjustDependentWaypoints(source,'source',old,old,hints),null);
 assert.equal(adjustDependentWaypoints(source,'other',old,old),null);
});
test('duplicate leading point remains a valid route and insertion indices use pre-insertion bounds',()=>{
 const prior=[{x:0,y:0},{x:0,y:0},{x:100,y:0}],next=[{x:0,y:0},{x:0,y:0},{x:50,y:20},{x:100,y:0}],source=edge();
 assert.ok(adjustDependentWaypoints(source,'source',prior,next,{bendpointMove:{insert:true,bendpointIndex:2}}));
 assert.equal(adjustDependentWaypoints(source,'source',prior,next,{bendpointMove:{insert:true,bendpointIndex:3}}),null);
});
test('retained attachment helpers remain byte-identical and hash verified',async()=>{
 const manifest=JSON.parse(await readFile('lib/upstream/PROVENANCE.json','utf8'));
 for(const name of ['ConnectionLayoutUtil','LayoutUtil','LineAttachmentUtil','GeometricUtil']){
  const key=`modeling/behavior/util/${name}.js`,data=await readFile(`lib/upstream/${key}`),record=manifest.additionalSources[key];
  assert.deepEqual(data,await readFile(`node_modules/bpmn-js/${record.source}`));assert.equal(createHash('sha256').update(data).digest('hex'),record.sha256);
 }
});

test('finite inputs that overflow preserved original docking are refused',()=>{
 const prior=[{x:0,y:0},{x:10,y:30}],next=[{x:1e308,y:0},{x:1e308,y:30}],source={waypoints:[{x:0,y:0,original:{x:1e308,y:0}},{x:50,y:60}]};
 assert.equal(adjustDependentWaypoints(source,'source',prior,next,{moveDelta:{x:1e308,y:0}}),null);
 assert.equal(source.waypoints[0].original.x,1e308);
});
