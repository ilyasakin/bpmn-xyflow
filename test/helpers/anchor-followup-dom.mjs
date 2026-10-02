import assert from 'node:assert/strict';

// Serialized into the page. DI coordinates are in the active graph, whose
// native matrix has greater precision than Canvas.viewbox()'s rounded values.
export function collectRenderedDI({ id, points }) {
  const container = document.querySelector('#viewer');
  const root = [...container.querySelectorAll('[data-element-id]')].find(e => e.getAttribute('data-element-id') === id && e.querySelector('.bpmn-xyflow-connection-visual,.djs-visual'));
  const path = root?.querySelector('.bpmn-xyflow-connection-visual,.djs-visual > path,.djs-visual > polyline');
  const viewport = container.querySelector('.bpmn-xyflow-viewport,.viewport');
  if (!path?.getTotalLength || !viewport) throw Error(`Missing actual rendered connection ${id}`);
  const actualMatrix = path.getScreenCTM(), graphMatrix = viewport.getScreenCTM();
  const xy = p => ({ x: p.x, y: p.y });
  return {
    id, points, matrix: Object.fromEntries(['a','b','c','d','e','f'].map(k => [k, graphMatrix[k]])),
    actual: { start: xy(path.getPointAtLength(0).matrixTransform(actualMatrix)), end: xy(path.getPointAtLength(path.getTotalLength()).matrixTransform(actualMatrix)) },
  };
}

export function assertRenderedDI(evidence) {
  assert.ok(evidence.points.length >= 2);
  for (const value of Object.values(evidence.matrix)) assert.ok(Number.isFinite(value));
  assert.notEqual(evidence.matrix.a * evidence.matrix.d - evidence.matrix.b * evidence.matrix.c, 0);
  const {a,b,c,d,e,f}=evidence.matrix;
  const project=p=>({x:a*p.x+c*p.y+e,y:b*p.x+d*p.y+f});
  const expectedPoints={start:project(evidence.points[0]),end:project(evidence.points.at(-1))};
  for (const side of ['start','end']) {
    const actual = evidence.actual[side], expected = expectedPoints[side];
    assert.ok([actual.x, actual.y, expected.x, expected.y].every(Number.isFinite));
    assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y) <= .05,
      `${evidence.id} ${side} paint must match saved DI through its actual SVG CTM: ${JSON.stringify({actual,expected})}`);
  }
  return { ...evidence.actual, evidence: {...evidence,expected:expectedPoints} };
}

export async function renderedDI(page, edge) {
  return assertRenderedDI(await page.evaluate(collectRenderedDI, { id: edge.id, points: edge.points }));
}

// A connection may cover the geometric center. Select a verified visible
// interior of the intended shape through real input, without API selection.
export async function selectVisibleFollowupBody(h, page, id) {
  const before = await h.state(page);
  if (before.selection.length === 1 && before.selection[0] === id) return;
  const node = h.node(before, id), attempts = [];
  for (const [fx, fy] of [[.5,.5],[.3,.5],[.7,.5],[.5,.3],[.5,.7],[.3,.3],[.7,.7]]) {
    const point = h.screen(before, { x: node.x + node.width * fx, y: node.y + node.height * fy });
    await page.mouse.move(point.x, point.y); await h.settle(page);
    const hit = await h.hit(page, point); attempts.push({ point, hit });
    if (!hit.inside || hit.id !== id) continue;
    await page.mouse.click(point.x, point.y); await h.settle(page);
    assert.deepEqual((await h.raw(page)).selection, [id], 'native body click selects the exact intended source');
    await h.noChange(page, before, 'visible body selection preserves XML/history');
    return { point, attempts };
  }
  throw Error(`No unobstructed visible body point for ${id}: ${JSON.stringify(attempts)}`);
}

// Serialized read only. The exact F11 resting overlay is the selected source's
// Replace entry; actual Connect activation must remove it before the drop.
export function collectReferenceOutlineChrome({ source, point }) {
  const container = document.querySelector('#viewer'), top = document.elementFromPoint(point.x, point.y),
    entry = top?.closest('.entry[data-action]'), pad = entry?.closest('.djs-context-pad.open'),
    pads = [...container.querySelectorAll('.djs-context-pad.open')],
    modeler = window.referenceModeler, sourceElement = modeler.get('elementRegistry').get(source);
  const rect = e => { const r = e?.getBoundingClientRect(); return r && { left:r.left, top:r.top, right:r.right, bottom:r.bottom }; };
  return { source, point, action: entry?.getAttribute('data-action'), topClass: top?.getAttribute('class'),
    ownOpenPad: !!sourceElement && !!pad && pads.length === 1 && pads[0] === pad && modeler.get('contextPad').isOpen(sourceElement),
    entryBounds: rect(entry), padBounds: rect(pad) };
}

export function assertReferenceOutlineRestingHit(hit, chrome, target) {
  assert.equal(hit.inside, true);
  assert.ok(hit.owners.includes(target), 'the unchanged target outline remains underneath any resting chrome');
  if (hit.id === target) return;
  assert.equal(chrome.ownOpenPad, true, 'only the actual selected source context pad may cover this resting point');
  assert.equal(chrome.action, 'replace', 'exact measured F11 overlay');
  assert.equal(chrome.topClass, 'entry bpmn-icon-screw-wrench');
  for (const rect of [chrome.entryBounds, chrome.padBounds]) {
    assert.ok(rect && Object.values(rect).every(Number.isFinite));
    assert.ok(rect.right > rect.left && rect.bottom > rect.top);
    assert.ok(chrome.point.x >= rect.left && chrome.point.x < rect.right && chrome.point.y >= rect.top && chrome.point.y < rect.bottom);
  }
}

// A selected target's resize controls may cover its intended outline. Prepare
// the actual source by visible input first; keep the requested drop unchanged.
export async function prepareReferenceOutlineTarget(h, page, { source, target, point }, onEvidence = async () => {}) {
  const before = await h.state(page), beforeHit = await h.hit(page, point);
  assert.equal(before.engine, 'upstream');
  assert.deepEqual(before.selection, [target]);
  await selectVisibleFollowupBody(h, page, source);
  const after = await h.state(page), afterHit = await h.hit(page, point);
  const chrome = await page.evaluate(collectReferenceOutlineChrome, { source, point });
  const evidence = { source, target, point, beforeHit, afterHit, chrome, beforeSelection: before.selection, afterSelection: after.selection };
  await onEvidence(evidence);
  assert.deepEqual(after.selection, [source]);
  assert.equal(after.xml, before.xml, 'source selection preserves the complete document');
  assert.deepEqual(after.history, before.history, 'source selection adds no history');
  assert.deepEqual(after.viewport, before.viewport, 'source selection preserves the requested screen point');
  assertReferenceOutlineRestingHit(afterHit, chrome, target);
  return evidence;
}

/** Only adjacent, representable CSS pixels may replace the intended reference drop. */
export function adjacentDropPixels(point) {
  assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
  return [...new Set([Math.floor(point.x),Math.ceil(point.x)])].flatMap(x =>
    [...new Set([Math.floor(point.y),Math.ceil(point.y)])].map(y => ({x,y})))
    .sort((a,b) => Math.hypot(a.x-point.x,a.y-point.y)-Math.hypot(b.x-point.x,b.y-point.y));
}

export async function chooseAdjacentReferenceDrop(h, page, id, point) {
  const originalHit = await h.hit(page, point), candidates = [];
  for (const candidate of adjacentDropPixels(point)) candidates.push({point:candidate,hit:await h.hit(page,candidate)});
  const chosen = candidates.find(candidate => candidate.hit.inside && candidate.hit.id === id);
  assert.ok(chosen, `No adjacent native pixel belongs to ${id}: ${JSON.stringify({point,candidates})}`);
  return {original:point,originalHit,candidates,point:chosen.point};
}

export async function clickReferenceSubprocessReplacement(h, page, action, onEvidence = async () => {}) {
  // The installed popup filters on keyup, not on the input event alone.
  const selector = '.djs-popup-search input', search = await page.$(selector);
  let evidence = { searchable: !!search, action };
  if (search) {
    await h.clickButton(page, selector);
    await page.$eval(selector, e => {
      e.__anchorPopupKeys = [];
      e.__anchorPopupKeyup = event => { e.__anchorPopupKeys.push({ trusted: event.isTrusted, target: event.target === e, key: event.key, value: e.value }); };
      e.addEventListener('keyup', e.__anchorPopupKeyup);
    });
    try {
      await page.keyboard.type('Sub-process');
      assert.equal(await page.$eval(selector, e => e.value), 'Sub-process');
      await h.settle(page);
      const keys = await page.$eval(selector, e => e.__anchorPopupKeys);
      assert.ok(keys.length > 0 && keys.every(e => e.trusted && e.target), 'search receives actual trusted keyup events');
      assert.equal(keys.at(-1).value, 'Sub-process');
      const entries = await page.$$eval('.djs-popup-body .entry', rows => rows.map(e => e.getAttribute('data-id')));
      assert.ok(entries.includes(action), 'filtered popup exposes the exact desired action');
      assert.ok(!entries.includes('replace-with-task'), 'search has actually filtered the former Task list');
      evidence = { ...evidence, keys, entries };
    } finally {
      await page.$eval(selector, e => {
        e.removeEventListener('keyup', e.__anchorPopupKeyup);
        delete e.__anchorPopupKeyup; delete e.__anchorPopupKeys;
      });
    }
  }
  await onEvidence(evidence);
  await h.clickButton(page, `.djs-popup [data-id="${action}"]`);
  return evidence;
}

/** Serialized DOM read: choose the actual visible lane outline above palette chrome. */
export function collectReferenceLaneTop({ id, width, height }) {
  const gfx = [...document.querySelectorAll('#viewer .djs-element[data-element-id]')].find(e => e.getAttribute('data-element-id') === id);
  const hit = gfx?.querySelector(':scope > .djs-hit-click-stroke');
  if (!gfx || !hit) throw Error(`Missing reference lane stroke ${id}`);
  const rect = Object.fromEntries(['x','y','width','height'].map(k => [k, Number(hit.getAttribute(k) || 0)]));
  if (rect.x !== 0 || rect.y !== 0 || rect.width !== width || rect.height !== height) throw Error('Reference lane hit must match its current bounds');
  const m = gfx.getScreenCTM(), matrix = Object.fromEntries(['a','b','c','d','e','f'].map(k => [k,m[k]]));
  if (!Object.values(matrix).every(Number.isFinite) || !Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0 || m.a*m.d-m.b*m.c === 0) throw Error('Invalid reference lane matrix/bounds');
  const requested = { x: m.a * width / 2 + m.e, y: m.b * width / 2 + m.f };
  return { id, rect, matrix, requested, point: { x: Math.round(requested.x), y: Math.round(requested.y) } };
}
