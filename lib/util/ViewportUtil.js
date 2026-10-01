import { getViewportForBounds } from '@xyflow/system';

/** Visible graph bounds, excluding collapsed descendants and invalid geometry. */
export function getGraphBounds(graph) {
  if (!graph) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const include = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const node of graph.nodes) {
    if (node.hidden) continue;
    include(node.x, node.y);
    include(node.x + (node.width || 0), node.y + (node.height || 0));
  }
  for (const edge of graph.edges) {
    if (edge.hidden) continue;
    for (const p of edge.waypoints || []) include(p.x, p.y);
  }
  return minX === Infinity ? null : {
    x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY)
  };
}

/** Public fitPadding is in pixels; XYFlow's unqualified numeric value is a ratio. */
export function fitViewport(bounds, width, height, minZoom, maxZoom, padding = 20, insets = {}) {
  if (!bounds || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const resolvedPadding = typeof padding === 'number' ? `${ Math.max(0, padding) }px` : padding;
  const inset = side => Number.isFinite(insets[side]) ? Math.max(0, insets[side]) : 0;
  const left = inset('left'), right = inset('right'), top = inset('top'), bottom = inset('bottom');
  const availableWidth = width - left - right, availableHeight = height - top - bottom;
  if (availableWidth <= 0 || availableHeight <= 0) return null;
  const viewport = getViewportForBounds(bounds, availableWidth, availableHeight, minZoom, maxZoom, resolvedPadding);
  // XYFlow floors applied padding and can shift a fractional fitted viewport
  // one pixel out of its requested margin. Clamp numeric pixel padding exactly.
  if (typeof padding === 'number' && Number.isFinite(padding)) {
    const p = Math.max(0, padding);
    const minX = p - bounds.x * viewport.zoom;
    const maxX = availableWidth - p - (bounds.x + bounds.width) * viewport.zoom;
    const minY = p - bounds.y * viewport.zoom;
    const maxY = availableHeight - p - (bounds.y + bounds.height) * viewport.zoom;
    if (minX <= maxX + 1e-9) viewport.x = Math.max(minX, Math.min(maxX, viewport.x));
    if (minY <= maxY + 1e-9) viewport.y = Math.max(minY, Math.min(maxY, viewport.y));
  }
  return { ...viewport, x: viewport.x + left, y: viewport.y + top };
}

/**
 * Minimal append reveal, matching diagram-js 15.27.1 Canvas.scrollToElement.
 * Its default 100 CSS-pixel padding is applied inside the unobstructed canvas.
 * Oversized elements align top-left; an already visible element does not move.
 * No zoom change, model mutation or navigation is performed here.
 */
export function ensureVisibleViewport(bounds, width, height, viewport, insets = {}, padding = 100) {
  if (!bounds || !viewport || ![bounds.x,bounds.y,bounds.width,bounds.height,width,height,viewport.x,viewport.y,viewport.zoom,padding].every(Number.isFinite) ||
    bounds.width < 0 || bounds.height < 0 || viewport.zoom <= 0 || width <= 0 || height <= 0 || padding < 0) return null;
  const inset = side => Number.isFinite(insets[side]) ? Math.max(0,insets[side]) : 0;
  const left = inset('left'), top = inset('top'), right = inset('right'), bottom = inset('bottom');
  const usableWidth = width - left - right, usableHeight = height - top - bottom;
  if (usableWidth <= 0 || usableHeight <= 0) return null;
  const zoom = viewport.zoom;
  const visible = {
    x: (left + padding - viewport.x) / zoom,
    y: (top + padding - viewport.y) / zoom,
    width: (usableWidth - 2 * padding) / zoom,
    height: (usableHeight - 2 * padding) / zoom
  };
  let dx, dy;
  if (bounds.width >= visible.width || bounds.height >= visible.height) {
    dx = bounds.x - visible.x;
    dy = bounds.y - visible.y;
  } else {
    dx = Math.max(0,bounds.x + bounds.width - visible.x - visible.width) || Math.min(0,bounds.x - visible.x);
    dy = Math.max(0,bounds.y + bounds.height - visible.y - visible.height) || Math.min(0,bounds.y - visible.y);
  }
  return { x: viewport.x - dx * zoom, y: viewport.y - dy * zoom, zoom };
}
