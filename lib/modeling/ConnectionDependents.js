import { getConnectionAdjustment } from '../upstream/modeling/behavior/util/ConnectionLayoutUtil';

const finitePoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);
const clonePoint = point => ({ ...point, ...(point.original ? { original: { ...point.original } } : {}) });
const validRoute = route => Array.isArray(route) && route.length >= 2 &&
  Array.from(route).every(point => finitePoint(point) && (!point.original || finitePoint(point.original))) &&
  route.some(point => point.x !== route[0].x || point.y !== route[0].y);
const equalRoute = (a, b) => a.length === b.length && a.every((point, index) => point.x === b[index].x && point.y === b[index].y);

/** Transitive connection endpoint closure; each non-root identity occurs once. */
export function dependentConnectionClosure(owners, connections) {
  const seen = new Set(owners || []), queue = [...seen], result = [];
  for (let index = 0; index < queue.length; index++) {
    const owner = queue[index];
    for (const edge of connections || []) {
      if (!edge || seen.has(edge) || edge.source !== owner && edge.target !== owner) continue;
      seen.add(edge); queue.push(edge); result.push(edge);
    }
  }
  return result;
}

/**
 * Pure endpoint adjustment after its owner connection changes. Interior manual
 * bends, opposite docking and point metadata are preserved. The Modeler owns
 * cropping, DI identity, downstream propagation and atomic history.
 */
export function adjustDependentWaypoints(edge, side, oldRoute, newRoute, hints = {}) {
  if (!['source', 'target'].includes(side) || !validRoute(edge?.waypoints) ||
      !validRoute(oldRoute) || !validRoute(newRoute) || !hints || typeof hints !== 'object' || Array.isArray(hints)) return null;
  const segment = hints.segmentMove, bend = hints.bendpointMove;
  const indexIn = (index, length) => Number.isInteger(index) && index >= 0 && index < length;
  if ('segmentMove' in hints && (!segment || !indexIn(segment.segmentStartIndex, oldRoute.length - 1) ||
      !indexIn(segment.newSegmentStartIndex, newRoute.length - 1))) return null;
  if ('bendpointMove' in hints && (!bend || !indexIn(bend.bendpointIndex, oldRoute.length) || typeof bend.insert !== 'boolean')) return null;
  if (['connectionStart', 'connectionEnd'].some(key => key in hints && typeof hints[key] !== 'boolean')) return null;
  const points = edge.waypoints.map(clonePoint), index = side === 'source' ? 0 : points.length - 1;
  const anchor = points[index];
  if ('moveDelta' in hints && !finitePoint(hints.moveDelta)) return null;
  if (equalRoute(oldRoute, newRoute) && !('moveDelta' in hints)) return points;
  let adjusted;
  if ('moveDelta' in hints) {
    const delta = hints.moveDelta;
    if (!finitePoint(delta) || oldRoute.length !== newRoute.length || !oldRoute.every((point, i) =>
      Math.abs(point.x + delta.x - newRoute[i].x) < 1e-8 && Math.abs(point.y + delta.y - newRoute[i].y) < 1e-8)) return null;
    adjusted = { x: anchor.x + delta.x, y: anchor.y + delta.y };
  } else {
    try { adjusted = getConnectionAdjustment(anchor, newRoute, oldRoute, hints); }
    catch { return null; }
  }
  if (!finitePoint(adjusted)) return null;
  const dx = adjusted.x - anchor.x, dy = adjusted.y - anchor.y;
  points[index] = { ...anchor, x: adjusted.x, y: adjusted.y,
    ...(anchor.original ? { original: { ...anchor.original, x: anchor.original.x + dx, y: anchor.original.y + dy } } : {}) };
  if (!finitePoint(points[index]) || points[index].original && !finitePoint(points[index].original)) return null;
  return points;
}
