import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { assertRenderedDI, collectRenderedDI, selectVisibleFollowupBody, prepareReferenceOutlineTarget, adjacentDropPixels, chooseAdjacentReferenceDrop, clickReferenceSubprocessReplacement, collectReferenceLaneTop } from '../helpers/anchor-followup-dom.mjs';

test('recorded Chrome paint matches full SVG CTM, while rounded Canvas.viewbox fails the unchanged bound',()=>{
  const cases=[
    [688,318,805.1292724609375,452.64617919921875,805.204,452.681],
    [675,323,793.9376831054688,456.9506530761719,794.011,456.986],
    [570,445,703.5440673828125,561.9794311523438,703.606,562.028],
    [270,390,445.27655029296875,514.63037109375,445.306,514.673],
    [920,247,1004.8561401367188,391.52288818359375,1004.956,391.55],
  ];
  for(const[x,y,sx,sy,badX,badY]of cases){
    const value={id:'Recorded',points:[{x,y},{x,y}],matrix:{a:.8608916997909546,b:0,c:0,d:.8608916997909546,e:212.83578491210938,f:178.88262939453125},actual:{start:{x:sx,y:sy},end:{x:sx,y:sy}}};
    assertRenderedDI(value);
    assert.ok(Math.hypot(sx-badX,sy-badY)>.05,'old rounded viewbox expectation reproduces native failure');
    for(const mutate of[v=>{v.matrix.a=.861;v.matrix.d=.861;},v=>{v.matrix.e++;},v=>{v.points[0].x++;},v=>{v.actual.end.y++;},v=>{v.matrix.b=NaN;}]){const bad=structuredClone(value);mutate(bad);assert.throws(()=>assertRenderedDI(bad));}
  }
  assertRenderedDI({id:'RecordedZoom0549',points:[{x:430,y:300},{x:430,y:300}],matrix:{a:.5492802262306213,b:0,c:0,d:.5492802262306213,e:689.6012573242188,f:485.5082702636719},actual:{start:{x:925.791748046875,y:650.2923583984375},end:{x:925.791748046875,y:650.2923583984375}}});
});

test('serialized renderer collector reads active viewport matrix and actual path independently',()=>{
  const matrix={a:.8,b:0,c:0,d:.8,e:10,f:42},pathMatrix={...matrix};
  const p=(x,y)=>({matrixTransform:m=>({x:x*m.a+y*m.c+m.e,y:x*m.b+y*m.d+m.f})});
  const path={getTotalLength:()=>100,getScreenCTM:()=>pathMatrix,getPointAtLength:n=>n?p(200,100):p(100,100)};
  const root={getAttribute:()=> 'Flow',querySelector:()=>path};
  const container={querySelectorAll:()=>[root],querySelector:()=>({getScreenCTM:()=>matrix})};
  const ctx={document:{querySelector:()=>container},args:{id:'Flow',points:[{x:100,y:100},{x:200,y:100}]}};
  const evidence=JSON.parse(JSON.stringify(vm.runInNewContext(`(${collectRenderedDI.toString()})(args)`,ctx)));
  assertRenderedDI(evidence);assert.deepEqual(evidence.matrix,matrix);
  pathMatrix.e+=1;const wrong=JSON.parse(JSON.stringify(vm.runInNewContext(`(${collectRenderedDI.toString()})(args)`,ctx)));assert.throws(()=>assertRenderedDI(wrong));
});

test('visible body selection avoids a crossing center and never toggles a sole selected source',async()=>{
  let selection=[],point,clicks=0,moves=0;
  const h={state:async()=>({selection:[...selection]}),raw:async()=>({selection:[...selection]}),node:()=>({x:100,y:100,width:100,height:80}),screen:(_s,p)=>p,settle:async()=>{},hit:async()=>({inside:true,id:point.x===150?'DeliveryMessage':'ShipOrder'}),noChange:async()=>{}};
  const page={mouse:{move:async(x,y)=>{point={x,y};moves++;},click:async()=>{clicks++;selection=['ShipOrder'];}}};
  const proof=await selectVisibleFollowupBody(h,page,'ShipOrder');assert.equal(proof.attempts.length,2);assert.equal(clicks,1);assert.deepEqual(proof.point,{x:130,y:140});
  await selectVisibleFollowupBody(h,page,'ShipOrder');assert.equal(clicks,1);assert.equal(moves,2);
  selection=[];h.hit=async()=>({inside:true,id:'DeliveryMessage'});await assert.rejects(selectVisibleFollowupBody(h,page,'ShipOrder'),/No unobstructed/);assert.equal(clicks,1);
});

test('reference drop normalization considers only adjacent integer pixels with the exact intended owner',async()=>{
  const requested={x:800.4685,y:493.5785};
  const h={hit:async(_page,p)=>({inside:true,id:p.y>=493.54?'ApprovalDecision_label':'ApprovalDecision'})};
  const choice=await chooseAdjacentReferenceDrop(h,{},'ApprovalDecision',requested);
  assert.equal(choice.originalHit.id,'ApprovalDecision_label');assert.deepEqual(choice.point,{x:800,y:493});
  assert.equal(choice.candidates.length,4);
  for(const {point}of choice.candidates){assert.ok(Number.isInteger(point.x)&&Number.isInteger(point.y));assert.ok(Math.abs(point.x-requested.x)<1&&Math.abs(point.y-requested.y)<1);}
  assert.deepEqual(adjacentDropPixels({x:800,y:493}),[{x:800,y:493}]);
  assert.throws(()=>adjacentDropPixels({x:NaN,y:493}));
  await assert.rejects(chooseAdjacentReferenceDrop({hit:async()=>({inside:true,id:'ApprovalDecision_label'})},{},'ApprovalDecision',requested),/No adjacent/);
  await assert.rejects(chooseAdjacentReferenceDrop({hit:async()=>({inside:false,id:'ApprovalDecision'})},{},'ApprovalDecision',requested),/No adjacent/);
});

test('short popup uses its exact action; long popup requires native keyup and real filtering', async () => {
  for (const searchable of [false, true]) {
    const calls = [], listeners = new Map(), input = { value: '', addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
    const h = { clickButton: async (_page, selector) => { calls.push(['click', selector]); }, settle: async () => {} };
    const page = { $: async () => searchable ? {} : null,
      keyboard: { type: async text => { calls.push(['type', text]); input.value = text; listeners.get('keyup')?.({ isTrusted: true, target: input, key: 's' }); } },
      $eval: async (_selector, fn) => fn(input),
      $$eval: async () => ['replace-with-expanded-subprocess'],
    };
    const evidence = await clickReferenceSubprocessReplacement(h, page, 'replace-with-expanded-subprocess');
    assert.deepEqual(calls, [...(searchable ? [['click', '.djs-popup-search input'], ['type', 'Sub-process']] : []), ['click', '.djs-popup [data-id="replace-with-expanded-subprocess"]']]);
    assert.equal(evidence.searchable, searchable); assert.equal(listeners.size, 0);
    if (searchable) {
      page.keyboard.type = async text => { input.value = text; };
      await assert.rejects(clickReferenceSubprocessReplacement(h, page, 'replace-with-expanded-subprocess'), /trusted keyup/);
      assert.equal(listeners.size, 0, 'failed input-only attempt still cleans its observer');
      page.keyboard.type = async text => { input.value = text; listeners.get('keyup')({ isTrusted: true, target: input, key: 's' }); };
      page.$$eval = async () => ['replace-with-task', 'replace-with-expanded-subprocess'];
      await assert.rejects(clickReferenceSubprocessReplacement(h, page, 'replace-with-expanded-subprocess'), /actually filtered/);
    }
  }
});

test('serialized lane selector uses the exact top stroke CTM and refuses missing or mismatched graphics', () => {
  const attributes = { x: '0', y: '0', width: '1250', height: '220' }, matrix = { a: 1, b: 0, c: 0, d: 1, e: 20, f: 62 };
  const hit = { getAttribute: k => attributes[k] }, gfx = { getAttribute: () => 'RequesterLane', querySelector: () => hit, getScreenCTM: () => matrix };
  const context = { document: { querySelectorAll: () => [gfx] }, args: { id: 'RequesterLane', width: 1250, height: 220 } };
  const collect = () => JSON.parse(JSON.stringify(vm.runInNewContext(`(${collectReferenceLaneTop.toString()})(args)`, context)));
  assert.deepEqual(collect().point, { x: 645, y: 62 }, 'avoids the recorded palette at client34,172');
  matrix.a = .8608916997909546; matrix.e = 212.83578491210938;
  assert.deepEqual(collect().point, { x: Math.round(625 * matrix.a + matrix.e), y: 62 });
  attributes.width = '1249'; assert.throws(collect, /current bounds/); attributes.width = '1250';
  matrix.a = NaN; assert.throws(collect, /matrix/); matrix.a = 1;
  gfx.querySelector = () => null; assert.throws(collect, /Missing reference lane/);
});

test('reference outline preflight follows the actual source click and preserves the identical drop point', async () => {
  const point = Object.freeze({ x: 496.966, y: 562.028 });
  const run = async (mutate = () => {}) => {
    let selection = ['Payment'], pointer, clicked = false, saved;
    const state = () => ({ engine: 'upstream', selection: [...selection], xml: '<complete/>',
      history: { undo: true, redo: false }, viewport: { x: 212.836, y: 136.883, zoom: .861 } });
    const h = { state: async () => { const s = state(); if (clicked) mutate(s); return s; },
      raw: async () => ({ selection }), node: () => ({ x: 200, y: 390, width: 100, height: 80 }),
      screen: (_s, p) => p, settle: async () => {}, noChange: async () => {},
      hit: async (_page, p) => p === point
        ? { inside: true, id: clicked ? 'Payment' : 'OrderCollaboration', class: clicked ? 'djs-hit-click-stroke' : 'djs-resizer-hit' }
        : { inside: true, id: 'ValidateOrder' } };
    const page = { mouse: { move: async (x, y) => { pointer = { x, y }; }, click: async (x, y) => {
      assert.deepEqual({ x, y }, pointer); clicked = true; selection = ['ValidateOrder'];
    } } };
    const result = await prepareReferenceOutlineTarget(h, page,
      { source: 'ValidateOrder', target: 'Payment', point }, e => { saved = e; });
    assert.equal(result, saved); assert.equal(result.point, point);
    assert.equal(result.beforeHit.id, 'OrderCollaboration'); assert.equal(result.afterHit.id, 'Payment');
  };
  await run();
  for (const corrupt of [s => { s.xml += 'changed'; }, s => { s.history.undo = false; },
    s => { s.viewport.x++; }, s => { s.selection = ['Payment']; }]) await assert.rejects(run(corrupt));
});
