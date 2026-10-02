/** D15 native acceptance. Prepared; never launched in the restricted local runtime. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createAnchorHarness } from '../helpers/anchor-ux-browser.mjs';
import { roundedTaskPoint, projectRoundedTask } from '../helpers/anchor-ownership-browser.mjs';
import { runFollowupCases, assertFollowupPortClosed } from '../helpers/anchor-followup-lifecycle.mjs';

const definitions = [
  ['left', 'w', .5, [340, 0]], ['right', 'e', 2, [-340, 0]],
  ['top', 'n', .5, [0, 260]], ['bottom', 's', 2, [0, -260]],
  ['north-west', 'nw', .5, [340, 220]], ['north-east', 'ne', 2, [-340, 220]],
  ['south-west', 'sw', .5, [340, -220]], ['south-east', 'se', 2, [-340, -220]],
  ['palette-low', 'w', .5, [340, 0]], ['palette-high', 'w', 2, [340, 0]],
  ['minimap-low', 'e', .5, [-340, 0]], ['minimap-high', 'e', 2, [-340, 0]]
];

/** Integer delivered input, with no click-like 1–3px correction loop. */
export function panSteps(delta) {
  const total = Math.round(delta);
  assert.ok(Number.isSafeInteger(total) && Math.abs(total) <= 10000);
  if (!total) return [];
  if (Math.abs(total) <= 3) return [10 * Math.sign(total), total - 10 * Math.sign(total)];
  const count = Math.ceil(Math.abs(total) / 90), base = Math.floor(Math.abs(total) / count);
  return Array.from({ length: count }, (_, i) => Math.sign(total) * (base + (i < Math.abs(total) % count ? 1 : 0)));
}

// Installed d3-zoom mousedowned/translate use inverse-then-forward arithmetic,
// not priorTranslation + delta. Keep its exact operation order (no epsilon).
export function nativePanViewport(before, down, moved) {
  assert.ok([before.x,before.y,before.zoom,down.x,down.y,moved.x,moved.y].every(Number.isFinite));
  assert.ok(before.zoom > 0);
  return { x: moved.x - ((down.x - before.x) / before.zoom) * before.zoom,
    y: moved.y - ((down.y - before.y) / before.zoom) * before.zoom, zoom: before.zoom };
}

export function collectPanGeometry(points = []) {
  const svg = document.querySelector('#viewer .bpmn-xyflow-canvas');
  const matrix = svg.getScreenCTM(), inverse = matrix.inverse();
  return { matrix: Object.fromEntries(['a','b','c','d','e','f'].map(key => [key,matrix[key]])),
    points: points.map(({x,y}) => { const point=svg.createSVGPoint();point.x=x;point.y=y;
      const local=point.matrixTransform(inverse);return {x:local.x,y:local.y}; }) };
}

async function panBy(h, page, dx, dy) {
  const before = await h.state(page), events = [];
  for (const [axis, delta] of [['x', dx], ['y', dy]]) for (const amount of panSteps(delta)) {
    const current = await h.raw(page), candidate = await h.blank(page);
    const geometry = await page.evaluate(collectPanGeometry);
    const from = { x: Math.round(candidate.x), y: Math.round(candidate.y) }, to = { ...from, [axis]: from[axis] + amount };
    assert.ok(to.x > 0 && to.x < 1800 && to.y > current.container.y && to.y < 1200, 'pan remains in visible canvas');
    await page.mouse.move(from.x, from.y);
    await page.evaluate(() => { window.viewportSourcePanMarker = window.anchorInput.at(-1); });
    await page.mouse.down({ button: 'middle' });
    try { await page.mouse.move(to.x, to.y, { steps: Math.abs(amount) }); }
    finally { await page.mouse.up({ button: 'middle' }); }
    await h.settle(page);
    const delivered = await page.evaluate(() => {
      const index = window.anchorInput.indexOf(window.viewportSourcePanMarker);
      delete window.viewportSourcePanMarker;
      if (index < 0) throw Error('lost native pan evidence');
      return window.anchorInput.slice(index + 1);
    });
    const down = delivered.find(e => e.type === 'mousedown'), up = delivered.findLast(e => e.type === 'mouseup');
    assert.equal(down?.trusted, true); assert.equal(up?.trusted, true);
    assert.deepEqual([down.button, up.button], [1, 1]);
    assert.deepEqual({ x: down.x, y: down.y }, from); assert.deepEqual({ x: up.x, y: up.y }, to);
    const moved = delivered.findLast(e => e.type === 'mousemove');assert.equal(moved?.trusted,true);
    assert.deepEqual({x:moved.x,y:moved.y},to,'last delivered move reaches the requested pan destination');
    const observed = await page.evaluate(collectPanGeometry,[{x:down.x,y:down.y},{x:moved.x,y:moved.y}]);
    assert.deepEqual(observed.matrix,geometry.matrix,'root SVG frame stays fixed while its graph viewport pans');
    const after = await h.raw(page), expected = nativePanViewport(current.viewport,...observed.points);
    assert.deepEqual(after.viewport, expected, 'camera follows exact delivered D3 inverse/translate arithmetic');
    assert.equal(after.xml, before.xml); assert.deepEqual(after.history, before.history); assert.deepEqual(after.selection, before.selection);
    events.push({ down, moved, up, before:current.viewport, svg:observed, expected, viewport: after.viewport });
  }
  return events;
}

export function collectViewportSurfaces() {
    const box = e => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const root = document.querySelector('#viewer'), canvas = box(root), chrome = [...root.querySelectorAll('.bpmn-xyflow-palette,.bpmn-xyflow-editor-actions,.bpmn-xyflow-minimap,.bjs-powered-by,.bpmn-xyflow-context-pad')]
      .filter(e => getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden')
      .map(e => ({ className: e.getAttribute('class') || '', ...box(e) })).filter(r => r.width > 0 && r.height > 0);
    return { canvas, chrome, width: innerWidth, height: innerHeight };
}

async function surfaces(page) {
  return page.evaluate(collectViewportSurfaces);
}

function positionFor(name, layout) {
  const { canvas: c, chrome, width, height } = layout;
  const left = Math.max(0, c.left) + 4, right = Math.min(width, c.right) - 4;
  const top = Math.max(0, c.top) + 4, bottom = Math.min(height, c.bottom) - 4;
  const palette = chrome.find(r => r.className.includes('palette'));
  const minimap = chrome.find(r => r.className.includes('minimap'));
  assert.ok(palette && minimap, 'real editor chrome is present');
  if (name.startsWith('palette')) return { x: palette.right + 4, y: (palette.top + palette.bottom) / 2 };
  if (name.startsWith('minimap')) return { x: minimap.left - 4, y: (minimap.top + minimap.bottom) / 2 };
  return {
    left: { x: left, y: Math.max(palette.bottom + 90, (top + bottom) / 2) },
    right: { x: right, y: (top + bottom) / 2 },
    top: { x: (left + right) / 2, y: top },
    bottom: { x: (left + right) / 2, y: bottom },
    // The top-left canvas corner is occupied by the palette. Its nearest
    // genuinely visible corner is beside the palette and above the toolbar.
    'north-west': { x: palette.right + 4, y: top },
    'north-east': { x: right, y: top },
    'south-west': { x: left, y: bottom },
    'south-east': { x: right, y: bottom }
  }[name];
}

export function collectViewportAffordance(id) {
    const group = document.querySelector(`.bpmn-xyflow-connect-handle[data-connect-source="${id}"]`);
    const docking = document.querySelector(`.bpmn-xyflow-connect-docking[data-connect-source="${id}"]`);
    const port = group?.querySelector('.bpmn-xyflow-connect-port'), marker = docking?.querySelector('circle'), tether = docking?.querySelector('line');
    if (!port || !marker || !tether) return null;
    const p = e => ({ x: Number(e.getAttribute('cx')), y: Number(e.getAttribute('cy')) });
    const screen = e => { const v = p(e), point = new DOMPoint(v.x, v.y).matrixTransform(e.getScreenCTM()); return { x: point.x, y: point.y }; };
    const matrix = port.getScreenCTM(), scale = Math.hypot(matrix.a, matrix.b), grab = screen(port), anchor = p(marker);
    const press = { x: Math.round(grab.x), y: Math.round(grab.y) }, hit = document.elementFromPoint(press.x, press.y);
    const radius = (port.r.baseVal.value + parseFloat(getComputedStyle(port).strokeWidth) / 2) * scale;
    const visible = e => { for (let n = e; n; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) <= 0) return false; } return e.isConnected; };
    const colored = value => {
      const color = String(value || '').trim().toLowerCase();
      if (!color || color === 'none' || color === 'transparent') return false;
      const slash = color.lastIndexOf('/');
      if (slash >= 0) return parseFloat(color.slice(slash + 1)) > 0;
      if (color.startsWith('rgba(') || color.startsWith('hsla(')) return parseFloat(color.slice(color.lastIndexOf(',') + 1)) > 0;
      return true;
    };
    const painted = (e, circle = false) => {
      const s = getComputedStyle(e);
      return visible(e) && colored(s.stroke) && Number(s.strokeOpacity) > 0 && parseFloat(s.strokeWidth) > 0 &&
        (!circle || colored(s.fill) && Number(s.fillOpacity) > 0);
    };
    return { owner: group.getAttribute('data-connect-source'), anchor, markerScreen: screen(marker), grab, press, radius,
      visible: painted(port, true), markerVisible: painted(marker, true), tetherVisible: painted(tether), hit: group.contains(hit),
      hitClass: hit?.getAttribute('class'), tether: { x1: Number(tether.getAttribute('x1')), y1: Number(tether.getAttribute('y1')), x2: Number(tether.getAttribute('x2')), y2: Number(tether.getAttribute('y2')) },
      grabGraph: p(port), taskRadius: document.querySelector(`.bpmn-xyflow-shape[data-element-id="${id}"] > rect`)?.rx.baseVal.value,
      delivered: window.anchorInput.findLast(e => e.type === 'mousemove') };
}
async function readAffordance(page, id) { return page.evaluate(collectViewportAffordance, id); }

export function assertAffordance(e, layout, owner) {
  assert.ok(e, 'source affords an actual visible grab'); assert.equal(e.owner, owner);
  assert.equal(e.visible, true); assert.equal(e.markerVisible, true); assert.equal(e.tetherVisible, true); assert.equal(e.hit, true);
  const c = layout.canvas, left = Math.max(0, c.left), right = Math.min(layout.width, c.right), top = Math.max(0, c.top), bottom = Math.min(layout.height, c.bottom);
  assert.ok(e.radius > 0 && Math.abs(e.radius - 5.75) < .01, 'native paint keeps its fixed CSS size');
  assert.ok(e.grab.x - e.radius >= left && e.grab.x + e.radius <= right && e.grab.y - e.radius >= top && e.grab.y + e.radius <= bottom, 'complete painted grab is inside the visible canvas');
  assert.ok(e.markerScreen.x >= left && e.markerScreen.x <= right && e.markerScreen.y >= top && e.markerScreen.y <= bottom, 'the chosen outline point itself is visible');
  assert.ok(Math.hypot(e.grab.x - e.markerScreen.x, e.grab.y - e.markerScreen.y) >= 12 - .01, 'distinct origin and grab leave a visible tether');
  for (const box of layout.chrome) {
    assert.ok(e.grab.x + e.radius <= box.left || e.grab.x - e.radius >= box.right || e.grab.y + e.radius <= box.top || e.grab.y - e.radius >= box.bottom, `grab clears ${box.className}`);
    assert.ok(e.markerScreen.x < box.left || e.markerScreen.x > box.right || e.markerScreen.y < box.top || e.markerScreen.y > box.bottom, `outline is not hidden under ${box.className}`);
  }
  assert.deepEqual({ x: e.tether.x1, y: e.tether.y1 }, e.anchor); assert.deepEqual({ x: e.tether.x2, y: e.tether.y2 }, e.grabGraph);
}

async function approach(h, page, source, desired, key, phase, requireAttributionCrossing = false) {
  const before = await h.state(page), start = h.screen(before, desired);
  await page.evaluate(() => { window.viewportSourceAcquireMarker = window.anchorInput.at(-1); });
  await page.mouse.move(start.x, start.y, { steps: 12 }); await h.settle(page);
  const acquired = await page.evaluate(() => {
    const index = window.anchorInput.indexOf(window.viewportSourceAcquireMarker);
    delete window.viewportSourceAcquireMarker;
    if (index < 0) throw Error('lost fresh source acquisition evidence');
    return window.anchorInput.slice(index + 1).findLast(e => e.type === 'mousemove');
  });
  assert.equal(acquired?.trusted, true);
  assert.ok(Math.abs(acquired.x - start.x) <= 1 && Math.abs(acquired.y - start.y) <= 1, 'delivered acquiring point is within native pixel quantization');
  const initial = await readAffordance(page, source), layout = await surfaces(page);
  await h.save(page, `${key}-${phase}-marker`, { desired, start, acquired, initial, layout });
  assertAffordance(initial, layout, source);
  assert.ok(initial.taskRadius > 0, 'actual painted Task corner radius is available');
  const expectedOrigin = projectRoundedTask(h.node(before, source), initial.taskRadius, h.graph(before, acquired));
  h.near(initial.anchor, expectedOrigin, 1e-7, 'origin equals independent outline projection of the fresh delivered acquiring event');
  const attributionHits = await page.evaluate(({from,to}) => {
    const attribution=document.querySelector('#viewer .bjs-powered-by'),rect=attribution?.getBoundingClientRect(),hits=[];
    if(!rect)return hits;
    const steps=Math.ceil(Math.hypot(to.x-from.x,to.y-from.y));
    for(let i=1;i<steps;i++){
      const point={x:from.x+(to.x-from.x)*i/steps,y:from.y+(to.y-from.y)*i/steps};
      if(point.x>rect.left+1&&point.x<rect.right-1&&point.y>rect.top+1&&point.y<rect.bottom-1){
        const target=document.elementFromPoint(point.x,point.y);hits.push({point,tag:target?.tagName,attributionOwns:!!target&&attribution.contains(target)});
      }
    }
    return hits;
  },{from:initial.markerScreen,to:initial.grab});
  if(requireAttributionCrossing)assert.ok(attributionHits.length>0,'the southeast fixture exercises its actual attribution crossing');
  assert.ok(attributionHits.every(hit=>hit.attributionOwns),'the HTML attribution retains hit ownership along the inert tether');
  await page.mouse.move(initial.press.x, initial.press.y, { steps: Math.max(1, Math.ceil(Math.hypot(initial.press.x - start.x, initial.press.y - start.y))) });
  await h.settle(page);
  const reached = await readAffordance(page, source);
  assertAffordance(reached, await surfaces(page), source);
  assert.deepEqual(reached.anchor, initial.anchor, 'small-step tether approach retains exact chosen origin');
  assert.deepEqual(reached.grab, initial.grab, 'the displayed grab does not chase the pointer');
  assert.equal(reached.delivered?.trusted, true);
  assert.deepEqual({ x: reached.delivered.x, y: reached.delivered.y }, initial.press);
  await h.noChange(page, before, 'approach changes no document or history');
  await h.save(page, `${key}-${phase}-reached`, { initial, reached, attributionHits });
  return reached;
}

async function workflow(h, page, key, { name, direction, zoom, offset }) {
  const first = await h.state(page), start = first.nodes.find(n => n.type === 'bpmn:StartEvent');
  await h.selectNode(page, start.id); await page.keyboard.press('Delete'); await h.settle(page);
  assert.equal((await h.raw(page)).nodes.some(n => n.id === start.id), false);
  await h.zoom(page, zoom);
  const source = await h.palette(page, 'Task', { x: 900, y: 650 });
  const target = await h.palette(page, 'Task', { x: 900 + offset[0], y: 650 + offset[1] });
  await h.selectNode(page, source);
  let state = await h.state(page);
  const desired = roundedTaskPoint(h.node(state, source), 10, direction), client = positionFor(name, await surfaces(page));
  const current = h.screen(state, desired), pan = await panBy(h, page, client.x - current.x, client.y - current.y);
  state = await h.state(page); const positioned = h.screen(state, desired);
  assert.ok(Math.abs(positioned.x - client.x) <= .51 && Math.abs(positioned.y - client.y) <= .51, 'native integer pan reaches the intended boundary within pixel quantization');
  const before = await h.state(page), port = await approach(h, page, source, desired, key, 'initial', name === 'south-east');
  assert.deepEqual(before.selection, [source], 'the selected source owns its resize controls');
  await page.mouse.click(port.press.x, port.press.y); await h.settle(page);
  const clicked = await h.noChange(page, before, 'stationary edge grab creates no model/history command');
  assert.deepEqual(clicked.selection, before.selection); assert.deepEqual(clicked.viewport, before.viewport);
  const retry = await readAffordance(page, source); assertAffordance(retry, await surfaces(page), source); assert.deepEqual(retry.anchor, port.anchor);
  const to = h.screen(before, h.side(h.node(before, target), 'top', .3));
  assert.ok((await h.hit(page, to)).owners.includes(target), 'destination is genuinely visible before any pan recovery');
  let cancelledPreview;
  await h.drag(page, retry.press, to, { cancel: true, capture: async () => {
    cancelledPreview = await h.preview(page); assert.ok(cancelledPreview?.length > 5, 'a real connection preview activates before Escape');
    h.near(cancelledPreview.screenStart, port.markerScreen, .1, 'preview starts at the displayed outline marker');
    await h.save(page, `${key}-pre-recovery-cancel-preview`, { port, cancelledPreview });
  } });
  const cancelled = await h.noChange(page, before, 'Escape returns the complete document/history exactly');
  assert.deepEqual(cancelled.viewport, before.viewport); assert.deepEqual(cancelled.selection, before.selection); assert.equal(await h.preview(page), null);
  const again = await approach(h, page, source, desired, key, 'retry', name === 'south-east');
  let committedPreview;
  await h.drag(page, again.press, to, { capture: async () => {
    committedPreview = await h.preview(page); assert.ok(committedPreview?.length > 5);
    h.near(committedPreview.screenStart, again.markerScreen, .1, 'commit preview preserves outline origin');
    await h.save(page, `${key}-pre-recovery-commit-preview`, { again, committedPreview });
  } });
  const after = await h.state(page), additions = Object.values(after.edges).filter(e => !before.edges[e.id]);
  assert.equal(additions.length, 1); const edge = additions[0];
  assert.equal(edge.source, source); assert.equal(edge.target, target); assert.equal(edge.type, 'bpmn:SequenceFlow');
  assert.deepEqual(edge.points[0], again.anchor, 'exported source is exactly the indicated outline point, never the grab');
  assert.deepEqual(after.viewport, before.viewport, 'connection creation does not silently pan or zoom');
  const up = after.input.findLast(e => e.type === 'mouseup'); assert.equal(up?.trusted, true);
  h.near(edge.points.at(-1), h.projected(h.node(before, target), up.graphPoint), .05 / after.viewport.zoom, 'target uses actual delivered pointer');
  const rendered = await h.renderEnds(page, edge.id);
  h.near(rendered.start, committedPreview.screenStart, .1, 'rendered source matches active preview');
  h.near(rendered.end, committedPreview.screenEnd, .1, 'rendered target matches active preview');
  await h.creationOnly(before, after, edge); await h.history(page, before, after);
  await h.clickButton(page, '#undo-btn'); const restored = await h.state(page); assert.equal(restored.xml, before.xml);
  // Recovery is additional camera-only evidence, after usable creation/cancel
  // from the constrained source has already been positively demonstrated.
  const middle = { x: 900, y: 650 }, p = h.screen(restored, desired);
  const recovery = await panBy(h, page, Math.sign(middle.x - p.x) * 100, Math.sign(middle.y - p.y) * 100);
  return { name, direction, requestedZoom: zoom, actualZoom: before.viewport.zoom, source, target, client, positioned, pan, port, cancelledPreview, committedPreview, edge, rendered, recovery };
}

export const viewportSourceCases = definitions.map(([name, direction, zoom, offset], index) => ({
  id: `D15-${String(index + 1).padStart(2, '0')}`, name, engine: 'local', sample: 'Empty diagram',
  direction, zoom, run: (h, page, key) => workflow(h, page, key, { name, direction, zoom, offset })
}));

export async function runViewportSourceCases() {
  const output = 'test-artifacts/viewport-source-grabs', basePort = Number(process.env.BPMN_VIEWPORT_SOURCE_PORT || 5320);
  await mkdir(output, { recursive: true });
  const persist = (name, result, signal) => writeFile(`${output}/${name}`, JSON.stringify(result, null, 2), { signal });
  const results = await runFollowupCases(viewportSourceCases, {
    createHarness: (_c, i) => createAnchorHarness({ port: basePort + i, output }),
    verifyStopped: (_h, _c, i) => assertFollowupPortClosed(basePort + i),
    captureFailure: async (h, page, key, error, signal) => {
      await page.screenshot({ path: `${output}/${key}-failure.png`, fullPage: true }); signal.throwIfAborted();
      const raw = await h.raw(page); signal.throwIfAborted();
      await writeFile(`${output}/${key}-failure.bpmn`, raw.xml, { signal });
      await persist(`${key}-failure.json`, { error: String(error), state: raw }, signal);
    },
    persistProgress: (snapshot, i, signal) => persist(`results-progress-${String(i + 1).padStart(3, '0')}.json`, snapshot, signal),
    persistAggregate: (snapshot, signal) => persist('results.json', snapshot, signal)
  });
  assert.equal(results.length, viewportSourceCases.length);
  const failed = results.filter(r => r.status !== 'passed');
  console.log(`Viewport source grabs: ${results.length - failed.length}/${results.length} passed`);
  assert.equal(failed.length, 0, `Native D15 failures; see ${output}/results.json`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--list')) console.log(JSON.stringify(viewportSourceCases.map(({run:_run,...c})=>({...c,status:'prepared-unrun'})),null,2));
  else await runViewportSourceCases();
}
