/** Read-only browser collector. The same function runs through page.evaluate
 * and against instantiated editors in the structural regression test. */
export function collectHoverBackground() {
  const t = window.hoverTest, r = t.container.getBoundingClientRect();
  if (!t.m.getDefinitions()) throw Error('Editor exposes no valid canvas roots');
  const roots = t.engine === 'upstream' ? [t.m.get('canvas').getRootElement()] : t.m.getGraph()?.roots;
  if (!Array.isArray(roots) || !roots.length || roots.some(root => !root?.id)) throw Error('Editor exposes no valid canvas roots');
  const rootIds = roots.map(root => root.id);
  for (const [fx, fy] of [[.75,.75],[.6,.8],[.85,.65],[.5,.9],[.3,.85]]) {
    const point = { x: r.left + r.width * fx, y: r.top + r.height * fy };
    const hit = document.elementFromPoint(point.x, point.y), owner = hit?.closest('[data-element-id]')?.getAttribute('data-element-id') || null;
    if (point.x < 0 || point.y < 0 || point.x >= window.innerWidth || point.y >= window.innerHeight || !hit || !t.container.contains(hit)) continue;
    if (hit.closest('button,input,select,[contenteditable],.bpmn-xyflow-minimap,.bpmn-xyflow-palette,.bpmn-xyflow-editor-actions,.bpmn-xyflow-context-pad,.djs-palette,.djs-context-pad,.bjs-powered-by')) continue;
    if ((owner && !rootIds.includes(owner)) || !hit.closest('svg')) continue;
    return { point, rootIds, owner, tag: hit.tagName };
  }
  throw Error('No unobstructed visible canvas background point found');
}

/** Observe the pinned one-shot ghost-click trap without removing it or
 * changing event propagation. Native blank-click setup may consume that one
 * exact trap, then make a second ordinary click to clear selection. */
export function observeReferenceBackgroundClicks(eventBus) {
  const trace = [], entries = new WeakMap();
  eventBus.on('element.click', 6000, event => {
    let trap = false;
    for (let listener = eventBus._listeners['element.click']; listener; listener = listener.next) {
      if (listener.priority === 5000 && !listener.callback.__isTomb && listener.callback.__fn?.name === 'trap') trap = true;
    }
    const entry = { id: event.element.id, trusted: event.originalEvent?.isTrusted === true, trap, afterTrap: false };
    trace.push(entry); entries.set(event, entry);
  });
  eventBus.on('element.click', 4000, event => { const entry = entries.get(event); if (entry) entry.afterTrap = true; });
  return trace;
}
