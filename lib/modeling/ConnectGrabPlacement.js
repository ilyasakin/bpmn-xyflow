/**
 * Keep a source grab visible without changing its chosen BPMN docking point.
 * Coordinates are graph units; radii/padding supplied by the caller are already
 * scaled from CSS pixels. No model, viewport or DOM state is changed here.
 */
export function placeConnectGrab({ anchor, preferred, normal, bounds, regions = [], preferredRegions = regions, radius, clearance, separation }) {
  if (![bounds.left, bounds.top, bounds.right, bounds.bottom, radius, clearance, separation,
    anchor.x, anchor.y, preferred.x, preferred.y, normal.x, normal.y].every(Number.isFinite)) return null;
  const box = { left: bounds.left + radius, top: bounds.top + radius,
    right: bounds.right - radius, bottom: bounds.bottom - radius };
  if (box.left > box.right || box.top > box.bottom) return null;
  const inside = point => point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom;
  const blocked = (point, obstacles = regions) => obstacles.some(region => region.radius !== undefined ?
    Math.hypot(point.x - region.x, point.y - region.y) <= region.radius + clearance :
    Math.abs(point.x - region.x) <= region.halfWidth + clearance && Math.abs(point.y - region.y) <= region.halfHeight + clearance);
  if (inside(preferred) && !blocked(preferred, preferredRegions)) return preferred;

  // Prefer the shortest clear displacement. Opposite-normal travel is useful
  // at a viewport edge: the grab may sit just inside the owner's border while
  // its outline marker stays fixed. Avoid purely tangential tethers, which
  // would compete with fine along-perimeter origin choice.
  const angles = [0, Math.PI, Math.PI / 8, -Math.PI / 8, Math.PI * 7 / 8, -Math.PI * 7 / 8,
    Math.PI / 4, -Math.PI / 4, Math.PI * 3 / 4, -Math.PI * 3 / 4];
  const epsilon = Math.max(radius, 1) * 1e-6;
  let best = null, bestDistance = Infinity;
  for (const angle of angles) {
    const direction = { x: normal.x * Math.cos(angle) - normal.y * Math.sin(angle),
      y: normal.x * Math.sin(angle) + normal.y * Math.cos(angle) };
    const range = rayBox(anchor, direction, box);
    if (!range) continue;
    let distance = Math.max(separation, range[0]);
    const intervals = regions.map(region => region.radius !== undefined ?
      rayCircle(anchor, direction, region, region.radius + clearance) :
      rayBox(anchor, direction, { left: region.x - region.halfWidth - clearance,
        right: region.x + region.halfWidth + clearance, top: region.y - region.halfHeight - clearance,
        bottom: region.y + region.halfHeight + clearance })).filter(Boolean).sort((a, b) => a[0] - b[0]);
    for (const [start, end] of intervals) {
      if (distance < start) break;
      if (distance <= end) distance = end + epsilon;
    }
    if (distance > range[1] || distance >= bestDistance) continue;
    const candidate = { x: anchor.x + direction.x * distance, y: anchor.y + direction.y * distance };
    if (inside(candidate) && !blocked(candidate)) { best = candidate; bestDistance = distance; }
  }
  // No candidate clears the visible bounds and occupied regions.
  return best;
}

function rayBox(origin, direction, box) {
  let start = -Infinity, end = Infinity;
  for (const [axis, minimum, maximum] of [['x', box.left, box.right], ['y', box.top, box.bottom]]) {
    if (Math.abs(direction[axis]) < 1e-12) {
      if (origin[axis] < minimum || origin[axis] > maximum) return null;
    } else {
      const a = (minimum - origin[axis]) / direction[axis], b = (maximum - origin[axis]) / direction[axis];
      start = Math.max(start, Math.min(a, b)); end = Math.min(end, Math.max(a, b));
    }
  }
  return start <= end ? [start, end] : null;
}

function rayCircle(origin, direction, center, radius) {
  const dx = origin.x - center.x, dy = origin.y - center.y;
  const dot = dx * direction.x + dy * direction.y, discriminant = dot * dot - dx * dx - dy * dy + radius * radius;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  return [-dot - root, -dot + root];
}
