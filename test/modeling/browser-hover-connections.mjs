/** Native hover-control differential against bpmn-js 18.30.1.
 * Fixture imports, one ordinary-selection constructor setup and lifecycle teardown use APIs. All tested selection, dragging,
 * cancellation, deletion and history actions use trusted Chromium input.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { BpmnModdle } from 'bpmn-moddle';
import { collectHoverBackground } from '../helpers/hover-background.mjs';
import { assertUpstreamHoverDeleteUndo, assertUpstreamHoverDeleteReopen } from '../helpers/hover-delete-order-oracle.mjs';
import { assertSelectedZoomGeometry } from '../helpers/selected-zoom-geometry.mjs';

const require = createRequire(import.meta.url), oracle = new BpmnModdle();
assert.equal(require('bpmn-js/package.json').version, '18.30.1');
const port = Number(process.env.BPMN_HOVER_PORT || 5249), base = 'http://localhost:' + port;
const results = []; let browser, server, serverOutput = '';
const xy = p => ({ x: p.x, y: p.y });
const near = (a, b, message, tolerance = .01) => assert.ok(a && Math.hypot(a.x - b.x, a.y - b.y) <= tolerance, message + ': ' + JSON.stringify({ actual: a, expected: b }));

async function setup(engine, name = 'orthogonal', zoom = 1) {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(30000);
  try {
    await page.setViewport({ width: 1800, height: 1250 });
    await page.goto(base + '/modeler/', { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !!window.modeler?.getGraph());
    if (engine === 'upstream') {
      await page.addScriptTag({ path: require.resolve('bpmn-js/dist/bpmn-modeler.development.js') });
      for (const file of ['diagram-js.css', 'bpmn-js.css']) await page.addStyleTag({ path: require.resolve('bpmn-js/dist/assets/' + file) });
    }
    const xml = await readFile('test/fixtures/hover-native/' + name + '.bpmn', 'utf8');
    const warnings = await page.evaluate(async ({ engine, xml, zoom, modelerUrl, backgroundUrl }) => {
      const { observeReferenceBackgroundClicks } = await import(backgroundUrl);
      const container = document.querySelector('#viewer');
      let m = window.modeler;
      if (engine === 'upstream') { m.destroy(); container.replaceChildren(); m = new window.BpmnJS({ container }); }
      const imported = await m.importXML(xml);
      window.makeHoverAdapter = (model, element, scale) => {
        const t = { engine, m: model, container: element, starts: [], events: [], focusEvents: [], clickTrace: [], xmlInput: xml, modelerUrl };
        if (engine === 'local') {
          Object.assign(t, { node: id => model.getElement(id), xml: () => model.getXML(), selection: () => model.getSelection(), history: () => ({ undo: model.canUndo(), redo: model.canRedo(), size: model.commandStack.size() }), matrix: () => model.viewer._internals.viewport.getScreenCTM() });
          model.setViewport({ x: 140, y: 100, zoom: scale }, { duration: 0 });
        } else {
          const canvas = model.get('canvas');
          t.clickTrace = observeReferenceBackgroundClicks(model.get('eventBus'));
          Object.assign(t, { node: id => model.get('elementRegistry').get(id), xml: async () => (await model.saveXML({ format: true })).xml, selection: () => model.get('selection').get().map(e => e.id), history: () => ({ undo: model.get('commandStack').canUndo(), redo: model.get('commandStack').canRedo(), index: model.get('commandStack')._stackIdx }), matrix: () => canvas._viewport.getScreenCTM() });
          canvas.viewbox({ x: -140 / scale, y: -100 / scale, width: element.clientWidth / scale, height: element.clientHeight / scale });
          for (const kind of ['bendpoint.move', 'connectionSegment.move']) for (const phase of ['start', 'move', 'end', 'cancel']) model.get('eventBus').on(kind + '.' + phase, 20000, event => {
            const entry = { kind, phase, id: event.context.connection.id, x: event.x, y: event.y, insert: event.context.insert, index: event.context.bendpointIndex ?? event.context.segmentStartIndex, type: event.context.type };
            t.events.push(entry); t.activeContext = event.context; if (phase === 'start') t.starts.push(entry);
          });
        }
        return t;
      };
      window.hoverTest = window.makeHoverAdapter(m, container, zoom);
      for (const type of ['focus', 'blur']) window.addEventListener(type, event => window.hoverTest.focusEvents.push({ type, trusted: event.isTrusted }));
      for (const type of ['mousedown', 'mousemove', 'mouseup']) window.addEventListener(type, event => {
        const t = window.hoverTest, matrix = t.matrix(); if (!matrix) return;
        const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
        t.lastInput = { type, trusted: event.isTrusted, client: { x: event.clientX, y: event.clientY }, graph: { x: point.x, y: point.y }, matrix: Object.fromEntries(['a','b','c','d','e','f'].map(k => [k, matrix[k]])) };
      }, true);
      return imported.warnings.map(w => w.message);
    }, { engine, xml, zoom, modelerUrl: '/@fs/' + path.resolve('lib/Modeler.js'), backgroundUrl: '/@fs/' + path.resolve('test/helpers/hover-background.mjs') });
    assert.deepEqual(warnings, [], engine + ' fixture warnings');
    return { page, errors, engine };
  } catch (error) { await page.close().catch(() => {}); throw error; }
}
async function settle(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function screen(page, point) { return page.evaluate(p => { const q = new DOMPoint(p.x, p.y).matrixTransform(window.hoverTest.matrix()); return { x: q.x, y: q.y }; }, point); }
async function hit(page, point) {
  return page.evaluate(p => {
    const e = document.elementFromPoint(p.x, p.y), r = window.hoverTest.container.getBoundingClientRect();
    return { id: e?.closest('[data-element-id]')?.getAttribute('data-element-id') || null, connectSource: e?.closest('.bpmn-xyflow-connect-handle')?.getAttribute('data-connect-source') || null, class: e?.getAttribute('class'), tag: e?.tagName, control: !!e?.closest('.djs-bendpoint,.djs-segment-dragger,.bpmn-xyflow-hover-bendpoint,.bpmn-xyflow-hover-segment,.bpmn-xyflow-bendpoint-hit,.bpmn-xyflow-bendpoint,.bpmn-xyflow-segment-handle'), inside: p.x >= r.left && p.x < Math.min(r.right, innerWidth) && p.y >= r.top && p.y < Math.min(r.bottom, innerHeight) };
  }, point);
}
async function state(page) {
  const raw = await page.evaluate(async () => { const t = window.hoverTest; return { xml: await t.xml(), preserveRawMarkers: t.engine === 'local' && t.xmlInput.includes('hover-owner-marker'), selection: t.selection(), history: t.history(), starts: t.starts, events: t.events, focusEvents: t.focusEvents, clickTrace: t.clickTrace, matrix: Object.fromEntries(['a','b','c','d','e','f'].map(k => [k,t.matrix()[k]])), input: t.lastInput }; });
  if (raw.preserveRawMarkers) {
    const processXML = raw.xml.match(/<(?:\w+:)?process\b[^>]*\bid="HoverProcess"[^>]*>([\s\S]*?)<\/(?:\w+:)?process>/)?.[1];
    const record = processXML?.match(/<(?:\w+:)?extensionElements\b[^>]*>\s*<v:record\b[^>]*>([\s\S]*?)<\/v:record>\s*<\/(?:\w+:)?extensionElements>/)?.[1];
    assert.equal(record, 'Hover <!-- hover-owner-marker -->controls<?hover preserve?>', 'complete mixed XML stays ordered inside HoverProcess extension record');
  }
  const parsed = await oracle.fromXML(raw.xml); assert.deepEqual(parsed.warnings, [], 'independent XML export warnings');
  const di = parsed.rootElement.diagrams.flatMap(d => d.plane.planeElement || []);
  return { ...raw, parsed, canonical: (await oracle.toXML(parsed.rootElement, { format: true })).xml,
    edges: Object.fromEntries(di.filter(d => d.waypoint).map(d => [d.bpmnElement.id, { type: d.bpmnElement.$type, source: d.bpmnElement.sourceRef?.id, target: d.bpmnElement.targetRef?.id, points: d.waypoint.map(xy) }])),
    shapes: Object.fromEntries(di.filter(d => d.bounds).map(d => [d.bpmnElement.id, { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height }])) };
}
function report(s) { const { parsed: _parsed, ...rest } = s; return rest; }
async function controls(page, id) {
  return page.evaluate(id => {
    const t = window.hoverTest, scope = t.container;
    const visible = e => !!e && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().width > 0;
    const root = t.engine === 'upstream' ? scope.querySelector('.djs-bendpoints[data-element-id="' + id + '"]') : scope.querySelector('.bpmn-xyflow-hover-controls[data-element-id="' + id + '"]');
    const hits = root ? [...root.querySelectorAll(t.engine === 'upstream' ? '.djs-bendpoint:not(.floating) circle.djs-hit' : '.bpmn-xyflow-hover-bendpoint-hit')] : [];
    const segments = root ? [...root.querySelectorAll(t.engine === 'upstream' ? '.djs-segment-dragger .djs-hit' : '.bpmn-xyflow-hover-segment-hit')] : [];
    const selected = t.engine === 'upstream' ? root?.classList.contains('selected') : !!scope.querySelector('.bpmn-xyflow-bendpoints [data-element-id="' + id + '"]');
    // A hovered reference segment stays interactive via :hover even after its
    // overlay clears the route marker and hides the other fixed bendpoints.
    return { visible: hits.some(visible) || segments.some(visible), bendpointsVisible: hits.filter(visible).length, segmentsVisible: segments.filter(visible).length, selected: !!selected, radii: hits.map(h => Number(h.getAttribute('r'))), count: hits.length, rootClass: root?.getAttribute('class') || null };
  }, id);
}
async function blank(page, click = false) {
  const background = await page.evaluate(collectHoverBackground), p = background.point;
  const before = click ? await page.evaluate(() => ({ selection: window.hoverTest.selection(), clicks: window.hoverTest.clickTrace.length })) : null;
  if (click) await page.mouse.click(p.x, p.y); else await page.mouse.move(p.x, p.y);
  await settle(page);
  if (click) {
    const outcome = await page.evaluate(() => { const t = window.hoverTest; return { engine: t.engine, selection: t.selection(), trace: t.clickTrace }; });
    if (outcome.selection.length) {
      const observed = outcome.trace.slice(before.clicks); assert.equal(outcome.engine, 'upstream'); assert.equal(observed.length, 1);
      assert.ok(background.rootIds.includes(observed[0].id)); assert.equal(observed[0].trusted, true); assert.equal(observed[0].trap, true, 'only the actual pinned one-shot ghost-click trap permits a second background click'); assert.equal(observed[0].afterTrap, false);
      assert.deepEqual(outcome.selection, before.selection, 'the trapped click cannot change selection');
      await page.mouse.click(p.x, p.y); await settle(page);
      const retried = await page.evaluate(() => window.hoverTest.clickTrace.at(-1)); assert.equal(retried.trusted, true); assert.equal(retried.trap, false); assert.equal(retried.afterTrap, true); assert.ok(background.rootIds.includes(retried.id));
    }
    assert.deepEqual(await page.evaluate(() => window.hoverTest.selection()), [], 'native background click actually deselects');
  }
  return p;
}
async function hover(page, id, position) {
  const prior = await page.evaluate(() => window.hoverTest.selection());
  await blank(page);
  const p = await screen(page, position); await page.mouse.move(p.x, p.y); await settle(page);
  const target = await hit(page, p); assert.ok(target.inside); assert.equal(target.id, id, 'hover begins on the actual route: ' + JSON.stringify(target));
  assert.ok((await controls(page, id)).visible, 'unselected route exposes its controls');
  assert.deepEqual(await page.evaluate(() => window.hoverTest.selection()), prior, 'hover must not select'); return p;
}
async function pointer(page, graphPoint, id) {
  const approach = await page.evaluate(({ graphPoint, id }) => {
    const points = window.hoverTest.node(id).waypoints, index = points.findIndex(p => p.x === graphPoint.x && p.y === graphPoint.y);
    if (index < 0) throw Error('Control approach requires an actual waypoint');
    const adjacent = points[index > 0 ? index - 1 : 1], dx = adjacent.x - graphPoint.x, dy = adjacent.y - graphPoint.y, length = Math.hypot(dx, dy);
    if (length <= 30) throw Error('Fixture needs an exposed route span before the control');
    return { x: graphPoint.x + dx * 15 / length, y: graphPoint.y + dy * 15 / length };
  }, { graphPoint, id });
  // Approach on the adjacent outer route span first. Jumping directly from a
  // hovered segment overlay to a hidden endpoint is a different native path.
  const lead = await screen(page, approach); await page.mouse.move(lead.x, lead.y); await settle(page);
  const leadHit = await hit(page, lead); assert.ok(leadHit.inside, 'control approach stays inside the visible canvas'); assert.equal(leadHit.id, id, 'native control approach stays on its owner route');
  const p = await screen(page, graphPoint); await page.mouse.move(p.x, p.y, { steps: 4 }); await settle(page);
  const target = await hit(page, p); assert.ok(target.inside, 'chosen control is inside the visible canvas'); assert.equal(target.id, id, 'chosen native control owner: ' + JSON.stringify(target)); assert.ok(target.control, 'native approach reaches an actual endpoint/bendpoint control'); return p;
}
async function resetEvents(page) { await page.evaluate(() => { window.hoverTest.starts = []; window.hoverTest.events = []; }); }
async function drag(page, from, to, { cancel = false, outback = false, inspect } = {}) {
  await resetEvents(page);
  try {
    await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 10 }); await settle(page);
    if (inspect) await inspect();
    if (outback) { await page.mouse.move(from.x, from.y, { steps: 10 }); await settle(page); }
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up(); await settle(page);
  } finally { await page.mouse.up().catch(() => {}); }
}
async function unchangedExcept(before, after, id, side) {
  assert.equal(after.input?.trusted, true, 'geometry follows real native pointer input');
  const next = await oracle.fromXML(after.xml), old = before.parsed;
  const findDi = (p, id) => p.rootElement.diagrams.flatMap(d => d.plane.planeElement).find(d => d.bpmnElement.id === id);
  findDi(next, id).waypoint = findDi(old, id).waypoint;
  if (side) {
    const key = side + 'Ref', list = side === 'source' ? 'outgoing' : 'incoming';
    const previousId = old.elementsById[id][key].id, nextId = next.elementsById[id][key].id;
    if (previousId !== nextId) {
      assert.ok(!(next.elementsById[previousId][list] || []).some(e => e.id === id));
      assert.ok((next.elementsById[nextId][list] || []).some(e => e.id === id));
      for (const endpoint of [previousId, nextId]) {
        const saved = old.elementsById[endpoint][list];
        if (saved) next.elementsById[endpoint][list] = saved.map(e => next.elementsById[e.id]); else delete next.elementsById[endpoint][list];
      }
      next.elementsById[id][key] = next.elementsById[previousId];
    }
  }
  assert.equal((await oracle.toXML(next.rootElement, { format: true })).xml, before.canonical, 'unrelated semantics, metadata, containment and DI remain unchanged');
}
async function history(page, before, after, { upstreamDelete = false } = {}) {
  const engine = await page.evaluate(() => window.hoverTest.engine);
  if (engine === 'local') assert.equal(after.history.size, before.history.size + 1, 'one native gesture creates one command');
  for (let i = 0; i < 2; i++) {
    if (engine === 'local') await page.click('#undo-btn'); else { await blank(page, true); await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control'); }
    await settle(page); const undone = await state(page);
    if (engine === 'upstream' && upstreamDelete) await assertUpstreamHoverDeleteUndo(before.xml, undone.xml);
    else assert.equal(undone.xml, before.xml, 'native Undo restores complete XML');
    if (engine === 'local') await page.click('#redo-btn'); else { await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.press('z'); await page.keyboard.up('Shift'); await page.keyboard.up('Control'); }
    await settle(page); assert.equal((await state(page)).xml, after.xml, 'native Redo restores complete XML');
  }
}
async function reopen(page, expected, { upstreamDelete = false } = {}) {
  const warnings = await page.evaluate(async xml => { const t = window.hoverTest, r = await t.m.importXML(xml); return r.warnings.map(w => w.message); }, expected.xml);
  assert.deepEqual(warnings, []); const reopened = await state(page);
  assert.deepEqual(reopened.edges, expected.edges); assert.deepEqual(reopened.shapes, expected.shapes);
  if (upstreamDelete && await page.evaluate(() => window.hoverTest.engine) === 'upstream') {
    await assertUpstreamHoverDeleteReopen(expected.xml, reopened.xml);
  } else assert.equal(reopened.canonical, expected.canonical, 'actual reimport preserves complete independently canonical model');
}
async function previewChanged(page, id, prior, kind) {
  const value = await page.evaluate(id => {
    const t = window.hoverTest, node = t.node(id), context = t.activeContext;
    const preview = context?.connectionPreviewGfx?.querySelector(':scope > path,:scope > polyline');
    const original = t.engine === 'upstream' ? t.m.get('elementRegistry').getGraphics(node).querySelector('.djs-visual > path,.djs-visual > polyline') : null;
    const dragger = context?.draggerGfx, center = dragger?.isConnected && new DOMPoint(0, 0).matrixTransform(dragger.getScreenCTM()).matrixTransform(t.matrix().inverse());
    return { engine: t.engine, points: node.waypoints.map(p => ({ x: p.x, y: p.y })), start: t.starts.at(-1), moves: t.events.filter(e => e.phase === 'move'),
      preview: preview?.isConnected ? preview.getAttribute('d') || preview.getAttribute('points') : null,
      original: original?.getAttribute('d'), dragger: center && { x: center.x, y: center.y } };
  }, id);
  if (value.engine === 'upstream') {
    assert.equal(value.start?.kind, kind, 'pinned gesture classification'); assert.equal(value.start.id, id);
    assert.ok(value.moves.some(e => e.kind === kind && e.id === id), 'fresh full-chain move event');
    if (kind === 'bendpoint.move') {
      // Pinned BendpointMovePreview draws a separate path. Its live model
      // route deliberately stays unchanged until the actual command commits.
      assert.ok(value.preview && value.dragger, 'connected native preview and drag handle are visible');
      assert.ok(value.original, 'original route geometry exists outside marker definitions');
      assert.notEqual(value.preview, value.original, 'rendered preview differs from the original route');
      assert.ok(prior.every(p => Math.hypot(p.x - value.dragger.x, p.y - value.dragger.y) > 1), 'active handle moved away from every original waypoint');
    } else assert.notDeepEqual(value.points, prior, 'reference segment preview updates the live route');
  } else assert.notDeepEqual(value.points, prior, 'local native gesture produces a route preview');
  return value;
}
async function selectedZoomChecks(page) {
  const checks = [], original = await state(page);
  const initialViewport = await page.evaluate(() => { const t = window.hoverTest; if (t.engine === 'local') return t.m.getViewport(); const v = t.m.get('canvas').viewbox(); return { x: v.x, y: v.y, width: v.width, height: v.height }; });
  for (const mode of ['ordinary', 'promoted']) {
    // Independent constructor setup: cumulative wheel zoom about a remote
    // blank point can otherwise move the next tested endpoint off canvas.
    await page.evaluate(async viewport => { const t = window.hoverTest; if (t.engine === 'local') await t.m.setViewport(viewport, { duration: 0 }); else t.m.get('canvas').viewbox(viewport); }, initialViewport);
    await blank(page, true);
    if (mode === 'ordinary') {
      // Fixture setup isolates the ordinary selected-control constructor from
      // hover promotion. The zoom and every tested edit remain native input.
      await page.evaluate(() => { const t = window.hoverTest; if (t.engine === 'local') t.m.select('FlowA'); else t.m.get('selection').select(t.node('FlowA')); });
    } else {
      const at = await hover(page, 'FlowA', { x: 445, y: 380 }); await page.mouse.click(at.x, at.y); await settle(page);
    }
    assert.deepEqual(await page.evaluate(() => window.hoverTest.selection()), ['FlowA']);
    const beforeZoom = await page.evaluate(() => {
      const t = window.hoverTest;
      t.selectedHitBeforeZoom = t.engine === 'local' ? t.container.querySelector('.bpmn-xyflow-bendpoint-hit[data-element-id="FlowA"][data-bend-index="0"]') : t.container.querySelector('.djs-bendpoints[data-element-id="FlowA"] > .djs-bendpoint:not(.floating) circle.djs-hit');
      if (!t.selectedHitBeforeZoom) throw Error('Selected endpoint hit is missing before zoom');
      return t.matrix().a;
    });
    await blank(page); await page.keyboard.down('Control');
    try { await page.mouse.wheel({ deltaY: -90 }); } finally { await page.keyboard.up('Control'); }
    await page.waitForFunction(z => Math.abs(window.hoverTest.matrix().a - z) > 1e-5, {}, beforeZoom); await settle(page);
    const geometry = await page.evaluate(() => {
      const t = window.hoverTest, hit = t.selectedHitBeforeZoom, box = hit.getBoundingClientRect(), ctm = hit.getScreenCTM(), zoom = ctm.a;
      const current = t.engine === 'local' ? t.container.querySelector('.bpmn-xyflow-bendpoint-hit[data-element-id="FlowA"][data-bend-index="0"]') : t.container.querySelector('.djs-bendpoints[data-element-id="FlowA"] > .djs-bendpoint:not(.floating) circle.djs-hit');
      const modelZoom = t.engine === 'local' ? t.m.getViewport().zoom : null;
      return { engine: t.engine, zoom, modelZoom,
        nativeScale: t.engine === 'local' ? t.m.getSvg().createSVGMatrix().scale(modelZoom).a : null,
        matrix: Object.fromEntries(['a','b','c','d','e','f'].map(key => [key, ctm[key]])),
        radius: Number(hit.getAttribute('r')), radiusValue: hit.r.baseVal.value, centerX: hit.cx.baseVal.value,
        width: box.width, same: current === hit, connected: hit.isConnected };
    });
    const numericBounds = assertSelectedZoomGeometry(geometry);
    const endpoint = await pointer(page, { x: 280, y: 240 }, 'FlowA'); assert.ok((await hit(page, endpoint)).control);
    const midpoint = await screen(page, { x: 525, y: 380 }); await page.mouse.move(midpoint.x, midpoint.y); await settle(page);
    const segment = await hit(page, midpoint); assert.ok(segment.inside, 'selected segment remains visible after native zoom'); assert.equal(segment.id, 'FlowA'); assert.ok(segment.control, 'selected segment hit remains reachable after zoom');
    const before = await state(page), destination = await screen(page, { x: 525, y: 450 });
    await drag(page, midpoint, destination, { cancel: true, inspect: () => previewChanged(page, 'FlowA', before.edges.FlowA.points, 'connectionSegment.move') });
    const cancelled = await state(page); assert.equal(cancelled.xml, original.xml); assert.deepEqual(cancelled.history, original.history);
    checks.push({ mode, ...geometry, numericBounds, segment });
  }
  return checks;
}

async function onlyFlowDeleted(before, after, id) {
  const expected = await oracle.fromXML(before.xml), flow = expected.elementsById[id]; assert.ok(flow);
  const owner = flow.$parent; assert.ok(owner.flowElements.includes(flow)); owner.flowElements = owner.flowElements.filter(e => e !== flow);
  for (const diagram of expected.rootElement.diagrams) diagram.plane.planeElement = diagram.plane.planeElement.filter(e => e.bpmnElement !== flow);
  for (const element of Object.values(expected.elementsById)) {
    for (const key of ['incoming', 'outgoing']) if (Object.hasOwn(element, key)) element[key] = element[key].filter(e => e !== flow);
    if (element.default === flow) delete element.default;
  }
  assert.equal(after.canonical, (await oracle.toXML(expected.rootElement, { format: true })).xml, 'Delete removes only its flow, DI and direct endpoint/default references');
}

async function evidence(page, name, detail) {
  const current = await state(page);
  const controlDOM = await page.evaluate(() => [...window.hoverTest.container.querySelectorAll('.djs-bendpoints,.bpmn-xyflow-hover-controls,.bpmn-xyflow-bendpoints')].map(e => e.outerHTML));
  await writeFile('test-artifacts/browser-hover-' + name + '.bpmn', current.xml);
  await writeFile('test-artifacts/browser-hover-' + name + '.json', JSON.stringify({ detail, state: report(current), controlDOM }, null, 2));
  await page.screenshot({ path: 'test-artifacts/browser-hover-' + name + '.png', fullPage: true });
}
async function paired(name, action, options = {}) {
  for (const engine of ['upstream', 'local']) {
    let context; const key = name + '-' + engine; console.log('START native hover ' + key);
    try {
      context = await setup(engine, options.fixture, options.zoom); const detail = await action(context.page, engine);
      assert.deepEqual(context.errors, []); await evidence(context.page, key, detail);
      const status = detail?.status === 'intentional-difference' ? 'intentional-difference' : 'passed';
      results.push({ name, engine, status, detail }); console.log((status === 'passed' ? 'PASS' : 'INTENTIONAL DIFFERENCE') + ' native hover ' + key);
    } catch (error) {
      results.push({ name, engine, status: 'failed', error: error.stack || String(error) }); console.error('FAIL native hover ' + key + ': ' + error.stack);
      if (context) await evidence(context.page, key + '-failure', { error: error.stack }).catch(() => {});
    } finally {
      await writeFile('test-artifacts/browser-hover-connections-results.json', JSON.stringify(results, null, 2));
      await context?.page.close().catch(() => {});
    }
  }
}

try {
  server = spawn(process.execPath, ['lib/demo/serve.mjs'], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore','pipe','inherit'] });
  server.stdout.on('data', chunk => { serverOutput += String(chunk); });
  const deadline = Date.now() + 60000;
  while (true) {
    const match = serverOutput.match(/demo listening on http:\/\/localhost:(\d+)/);
    if (match && Number(match[1]) !== port) throw Error('Owned hover server bound an unexpected port');
    if (match) try { if ((await fetch(base + '/modeler/', { signal: AbortSignal.timeout(5000) })).ok) break; } catch {}
    if (server.exitCode !== null || Date.now() > deadline) throw Error('Hover server startup timeout');
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  browser = await puppeteer.launch({ headless: 'shell', protocolTimeout: 30000 }); await mkdir('test-artifacts', { recursive: true });

  for (const zoom of [.5, 1.5]) await paired('hover-approach-radius-leave-' + zoom, async (page, engine) => {
    const before = await state(page); await blank(page); const inside = await screen(page, { x: 274, y: 244 });
    await page.mouse.move(inside.x, inside.y); await settle(page);
    const fresh = await hit(page, inside);
    if (engine === 'local' && zoom === .5) {
      assert.equal(fresh.id, null);
      assert.equal(fresh.connectSource, 'SourceA', 'low-zoom fresh approach reaches the source shape’s visible origin control');
      assert.equal(fresh.class, 'bpmn-xyflow-connect-hit');
    } else {
      assert.equal(fresh.id, 'SourceA', 'fresh shape-side approach reaches the source body');
      assert.equal(fresh.connectSource, null);
    }
    assert.equal(fresh.control, false, 'fresh shape-side approach has no edge endpoint/segment control');
    assert.equal((await controls(page, 'FlowA')).visible, false, 'fresh shape-side approach does not expose route controls');
    await hover(page, 'FlowA', { x: 295, y: 240 }); const first = await controls(page, 'FlowA');
    assert.equal(first.count, before.edges.FlowA.points.length); assert.ok(first.bendpointsVisible > 0, 'outer route approach exposes fixed endpoint controls'); assert.ok(first.radii.every(r => r === 10), 'hover radius uses graph units');
    await page.mouse.move(inside.x, inside.y); await settle(page); const inherited = await hit(page, inside);
    assert.equal(inherited.id, 'FlowA'); assert.ok(inherited.control, 'route-to-control approach retains the hover target');
    await blank(page); assert.equal((await controls(page, 'FlowA')).visible, false, 'leaving hides unselected controls');
    const after = await state(page); assert.equal(after.xml, before.xml); assert.deepEqual(after.history, before.history); assert.deepEqual(after.selection, []);
    const selectedZoom = await selectedZoomChecks(page);
    return { fresh, first, inherited, input: after.input, selectedZoom, status: 'intentional-difference', policy: 'Both hover radii use graph units; existing local selected hits retain 10 CSS-pixel radius while pinned selected hits retain 10 graph units.' };
  }, { zoom });

  for (const side of ['source','target']) await paired('unselected-' + side + '-reconnect', async page => {
    const before = await state(page), points = before.edges.FlowA.points, index = side === 'source' ? 0 : points.length - 1;
    await hover(page, 'FlowA', { x: 520, y: 380 }); const start = await pointer(page, points[index], 'FlowA'); assert.ok((await hit(page, start)).control);
    const desired = side === 'source' ? { x: 280, y: 80 } : { x: 940, y: 400 }, endpoint = side === 'source' ? 'SpareSource' : 'SpareTarget', end = await screen(page, desired);
    assert.equal((await hit(page, end)).id, endpoint);
    await drag(page, start, end, { inspect: () => previewChanged(page, 'FlowA', points, 'bendpoint.move') });
    const after = await state(page); assert.equal(after.edges.FlowA[side], endpoint); near(after.edges.FlowA.points[side === 'source' ? 0 : after.edges.FlowA.points.length - 1], desired, 'chosen perimeter docking');
    near(after.edges.FlowA.points[side === 'source' ? after.edges.FlowA.points.length - 1 : 0], points[side === 'source' ? points.length - 1 : 0], 'opposite anchor remains exact');
    await unchangedExcept(before, after, 'FlowA', side); await history(page, before, after); await reopen(page, after); return { endpoint, input: after.input };
  });

  await paired('unselected-existing-bend-move', async page => {
    const before = await state(page), points = before.edges.FlowA.points; await hover(page, 'FlowA', { x: 520, y: 380 });
    const start = await pointer(page, points[2], 'FlowA'), end = await screen(page, { x: 470, y: 410 });
    await drag(page, start, end, { inspect: () => previewChanged(page, 'FlowA', points, 'bendpoint.move') });
    const after = await state(page); assert.equal(after.edges.FlowA.points.length, points.length); near(after.edges.FlowA.points[2], { x: 470, y: 410 }, 'existing bend follows delivered integer position');
    assert.deepEqual(after.edges.FlowA.points.filter((_, i) => i !== 2), points.filter((_, i) => i !== 2));
    await unchangedExcept(before, after, 'FlowA'); await history(page, before, after); await reopen(page, after);
  });
  await paired('unselected-existing-bend-double-click', async (page, engine) => {
    const before = await state(page); await hover(page, 'FlowA', { x: 520, y: 380 }); const p = await pointer(page, before.edges.FlowA.points[2], 'FlowA');
    await page.mouse.click(p.x, p.y, { count: 2, delay: 70 }); await settle(page);
    if (engine === 'upstream') {
      // Pinned Bendpoints forwards double-click to LabelEditingProvider. Bend
      // deletion is an existing local shortcut, not a shared native behavior.
      await page.waitForSelector('.djs-direct-editing-content[contenteditable="true"]', { visible: true });
      assert.equal(await page.evaluate(() => window.hoverTest.m.get('directEditing').isActive()), true);
      await page.keyboard.press('Escape'); await settle(page); const after = await state(page);
      assert.equal(after.xml, before.xml); assert.deepEqual(after.history, before.history);
      return { status: 'intentional-difference', policy: 'Pinned double-click opens the flow-label editor; Escape cancels without history.' };
    }
    const after = await state(page); assert.equal(after.edges.FlowA.points.length, before.edges.FlowA.points.length - 1);
    await unchangedExcept(before, after, 'FlowA'); await history(page, before, after); await reopen(page, after);
    return { status: 'intentional-difference', policy: 'Existing local double-click shortcut removes the chosen bend in one command.' };
  });

  for (const kind of ['central', 'outer', 'diagonal']) await paired('native-activation-' + kind, async page => {
    const id = kind === 'diagonal' ? 'FlowA' : 'FlowB', fromGraph = kind === 'diagonal' ? { x: 490, y: 400 } : { x: kind === 'central' ? 490 : 320, y: 560 };
    const before = await state(page); const start = await hover(page, id, fromGraph), end = await screen(page, { x: fromGraph.x, y: fromGraph.y + 70 });
    await drag(page, start, end, { inspect: () => previewChanged(page, id, before.edges[id].points, kind === 'central' ? 'connectionSegment.move' : 'bendpoint.move') });
    const after = await state(page), points = after.edges[id].points;
    if (kind === 'central') { assert.ok(points.length >= 4); assert.ok(points.every((p, i) => !i || Math.abs(p.x - points[i - 1].x) < .01 || Math.abs(p.y - points[i - 1].y) < .01), 'middle-region drag slides an orthogonal segment'); assert.ok(points.some(p => p.y === 630)); }
    else { assert.equal(points.length, 3, 'outer/diagonal region inserts exactly one bend'); near(points[1], { x: fromGraph.x, y: fromGraph.y + 70 }, 'inserted bend follows native pointer'); }
    await unchangedExcept(before, after, id); await history(page, before, after); await reopen(page, after); return { points, activation: after.starts };
  }, { fixture: kind === 'diagonal' ? 'diagonal' : 'orthogonal' });

  await paired('click-and-subthreshold-jitter', async page => {
    const original = await state(page); const outcomes = [];
    for (const dx of [0, 4, 5]) {
      await blank(page, true); const start = await hover(page, 'FlowA', { x: 520, y: 380 }); await resetEvents(page);
      await page.mouse.down(); if (dx) await page.mouse.move(start.x + dx, start.y); await settle(page);
      const pending = await state(page); assert.equal(pending.xml, original.xml); assert.equal(pending.starts.length, 0, 'drag requires more than five CSS pixels');
      await page.mouse.up(); await settle(page); const after = await state(page); assert.equal(after.xml, original.xml); assert.deepEqual(after.history, original.history); assert.deepEqual(after.selection, ['FlowA']); outcomes.push({ dx, input: after.input });
    }
    return outcomes;
  });

  await paired('activated-cancel-and-outback', async (page, engine) => {
    const before = await state(page), outcomes = [];
    for (const mode of ['cancel', 'outback']) {
      await blank(page, true); await hover(page, 'FlowA', { x: 520, y: 380 }); const start = await pointer(page, before.edges.FlowA.points[2], 'FlowA');
      await drag(page, start, { x: start.x + 40, y: start.y + 30 }, { cancel: mode === 'cancel', outback: mode === 'outback', inspect: () => previewChanged(page, 'FlowA', before.edges.FlowA.points, 'bendpoint.move') });
      const after = await state(page); assert.equal(after.xml, before.xml, 'cancel/net-zero movement preserves complete XML');
      if (engine === 'local' || mode === 'cancel') assert.deepEqual(after.history, before.history);
      else assert.deepEqual(after.history, { undo: true, redo: false, index: before.history.index + 2 }, 'pinned full-service net-zero edit records updateWaypoints and group.updateRefs');
      outcomes.push({ mode, historyBefore: before.history, historyAfter: after.history, activation: after.starts });
    }
    const referenceNoopCommand = engine === 'upstream' && outcomes.some(o => JSON.stringify(o.historyAfter) !== JSON.stringify(o.historyBefore));
    return { outcomes, ...(referenceNoopCommand ? { status: 'intentional-difference', policy: 'Pinned net-zero drag may create history; local requires no command with exact unchanged XML.' } : {}) };
  });

  await paired('booking-fresh-versus-route-hover', async page => {
    const before = await state(page); await blank(page); const p = await screen(page, { x: 479, y: 260 });
    await page.mouse.move(p.x, p.y); await settle(page); const fresh = await hit(page, p); assert.equal(fresh.id, 'FlightTimeout');
    await hover(page, 'ReservationFlow2', { x: 490, y: 260 }); await page.mouse.move(p.x, p.y); await settle(page);
    const inherited = await hit(page, p); assert.equal(inherited.id, 'ReservationFlow2'); assert.ok(inherited.control);
    await page.mouse.click(p.x, p.y); await settle(page); const after = await state(page); assert.deepEqual(after.selection, ['ReservationFlow2']); assert.equal(after.xml, before.xml); assert.deepEqual(after.history, before.history); return { fresh, inherited, input: after.input };
  }, { fixture: 'booking', zoom: .9 });

  await paired('selected-A-hovered-B', async page => {
    const before = await state(page); const a = await hover(page, 'FlowA', { x: 520, y: 380 }); await page.mouse.click(a.x, a.y); await settle(page);
    assert.deepEqual(await page.evaluate(() => window.hoverTest.selection()), ['FlowA']);
    await hover(page, 'FlowB', { x: 490, y: 560 }); assert.equal((await controls(page, 'FlowA')).selected, true);
    const start = await pointer(page, before.edges.FlowB.points[0], 'FlowB'), end = await screen(page, { x: 280, y: 80 });
    await drag(page, start, end, { inspect: () => previewChanged(page, 'FlowB', before.edges.FlowB.points, 'bendpoint.move') });
    const after = await state(page); assert.deepEqual(after.edges.FlowA, before.edges.FlowA); assert.equal(after.edges.FlowB.source, 'SpareSource'); assert.deepEqual(after.selection, ['FlowA'], 'dragging hovered B restores the prior selected A');
    await unchangedExcept(before, after, 'FlowB', 'source'); await history(page, before, after); await reopen(page, after);
  });

  await paired('delete-undo-import-control-lifecycle', async (page, engine) => {
    const before = await state(page), p = await hover(page, 'FlowA', { x: 520, y: 380 }); await page.mouse.click(p.x, p.y); await page.keyboard.press('Delete'); await settle(page);
    const deleted = await state(page); assert.equal(deleted.edges.FlowA, undefined); assert.equal((await controls(page, 'FlowA')).visible, false); await onlyFlowDeleted(before, deleted, 'FlowA');
    await history(page, before, deleted, { upstreamDelete: true });
    if (engine === 'local') await page.click('#undo-btn'); else { await blank(page, true); await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control'); }
    await settle(page); const restored = await state(page);
    if (engine === 'upstream') await assertUpstreamHoverDeleteUndo(before.xml, restored.xml); else assert.equal(restored.xml, before.xml);
    await blank(page, true); await hover(page, 'FlowA', { x: 520, y: 380 });
    await reopen(page, restored, { upstreamDelete: true }); await blank(page); assert.equal((await controls(page, 'FlowA')).visible, false, 'import clears previous hover controls');
    // Re-establish the view after import, then prove fresh controls act on the
    // new graph object instead of the removed prior instance.
    await page.evaluate(() => { const t = window.hoverTest; window.hoverTest = window.makeHoverAdapter(t.m, t.container, 1); });
    await hover(page, 'FlowA', { x: 520, y: 380 }); assert.deepEqual((await state(page)).selection, []);
    return engine === 'upstream' ? { status: 'intentional-difference', policy: 'Pinned Delete Undo reinserts FlowA after FlowB in semantic containment; its subsequent reimport orders their two DI entries accordingly. Exact fixture-scoped oracles preserve every other field and geometry.' } : { exactHistory: true };
  });

  await paired('pending-and-active-blur', async (page, engine) => {
    const before = await state(page);
    for (const active of [false, true]) {
      await blank(page, true); await hover(page, 'FlowA', { x: 520, y: 380 }); const p = await pointer(page, before.edges.FlowA.points[2], 'FlowA');
      await page.mouse.down(); if (active) { await page.mouse.move(p.x + 40, p.y + 30, { steps: 6 }); await settle(page); await previewChanged(page, 'FlowA', before.edges.FlowA.points, 'bendpoint.move'); }
      const blurBefore = await page.evaluate(() => window.hoverTest.focusEvents.filter(e => e.type === 'blur').length);
      const other = await browser.newPage(); await other.bringToFront(); await other.goto('about:blank'); await page.bringToFront(); await other.close();
      const observedBlur = await page.evaluate(n => window.hoverTest.focusEvents.filter(e => e.type === 'blur').slice(n), blurBefore);
      assert.ok(observedBlur.some(e => e.trusted), 'tab switch must deliver a trusted window blur');
      await page.mouse.up(); await settle(page); const after = await state(page);
      if (engine === 'local' || !active) { assert.equal(after.xml, before.xml, 'local blur cancels; unactivated reference input cannot mutate'); assert.deepEqual(after.history, before.history); }
      else {
        // Pinned Dragging does not bind window blur. Its activated preview
        // remains pending until the returning mouseup, which commits it.
        assert.notEqual(after.xml, before.xml); near(after.edges.FlowA.points[2], { x: 470, y: 410 }, 'reference commits its last active preview');
        await unchangedExcept(before, after, 'FlowA'); await history(page, before, after);
      }
    }
    return { status: 'intentional-difference', policy: engine === 'local' ? 'Local window blur cancels pending and activated hover edits.' : 'Pinned Dragging does not cancel on window blur; returning mouseup commits an activated preview.' };
  });

  await paired('two-instance-destroy-isolation', async (page, engine) => {
    await page.evaluate(async () => {
      const prior = window.hoverTest; prior.m.destroy(); prior.container.remove();
      const Local = prior.engine === 'local' ? (await import(prior.modelerUrl)).default : null;
      window.hoverInstances = [];
      for (const left of [20, 900]) {
        const container = document.createElement('div'); Object.assign(container.style, { position: 'fixed', left: left + 'px', top: '100px', width: '820px', height: '850px', border: '1px solid #888' }); document.body.appendChild(container);
        const m = Local ? new Local({ container }) : new window.BpmnJS({ container }); const result = await m.importXML(prior.xmlInput); if (result.warnings.length) throw Error('Secondary import warnings');
        window.hoverInstances.push(window.makeHoverAdapter(m, container, .6));
      }
      window.hoverTest = window.hoverInstances[0];
    });
    const before = await state(page); await hover(page, 'FlowA', { x: 520, y: 380 });
    const secondBefore = await page.evaluate(async () => window.hoverInstances[1].xml());
    await page.evaluate(() => { window.hoverTest = window.hoverInstances[1]; }); assert.equal((await controls(page, 'FlowA')).visible, false);
    await hover(page, 'FlowA', { x: 520, y: 380 }); assert.equal((await state(page)).xml, secondBefore);
    const firstAfter = await page.evaluate(async () => { const t = window.hoverInstances[0]; return { xml: await t.xml(), history: t.history(), selection: t.selection() }; });
    assert.equal(firstAfter.xml, before.xml); assert.deepEqual(firstAfter.history, before.history); assert.deepEqual(firstAfter.selection, []);
    await page.evaluate(() => { window.hoverInstances[0].m.destroy(); }); await pointer(page, { x: 280, y: 240 }, 'FlowA');
    assert.ok((await controls(page, 'FlowA')).visible); assert.equal((await state(page)).xml, secondBefore);
    const firstCleared = await page.evaluate(() => !window.hoverInstances[0].container.querySelector('.bpmn-xyflow-hover-controls,.djs-bendpoints'));
    assert.ok(firstCleared); return { engine, firstXmlLength: before.xml.length, secondXmlLength: secondBefore.length };
  });

  assert.equal(results.length, 32, 'all sixteen paired groups ran');
  const failed = results.filter(result => result.status === 'failed'); assert.equal(failed.length, 0, failed.map(r => r.name + '/' + r.engine + ': ' + r.error).join('\n'));
  console.log('PASS native hover: 16 paired groups / 32 engine cases');
} finally {
  try { await browser?.close(); }
  finally {
    if (server && server.exitCode === null && server.signalCode === null) {
      const exited = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM');
      const timeout = new Promise(resolve => { const timer = setTimeout(resolve, 3000); timer.unref(); });
      await Promise.race([exited, timeout]);
      if (server.exitCode === null && server.signalCode === null) { server.kill('SIGKILL'); await exited; }
    }
  }
}
