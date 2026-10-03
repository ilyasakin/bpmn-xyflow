/** Native visible-UI T03/T04 acceptance; no model/route setters for setup. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { endpoint } from '../helpers/anchor-followup-controls.mjs';
import { assertOnlyAnchorGeometry } from '../helpers/anchor-model-guard.mjs';
import { zoomPreviewMotion } from '../helpers/anchor-preview-zoom.mjs';
import { runViewportSourceCases } from './browser-viewport-source-grabs.mjs';

/** Independent paint contract, deliberately not the production corner algorithm. */
export function assertForwardPaint(d, start, end) {
  const commands = [...d.matchAll(/([MLC])([^MLC]+)/g)].map(([, kind, body]) => {
    const numbers = body.split(/[ ,]+/).filter(Boolean).map(Number);
    assert.equal(numbers.length, kind === 'C' ? 6 : 2, 'known complete SVG command');
    assert.ok(numbers.every(Number.isFinite));
    return { kind, points: numbers.reduce((points, x, i) => i % 2 ? points : [...points, { x, y: numbers[i + 1] }], []) };
  });
  assert.ok(commands.length >= 2); assert.equal(commands[0].kind, 'M');
  assert.deepEqual(commands[0].points[0], start); assert.deepEqual(commands.at(-1).points.at(-1), end);
  const points = commands.flatMap(command => command.points);
  for (const axis of ['x', 'y']) {
    const direction = Math.sign(end[axis] - start[axis]);
    for (let i = 1; i < points.length; i++) {
      const bound = Number.EPSILON * 8 * Math.max(1, Math.abs(points[i][axis]), Math.abs(points[i - 1][axis]));
      if (!direction) assert.equal(points[i][axis], start[axis], 'aligned axis remains exact');
      else assert.ok((points[i][axis] - points[i - 1][axis]) * direction >= -bound, `backtracking ${axis}: ${d}`);
    }
  }
  if (start.x === end.x || start.y === end.y)
    assert.equal(d, `M${start.x},${start.y}L${end.x},${end.y}`, 'exactly aligned facing endpoints produce a single line');
  return { commands: commands.length, curves: commands.filter(c => c.kind === 'C').length };
}

export function collectConnectionPaint(id = null) {
  const path = id
    ? [...document.querySelectorAll('#viewer [data-element-id]')].find(e => e.getAttribute('data-element-id') === id && e.querySelector('.bpmn-xyflow-connection-visual'))?.querySelector('.bpmn-xyflow-connection-visual')
    : document.querySelector('#viewer .bpmn-xyflow-connect-preview > path');
  if (!path) throw Error(`Missing visible ${id || 'preview'} path`);
  const style = getComputedStyle(path), box = path.getBoundingClientRect(), matrix = path.getScreenCTM();
  if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0 || !(box.width || box.height)) throw Error('Path is not visible');
  const begin = path.getPointAtLength(0), end = path.getPointAtLength(path.getTotalLength());
  return { d: path.getAttribute('d'), dpr: devicePixelRatio,
    matrix: Object.fromEntries(['a','b','c','d','e','f'].map(key => [key, matrix[key]])),
    browserEndpoints: [{x:begin.x,y:begin.y},{x:end.x,y:end.y}],
    style: { stroke:style.stroke, width:style.strokeWidth, markerEnd:style.markerEnd },
    hitD: id ? path.parentElement.querySelector('.bpmn-xyflow-connection-hit')?.getAttribute('d') : null };
}

async function workflow(h, page, key, config) {
  await page.setViewport({ width:1800, height:1200, deviceScaleFactor:config.dpr });
  assert.equal(await page.evaluate(() => devicePixelRatio), config.dpr);
  const zoomEvidence = {};
  try { await zoomPreviewMotion(h,page,config.zoom,zoomEvidence); }
  finally { await writeFile(`${h.output}/${key}-zoom-setup.json`,JSON.stringify(zoomEvidence,null,2)); }
  const {source, target} = await h.tasks(page, config.vertical ? 'bottom' : 'right', config.zoom, {sourceLabel:config.sourceLabel});
  const initial = await h.state(page), a = h.node(initial, source), b = h.node(initial, target);
  const cross = config.vertical ? 'x' : 'y', size = config.vertical ? 'width' : 'height';
  assert.equal(a[cross] + a[size]/2, b[cross] + b[size]/2, 'visible palette-created node centers are aligned');
  const sourceSide = config.vertical ? 'bottom' : 'right', targetSide = config.vertical ? 'top' : 'left';
  let created, preview, sourceEvidence;
  for (const cancel of [true, false]) {
    const port = await h.sourcePort(page, source, sourceSide, .5, { selected:true });
    const before = await h.state(page), targetNode = h.node(before, target);
    const to = h.screen(before, h.side(targetNode, targetSide));
    // An exact delivered integer along the source's axis is the aligned
    // control; +1/+8 CSS pixels deliberately retain the user's chosen offset.
    to[cross] = Math.round(h.screen(before, port.anchor)[cross]) + config.offset;
    assert.equal((await h.hit(page, to)).id, target, 'unobstructed visible target receives the drop');
    await h.drag(page, port.point, to, {cancel, capture:async () => {
      preview = await page.evaluate(collectConnectionPaint);
      const endpoints = await h.preview(page); assert.ok(endpoints, 'positive connection preview');
      // Exact endpoints are encoded in d; browser path sampling uses SVG float precision.
      const dStart = preview.d.match(/^M([^LMC]+)/)[1].split(',').map(Number);
      const dEnd = preview.d.match(/(?:L|C)([^LCM]+)$/)[1].split(',').map(Number).slice(-2);
      assert.deepEqual({x:dStart[0],y:dStart[1]}, port.anchor);
      assertForwardPaint(preview.d, port.anchor, {x:dEnd[0],y:dEnd[1]});
    }});
    const after = await h.state(page);
    if (cancel) {
      assert.equal(after.xml, before.xml); assert.deepEqual(after.history, before.history);
      assert.deepEqual(after.selection,before.selection); assert.deepEqual(after.viewport,before.viewport);
      continue;
    }
    const edges = Object.values(after.edges).filter(e => !before.edges[e.id]); assert.equal(edges.length, 1);
    const edge = edges[0]; assert.equal(edge.type,'bpmn:SequenceFlow');
    assert.equal(edge.source, source); assert.equal(edge.target, target);
    assert.deepEqual(edge.points[0], port.anchor);
    const delivered = after.input.findLast(e => e.type === 'mouseup'); assert.equal(delivered.trusted, true);
    assert.deepEqual({x:delivered.x,y:delivered.y}, {x:Math.trunc(to.x),y:Math.trunc(to.y)});
    const expected = h.projected(targetNode, h.graph(after, delivered));
    h.near(edge.points.at(-1), expected, 1e-7, 'chosen target survives the exact delivered native input');
    if (!config.offset && config.sourceLabel === 'Task') assert.equal(edge.points[0][cross], edge.points.at(-1)[cross]);
    const paint = await page.evaluate(collectConnectionPaint, edge.id);
    assert.equal(paint.d, preview.d); assert.equal(paint.hitD, paint.d); assert.equal(paint.dpr,config.dpr);
    assertForwardPaint(paint.d, edge.points[0], edge.points.at(-1));
    await h.creationOnly(before,after,edge); await h.history(page,before,after);
    created=edge; sourceEvidence={port,delivered,paint,preview};
  }
  const from = await endpoint(h,page,created.id,'target'), before = await h.state(page);
  const to = {...from,[cross]:from[cross]+7};
  assert.ok((await h.hit(page,to)).owners.includes(target), 'same-target reconnect retains visible target hit');
  let routePreview;
  await h.drag(page,from,to,{capture:async()=>{
    routePreview=await page.evaluate(collectConnectionPaint,created.id);
    assert.notEqual(routePreview.d,sourceEvidence.paint.d,'reconnect actually changes route preview');
  }});
  const reconnected=await h.state(page), edge=reconnected.edges[created.id];
  assert.deepEqual(edge.points[0],created.points[0]);
  const release=reconnected.input.findLast(event=>event.type==='mouseup');assert.equal(release.trusted,true);
  assert.deepEqual({x:release.x,y:release.y},{x:Math.trunc(to.x),y:Math.trunc(to.y)});
  h.near(edge.points.at(-1),h.projected(h.node(before,target),h.graph(reconnected,release)),1e-7,
    'reconnect endpoint equals the independent projection of delivered input');
  const painted=await page.evaluate(collectConnectionPaint,edge.id);
  assert.equal(painted.d,routePreview.d,'reconnect preview and committed path agree exactly');
  assertForwardPaint(painted.d,edge.points[0],edge.points.at(-1));
  await assertOnlyAnchorGeometry(before.xml,reconnected.xml,{edgeIds:[edge.id]});
  await h.reconnectOnly(before,reconnected,edge.id,'target',target);await h.history(page,before,reconnected);

  if(config.editShape){
    const beforeMove=await h.state(page), n=h.node(beforeMove,target), center=h.screen(beforeMove,{x:n.x+n.width/2,y:n.y+n.height/2});
    assert.equal((await h.hit(page,center)).id,target);
    await h.drag(page,center,{x:center.x+30,y:center.y+20});
    const moved=await h.state(page);assert.notDeepEqual(h.node(moved,target),n);
    const movedPaint=await page.evaluate(collectConnectionPaint,edge.id);
    assertForwardPaint(movedPaint.d,moved.edges[edge.id].points[0],moved.edges[edge.id].points.at(-1));
    await assertOnlyAnchorGeometry(beforeMove.xml,moved.xml,{shapeIds:[target],edgeIds:[edge.id]});await h.history(page,beforeMove,moved);
    await h.selectNode(page,target);
    const resize=await page.waitForSelector('.bpmn-xyflow-resize-handle[data-resize-dir="se"]',{visible:true});
    const rect=await resize.boundingBox(), grab={x:rect.x+rect.width/2,y:rect.y+rect.height/2};
    assert.equal(await resize.evaluate((e,p)=>e.contains(document.elementFromPoint(p.x,p.y)),grab),true);
    const beforeResize=await h.state(page);await h.drag(page,grab,{x:grab.x+30,y:grab.y+20});
    const resized=await h.state(page);assert.ok(h.node(resized,target).width>h.node(beforeResize,target).width);
    const resizedPaint=await page.evaluate(collectConnectionPaint,edge.id);
    assertForwardPaint(resizedPaint.d,resized.edges[edge.id].points[0],resized.edges[edge.id].points.at(-1));
    await assertOnlyAnchorGeometry(beforeResize.xml,resized.xml,{shapeIds:[target],edgeIds:[edge.id]});await h.history(page,beforeResize,resized);
  }
  const final=await h.state(page);await h.reopenThroughVisibleReference(page,final,key);
  return {config,source,target,zoomEvidence,sourceEvidence,reconnect:{from,to,release,routePreview,painted},finalEdge:final.edges[created.id]};
}

export const connectionPaintCases = [
  {name:'task-horizontal-aligned',sourceLabel:'Task',vertical:false,zoom:1,dpr:1,offset:0,editShape:true},
  {name:'task-vertical-aligned',sourceLabel:'Task',vertical:true,zoom:1,dpr:2,offset:0},
  {name:'gateway-horizontal-one-pixel',sourceLabel:'Gateway',vertical:false,zoom:1,dpr:1,offset:1},
  {name:'gateway-vertical-low-zoom',sourceLabel:'Gateway',vertical:true,zoom:.65,dpr:2,offset:1},
  {name:'event-horizontal-high-zoom',sourceLabel:'Start',vertical:false,zoom:2,dpr:2,offset:1},
  {name:'task-vertical-eight-pixel',sourceLabel:'Task',vertical:true,zoom:1,dpr:2,offset:8}
].map((config,index)=>({id:`PAINT-${index+1}`,name:config.name,engine:'local',sample:'Empty diagram',
  run:(h,page,key)=>workflow(h,page,key,config)}));

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv.includes('--list'))console.log(JSON.stringify(connectionPaintCases.map(({run:_run,...c})=>({...c,status:'prepared-unrun'})),null,2));
  else await runViewportSourceCases(connectionPaintCases,{output:'test-artifacts/connection-paint',basePort:Number(process.env.BPMN_CONNECTION_PAINT_PORT||5440)});
}
