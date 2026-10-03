/** Visual-only outline outside a stock BPMN shape's painted border.
 * Geometry is in model units; the gap and preview stroke stay in CSS pixels.
 * This module never supplies docking or hit-test coordinates.
 */
import { getCirclePath, getDiamondPath, getRectPath, getRoundRectPath } from '../draw/BpmnRenderUtil.js';

const is = (shape, type) => shape?.businessObject?.$instanceOf?.(`bpmn:${type}`) ||
  shape?.type === `bpmn:${type}` || (type === 'Event' && /Event$/.test(shape?.type || '')) ||
  (type === 'Gateway' && /Gateway$/.test(shape?.type || '')) ||
  (type === 'Activity' && /(?:Task|SubProcess|Transaction|CallActivity)$/.test(shape?.type || ''));

export function connectOutlineGeometry(shape, zoom, borderWidth = 2, gap = 2.5, paintedCircle = null) {
  if (![shape?.x, shape?.y, shape?.width, shape?.height, zoom, borderWidth, gap].every(Number.isFinite) ||
      shape.width <= 0 || shape.height <= 0 || zoom <= 0 || borderWidth < 0 || gap < 0) return null;
  // Include half of the outline's own one-CSS-pixel stroke: its inner edge is
  // separated from the node's outer painted edge by exactly the requested gap.
  const padding = borderWidth / 2 + (gap + .5) / zoom;
  let xPadding = padding, yPadding = padding;
  const kind = is(shape, 'Event') ? 'circle' : is(shape, 'Gateway') ? 'diamond' : is(shape, 'Activity') ? 'rounded' : 'rect';
  if (kind === 'diamond') {
    // Offset all four diamond side lines by padding, not merely its AABB.
    xPadding = padding * Math.hypot(1, shape.width / shape.height);
    yPadding = padding * Math.hypot(1, shape.height / shape.width);
  }
  if (kind === 'circle') {
    const center = paintedCircle || { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2,
      radius: Math.round((shape.width + shape.height) / 4) };
    if (![center.x, center.y, center.radius].every(Number.isFinite) || center.radius <= 0) return null;
    const radius = center.radius + padding;
    return { kind, x: center.x - radius, y: center.y - radius, width: 2 * radius, height: 2 * radius,
      radius, padding, strokeWidth: 1 / zoom, gap };
  }
  return { kind, x: shape.x - xPadding, y: shape.y - yPadding,
    width: shape.width + 2 * xPadding, height: shape.height + 2 * yPadding,
    radius: kind === 'rounded' ? Math.min(10, shape.width / 2, shape.height / 2) + padding : null,
    padding, strokeWidth: 1 / zoom, gap };
}

export function connectOutlinePath(geometry) {
  if (!geometry) return null;
  if (geometry.kind === 'circle') return getCirclePath(geometry);
  if (geometry.kind === 'diamond') return getDiamondPath(geometry);
  if (geometry.kind === 'rounded') return getRoundRectPath(geometry, geometry.radius);
  return getRectPath(geometry);
}
