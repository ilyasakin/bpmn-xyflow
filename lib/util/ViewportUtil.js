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
export function fitViewport(bounds, width, height, minZoom, maxZoom, padding = 20) {
  if (!bounds || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const resolvedPadding = typeof padding === 'number' ? `${ Math.max(0, padding) }px` : padding;
  return getViewportForBounds(bounds, width, height, minZoom, maxZoom, resolvedPadding);
}
