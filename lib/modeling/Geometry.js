/** Pure geometry planning. Callers apply returned moves as one undo transaction. */
function shapes(elements) {
  const unique = [...new Map(elements.filter(e => e && !e.waypoints && !e.labelTarget)
    .map(e => [e.id, e])).values()];
  // Selecting both a container and a child must not move the child twice.
  const ids = new Set(unique.map(e => e.id));
  return unique.filter(e => {
    let parent = e.parent;
    const visited = new Set();
    while (parent && !visited.has(parent)) {
      if (ids.has(parent.id)) return false;
      visited.add(parent);
      parent = parent.parent;
    }
    return true;
  });
}
export function alignmentMoves(elements, direction) {
  const nodes = shapes(elements);
  if (!['left', 'center', 'right', 'top', 'middle', 'bottom'].includes(direction)) {
    throw new Error(`Unsupported alignment: ${direction}`);
  }
  if (nodes.length < 2) return [];
  const minX = Math.min(...nodes.map(n => n.x));
  const maxX = Math.max(...nodes.map(n => n.x + n.width));
  const minY = Math.min(...nodes.map(n => n.y));
  const maxY = Math.max(...nodes.map(n => n.y + n.height));
  return nodes.map(node => {
    let x = node.x, y = node.y;
    if (direction === 'left') x = minX;
    if (direction === 'center') x = (minX + maxX - node.width) / 2;
    if (direction === 'right') x = maxX - node.width;
    if (direction === 'top') y = minY;
    if (direction === 'middle') y = (minY + maxY - node.height) / 2;
    if (direction === 'bottom') y = maxY - node.height;
    return { node, dx: x - node.x, dy: y - node.y };
  }).filter(move => move.dx || move.dy);
}
export function distributionMoves(elements, axis) {
  if (!['horizontal', 'vertical'].includes(axis)) throw new Error(`Unsupported distribution: ${axis}`);
  const nodes = shapes(elements);
  if (nodes.length < 3) return [];
  const position = axis === 'horizontal' ? 'x' : 'y';
  const size = axis === 'horizontal' ? 'width' : 'height';
  nodes.sort((a, b) => a[position] - b[position]);
  const first = nodes[0], last = nodes.at(-1);
  const total = nodes.reduce((sum, node) => sum + node[size], 0);
  const gap = (last[position] + last[size] - first[position] - total) / (nodes.length - 1);
  let cursor = first[position] + first[size] + gap;
  return nodes.slice(1, -1).map(node => {
    const delta = cursor - node[position];
    cursor += node[size] + gap;
    return { node, dx: position === 'x' ? delta : 0, dy: position === 'y' ? delta : 0 };
  }).filter(move => move.dx || move.dy);
}
export function spaceMoves(elements, axis, coordinate, delta) {
  if (!['horizontal', 'vertical'].includes(axis)) throw new Error(`Unsupported space axis: ${axis}`);
  if (![coordinate, delta].every(Number.isFinite)) throw new Error('Space coordinates must be finite');
  const position = axis === 'horizontal' ? 'x' : 'y';
  return shapes(elements).filter(node => node[position] >= coordinate).map(node => ({
    node, dx: position === 'x' ? delta : 0, dy: position === 'y' ? delta : 0
  }));
}

/**
 * Plan diagram space creation/removal without recursively moving descendants.
 * Direction selects the affected side; signed delta permits later compression.
 * Callers apply the whole plan as one geometry/DI transaction.
 */
export function spaceAdjustments(elements, axis, coordinate, delta, options = {}) {
  if (!['horizontal', 'vertical'].includes(axis)) throw new Error(`Unsupported space axis: ${axis}`);
  if (![coordinate, delta].every(Number.isFinite)) throw new Error('Space coordinates must be finite');
  if (!options || typeof options !== 'object') throw new Error('Space options must be an object');
  for (const key of [ 'minWidth', 'minHeight', 'padding' ]) {
    const value = options[key];
    if (value !== undefined && (!Number.isFinite(value) || (key === 'padding' ? value < 0 : value <= 0))) {
      throw new Error(`Space option ${key} must be finite and ${key === 'padding' ? 'nonnegative' : 'positive'}`);
    }
  }
  const position = axis === 'horizontal' ? 'x' : 'y';
  const size = axis === 'horizontal' ? 'width' : 'height';
  const positiveDirection = position === 'x' ? 'e' : 's';
  const negativeDirection = position === 'x' ? 'w' : 'n';
  const direction = options.direction || (delta >= 0 ? positiveDirection : negativeDirection);
  if (![positiveDirection, negativeDirection].includes(direction)) throw new Error('Space direction must match its axis');
  const positive = direction === positiveDirection;
  const is = (element, type) => element?.businessObject?.$instanceOf?.('bpmn:' + type) || element?.type === 'bpmn:' + type;
  const candidates = [...new Set(elements)].filter(element => element && element.parent && !element.hidden);
  const moving = new Set(), resizing = new Set(), boundary = [];
  const move = node => { moving.add(node); if (node.label) moving.add(node.label); };
  for (const node of candidates) {
    if (node.waypoints || node.labelTarget || node.type === 'label') continue;
    if (![node.x,node.y,node.width,node.height].every(Number.isFinite)) continue;
    const start = node[position], end = start + node[size];
    if (node.host && (positive ? start + node[size]/2 > coordinate : start + node[size]/2 < coordinate)) {
      boundary.push(node); continue;
    }
    if (positive ? start > coordinate : end < coordinate) { move(node); continue; }
    const expanded = !node.collapsed && node.di?.isExpanded !== false;
    const resizable = is(node,'Lane') || is(node,'Group') || is(node,'Participant') || (is(node,'SubProcess') && expanded);
    const emptyPool = is(node,'Participant') && !node.businessObject.processRef;
    const horizontalPool = node.di?.isHorizontal !== false;
    const canResizeEmptyPool = !emptyPool || (position === 'x' ? horizontalPool : !horizontalPool);
    if (start < coordinate && end > coordinate && resizable && canResizeEmptyPool) resizing.add(node);
  }
  for (const node of moving) for (const attached of node.attachers || []) move(attached);
  for (const node of boundary) if (moving.has(node.host) || resizing.has(node.host)) move(node);
  for (const edge of candidates.filter(node=>node.waypoints)) {
    if (edge.label && (moving.has(edge.source)||resizing.has(edge.source)) && (moving.has(edge.target)||resizing.has(edge.target))) move(edge.label);
  }
  let effectiveDelta = delta;
  const padding = options.padding ?? 20;
  const minimum = position === 'x' ? (options.minWidth ?? 100) : (options.minHeight ?? 80);
  for (const node of resizing) {
    if (positive) effectiveDelta = Math.max(effectiveDelta, minimum - node[size]);
    else effectiveDelta = Math.min(effectiveDelta, node[size] - minimum);
    const children = (node.children || []).filter(child=>!child.waypoints && !child.labelTarget && child.type!=='label' && !child.host && Number.isFinite(child[position]));
    for (const child of children) {
      if (resizing.has(child)) continue;
      if (positive) {
        const limit = moving.has(child)
          ? node[position] + padding - child[position]
          : child[position] + child[size] + padding - node[position] - node[size];
        effectiveDelta = Math.max(effectiveDelta, Math.min(0, limit));
      } else {
        const limit = moving.has(child)
          ? node[position] + node[size] - padding - child[position] - child[size]
          : child[position] - padding - node[position];
        effectiveDelta = Math.min(effectiveDelta, Math.max(0, limit));
      }
    }
  }
  const vector = position === 'x' ? {x:effectiveDelta,y:0} : {x:0,y:effectiveDelta};
  return {
    direction, axis: position, coordinate, delta: vector,
    movingShapes: [...moving], resizingShapes: [...resizing],
    moves: [...moving].map(node=>({node, dx:vector.x, dy:vector.y})),
    resizes: [...resizing].map(node=>({node,bounds:{
      x:node.x + (direction === 'w' ? effectiveDelta : 0),
      y:node.y + (direction === 'n' ? effectiveDelta : 0),
      width:node.width + (position === 'x' ? (positive ? effectiveDelta : -effectiveDelta) : 0),
      height:node.height + (position === 'y' ? (positive ? effectiveDelta : -effectiveDelta) : 0)
    }}))
  };
}
