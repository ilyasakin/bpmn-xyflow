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
