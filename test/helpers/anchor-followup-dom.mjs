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
