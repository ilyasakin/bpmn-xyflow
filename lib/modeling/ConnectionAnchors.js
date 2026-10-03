/** Type-specific editor anchor policy; never an import/serialization transform. */
export function fixedConnectionAnchors(shape) {
  if (!shape || Object.hasOwn(shape, 'waypoints') ||
      !(shape.businessObject?.$instanceOf?.('bpmn:Gateway') || /^bpmn:.*Gateway$/.test(shape.type || ''))) return null;
  const { x, y, width, height } = shape;
  if (![x, y, width, height, x + width, y + height].every(Number.isFinite) || width <= 0 || height <= 0) {
    const error = new Error('Gateway anchors need finite positive bounds'); error.code = 'UNROUTABLE_DOCKING'; throw error;
  }
  return [{ x: x + width / 2, y }, { x: x + width, y: y + height / 2 },
    { x: x + width / 2, y: y + height }, { x, y: y + height / 2 }];
}

/** Nearest vertex, with deterministic top/right/bottom/left ties. */
export function projectFixedConnectionAnchor(shape, pointer) {
  const anchors = fixedConnectionAnchors(shape);
  if (!anchors) return null;
  if (!pointer || ![pointer.x, pointer.y].every(Number.isFinite)) {
    const error = new Error('Gateway docking needs a finite pointer'); error.code = 'UNROUTABLE_DOCKING'; throw error;
  }
  let chosen = anchors[0], distance = Infinity;
  for (const anchor of anchors) {
    const next = Math.hypot(anchor.x - pointer.x, anchor.y - pointer.y);
    if (next < distance) { chosen = anchor; distance = next; }
  }
  return chosen;
}

/** Automatic orthogonal repair keeps the terminal approach direction. */
export function routeFixedConnectionAnchor(shape, endpoint, adjacent) {
  const anchors = fixedConnectionAnchors(shape);
  if (!anchors) return null;
  const existing = anchors.find(p => p.x === endpoint.x && p.y === endpoint.y);
  if (existing) return existing;
  if (adjacent && adjacent.x === endpoint.x && adjacent.y !== endpoint.y) return anchors[adjacent.y < endpoint.y ? 0 : 2];
  if (adjacent && adjacent.y === endpoint.y && adjacent.x !== endpoint.x) return anchors[adjacent.x > endpoint.x ? 1 : 3];
  return projectFixedConnectionAnchor(shape, endpoint);
}
