import assert from 'node:assert/strict';
import { projectRoundedTask } from './anchor-ownership-browser.mjs';

/** Browser-serializable, passive observer. No model calls or layout reads here. */
export function installPreviewMotionObserver({ owner, capacity = 4000 }) {
  if (window.previewMotionObserver) throw Error('Motion observer already installed');
  if (!owner || !Number.isInteger(capacity) || capacity < 20) throw Error('Invalid motion observer configuration');
  const root = document.querySelector('#viewer');
  if (!root) throw Error('Visible editor is missing');
  const runs = [], errors = [], longTasks = [];
  let active = null, latest = null, raf = null, stopped = false, sequence = 0;
  const attr = (e, name) => e?.hasAttribute(name) ? Number(e.getAttribute(name)) : null;
  const point = (e) => e ? { x: attr(e, 'cx'), y: attr(e, 'cy') } : null;
  const snapshot = () => {
    const started = performance.now();
    const handles = [...root.querySelectorAll('.bpmn-xyflow-connect-handle')];
    const handle = handles.find(e => e.getAttribute('data-connect-source') === owner);
    const docking = [...root.querySelectorAll('.bpmn-xyflow-connect-docking')].find(e => e.getAttribute('data-connect-source') === owner);
    const marker = docking?.querySelector('.bpmn-xyflow-connect-docking-point');
    const grab = handle?.querySelector('.bpmn-xyflow-connect-port');
    const tether = docking?.querySelector('.bpmn-xyflow-connect-tether');
    const value = { owners: handles.map(e => e.getAttribute('data-connect-source')),
      marker: point(marker), grab: point(grab), dockingVisibility: docking?.getAttribute('visibility'),
      tether: tether ? { x1: attr(tether, 'x1'), y1: attr(tether, 'y1'), x2: attr(tether, 'x2'), y2: attr(tether, 'y2') } : null,
      outline: root.querySelector('.bpmn-xyflow-connect-outline')?.getAttribute('d') || null };
    value.readCostMs = performance.now() - started;
    return value;
  };
  const safe = (fn) => { try { fn(); } catch (e) { errors.push(String(e?.stack || e)); } };
  const add = (list, entry) => { if (list.length >= capacity) { active.dropped++; return; } list.push(entry); };
  const onPointer = (e) => { if (!active) return; safe(() => {
    const coalesced = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    add(active.pointers, { sequence: ++sequence, at: performance.now(), timeStamp: e.timeStamp,
      trusted: e.isTrusted === true, x: e.clientX, y: e.clientY, pointerType: e.pointerType,
      targetClass: e.target?.getAttribute?.('class') || null,
      coalesced: coalesced.map(c => ({ x: c.clientX, y: c.clientY, timeStamp: c.timeStamp })) });
  }); };
  // Installed after the app's window capture onMouseMove. Its completed DOM is
  // observed here; pointer capture above is deliberately not called post-handler.
  const onMouse = (e) => { if (!active) return; safe(() => {
    const at = performance.now();
    latest = { sequence: ++sequence, at, timeStamp: e.timeStamp, trusted: e.isTrusted === true,
      x: e.clientX, y: e.clientY, buttons: e.buttons,
      targetClass: e.target?.getAttribute?.('class') || null,
      targetOwner: e.target?.closest?.('[data-element-id]')?.getAttribute('data-element-id') || null,
      connectOwner: e.target?.closest?.('.bpmn-xyflow-connect-handle')?.getAttribute('data-connect-source') || null,
      dom: snapshot() };
    latest.observedAt = performance.now(); add(active.events, latest);
  }); };
  const frame = (timestamp) => {
    if (stopped) return;
    if (active && latest) safe(() => add(active.frames, { sequence: ++sequence, at: performance.now(), timestamp,
      latestSequence: latest.sequence, latestDeliveredAt: latest.at, dom: snapshot() }));
    raf = requestAnimationFrame(frame);
  };
  window.addEventListener('pointermove', onPointer, { capture: true, passive: true });
  window.addEventListener('mousemove', onMouse, { capture: true, passive: true });
  let observer = null;
  const recordLongTasks = entries => {
    for (const e of entries) longTasks.push({ startTime: e.startTime, duration: e.duration, name: e.name });
  };
  const longTaskSupported = typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask');
  if (longTaskSupported) {
    observer = new PerformanceObserver(list => { safe(() => {
      recordLongTasks(list.getEntries());
    }); });
    observer.observe({ type: 'longtask', buffered: false });
  }
  raf = requestAnimationFrame(frame);
  window.previewMotionObserver = {
    begin(label) {
      if (stopped || active || !label) throw Error('Invalid motion phase');
      latest = null; active = { label, start: performance.now(), events: [], pointers: [], frames: [], dropped: 0 };
      runs.push(active);
    },
    end() { if (!active) throw Error('No active motion phase'); active.end = performance.now(); active = null; latest = null; },
    read() { return { owner, timeOrigin: performance.timeOrigin, longTaskSupported: !!longTaskSupported,
      runs, longTasks, errors, stopped }; },
    stop() {
      stopped = true; cancelAnimationFrame(raf);
      if (observer) { safe(() => recordLongTasks(observer.takeRecords())); observer.disconnect(); }
      window.removeEventListener('pointermove', onPointer, true); window.removeEventListener('mousemove', onMouse, true);
      if (active) { active.end = performance.now(); active = null; }
    }
  };
  return { timeOrigin: performance.timeOrigin, installedAt: performance.now(), longTaskSupported: !!longTaskSupported };
}

/** Style/layout evidence belongs outside the critical native motion loop. */
export function collectPreviewMotionStyles(owner) {
  const root = document.querySelector('#viewer');
  const serialize = value => value === undefined ? null : JSON.parse(JSON.stringify(value,
    (_key, item) => typeof item === 'number' && !Number.isFinite(item) ? String(item) : item));
  const selectors = ['.bpmn-xyflow-connect-handle', '.bpmn-xyflow-connect-port', '.bpmn-xyflow-connect-docking',
    '.bpmn-xyflow-connect-docking-point', '.bpmn-xyflow-connect-tether', '.bpmn-xyflow-connect-outline'];
  return { at: performance.now(), owner, dpr: devicePixelRatio,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    viewport: { width: innerWidth, height: innerHeight },
    elements: selectors.map(selector => {
      const e = root.querySelector(selector); if (!e) return { selector, missing: true };
      const s = getComputedStyle(e), box = e.getBoundingClientRect();
      return { selector, owner: e.closest('[data-connect-source]')?.getAttribute('data-connect-source') || null,
        display: s.display, visibility: s.visibility, opacity: s.opacity, transform: s.transform,
        computedCx: s.getPropertyValue('cx'), computedCy: s.getPropertyValue('cy'), computedRadius: s.getPropertyValue('r'),
        transitionProperty: s.transitionProperty, transitionDuration: s.transitionDuration, transitionDelay: s.transitionDelay,
        animationName: s.animationName, animationDuration: s.animationDuration, animationDelay: s.animationDelay,
        box: { x: box.x, y: box.y, width: box.width, height: box.height },
        animations: typeof e.getAnimations === 'function' ? e.getAnimations().map(a => ({
          playState: a.playState, currentTime: a.currentTime,
          timing: serialize(a.effect?.getComputedTiming?.()), keyframes: serialize(a.effect?.getKeyframes?.())
        })) : [] };
    }) };
}

export function motionExpectedMarker(shape, point, gatewayPolicy = 'continuous') {
  assert.ok(['continuous', 'vertices'].includes(gatewayPolicy));
  const { x, y, width, height, type } = shape, cx = x + width / 2, cy = y + height / 2;
  if (type.endsWith('Event')) {
    const dx = point.x - cx, dy = point.y - cy, length = Math.hypot(dx, dy);
    assert.ok(length > 0); return { x: cx + dx / length * width / 2, y: cy + dy / length * width / 2 };
  }
  if (!type.endsWith('Gateway')) return projectRoundedTask(shape, Math.min(10, width / 2, height / 2), point);
  const vertices = [{ x: cx, y }, { x: x + width, y: cy }, { x: cx, y: y + height }, { x, y: cy }];
  const candidates = gatewayPolicy === 'vertices' ? vertices : vertices.map((a, i) => {
    const b = vertices[(i + 1) % vertices.length], dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
    return { x: a.x + t * dx, y: a.y + t * dy };
  });
  return candidates.sort((a, b) => Math.hypot(a.x - point.x, a.y - point.y) - Math.hypot(b.x - point.x, b.y - point.y))[0];
}

export function motionDistribution(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return { count: 0, min: null, median: null, p95: null, max: null };
  const q = fraction => sorted[Math.ceil((sorted.length - 1) * fraction)];
  return { count: sorted.length, min: sorted[0], median: q(.5), p95: q(.95), max: sorted.at(-1) };
}

export function analyzePreviewMotion(trace, geometry, { gatewayPolicy = 'continuous' } = {}) {
  assert.deepEqual(trace.errors, [], 'passive observer completed without errors');
  const { shape, viewport: v, container } = geometry;
  const project = e => motionExpectedMarker(shape, { x: (e.x - container.x - v.x) / v.zoom, y: (e.y - container.y - v.y) / v.zoom }, gatewayPolicy);
  const distance = (a, b) => a && b ? Math.hypot(a.x - b.x, a.y - b.y) : Infinity;
  const near = (a, b, name) => assert.ok(distance(a, b) <= 1e-7, `${name}: ${JSON.stringify({ actual: a, expected: b })}`);
  const checkDOM = (dom, event, label) => {
    assert.deepEqual(dom.owners, [trace.owner], `${label} owns exactly one source control`);
    assert.ok(dom.marker && dom.grab && dom.tether, `${label} has marker/grab/tether`);
    for (const n of [...Object.values(dom.marker), ...Object.values(dom.grab), ...Object.values(dom.tether)]) assert.ok(Number.isFinite(n));
    near(dom.marker, project(event), `${label} reflects latest delivered input`);
    near({ x: dom.tether.x1, y: dom.tether.y1 }, dom.marker, `${label} tether starts at marker`);
    near({ x: dom.tether.x2, y: dom.tether.y2 }, dom.grab, `${label} tether reaches grab`);
  };
  return trace.runs.map(run => {
    assert.equal(run.dropped, 0, 'diagnostic capacity was not exceeded');
    assert.ok(run.events.length > 2 && run.frames.length > 0, 'native movement and frame opportunities are recorded');
    const bySequence = new Map(run.events.map(e => [e.sequence, e]));
    const firstFrame = new Map();
    for (const [i, e] of run.events.entries()) {
      assert.equal(e.trusted, true); assert.equal(e.buttons, 0);
      assert.ok([e.at, e.timeStamp, e.observedAt, e.x, e.y].every(Number.isFinite));
      assert.ok(e.at >= e.timeStamp && e.observedAt >= e.at, 'timestamps share the browser monotonic domain');
      if (i) assert.ok(e.sequence > run.events[i - 1].sequence && e.at >= run.events[i - 1].at);
      checkDOM(e.dom, e, `${run.label} post-handler ${e.sequence}`);
    }
    for (const frame of run.frames) {
      assert.ok([frame.sequence, frame.at, frame.timestamp].every(Number.isFinite));
      const latest = run.events.findLast(e => e.sequence < frame.sequence);
      assert.equal(frame.latestSequence, latest?.sequence, 'RAF is tied to latest delivered input, never an obsolete event');
      const e = bySequence.get(frame.latestSequence); assert.ok(e); checkDOM(frame.dom, e, `${run.label} RAF`);
      if (!firstFrame.has(e.sequence)) firstFrame.set(e.sequence, frame.at);
    }
    const last = run.events.at(-1);
    assert.ok(firstFrame.has(last.sequence), 'final input receives a RAF observation before stopping');
    const spatial = run.events.slice(1).map((e, i) => {
      const prev = run.events[i], inputCss = distance(e, prev), markerCss = distance(e.dom.marker, prev.dom.marker) * v.zoom,
        grabCss = distance(e.dom.grab, prev.dom.grab) * v.zoom;
      return { sequence: e.sequence, inputCss, markerCss, grabCss,
        grabMinusMarkerCss: grabCss - markerCss, grabToInputRatio: inputCss > 0 ? grabCss / inputCss : null };
    });
    return { label: run.label, events: run.events.length, pointerEvents: run.pointers.length, frames: run.frames.length,
      eventsSupersededBeforeRAF: run.events.filter(e => !firstFrame.has(e.sequence)).length,
      eventTimestampToObservationMs: motionDistribution(run.events.map(e => e.observedAt - e.timeStamp)),
      observationReadCostMs: motionDistribution([...run.events.map(e => e.dom.readCostMs), ...run.frames.map(f => f.dom.readCostMs)]),
      deliveredToFirstRAFMs: motionDistribution([...firstFrame].map(([seq, at]) => at - bySequence.get(seq).at)),
      frameIntervalsMs: motionDistribution(run.frames.slice(1).map((f, i) => f.at - run.frames[i].at)),
      spatial, grabDisplacementCss: motionDistribution(spatial.map(s => s.grabCss)),
      maxGrabJump: spatial.reduce((max, s) => !max || s.grabCss > max.grabCss ? s : max, null),
      longTasks: trace.longTasks.filter(t => t.startTime < run.end && t.startTime + t.duration > run.start) };
  });
}

/** Browser delivery may supersede CDP requests. Only actual events are inputs. */
export function assertMotionDelivery(sent, events) {
  assert.ok(sent.length > 2 && events.length > 2);
  let cursor = 0;
  const matches = [];
  for (const event of events) {
    assert.equal(event.trusted, true, 'delivered movement is native');
    const index = sent.findIndex((p, i) => i >= cursor && p.x === event.x && p.y === event.y);
    assert.ok(index >= 0, 'delivered point is in the ordered requested path');
    matches.push(index); cursor = index + 1;
  }
  assert.deepEqual({ x: events.at(-1).x, y: events.at(-1).y }, { x: sent.at(-1).x, y: sent.at(-1).y }, 'final native destination was delivered');
  assert.ok(new Set(events.map(e => `${e.x},${e.y}`)).size >= 3, 'several distinct inputs were actually delivered');
  return { requested: sent.length, delivered: events.length, requestIndices: matches, undeliveredRequests: sent.length - events.length };
}
